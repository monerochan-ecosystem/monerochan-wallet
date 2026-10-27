import { cdp, debugHttp, targetByUrl } from "./cdp.js";
import { ensureHealthyWallet, mineTo, pointShopsAtRegtest, shopPaymentLinkId } from "./setup.js";
// tool 001 send with the node answer held.
// cdp pauses send_raw_transaction on the offscreen document.
// the side panel must show "sent tx to node" before that answer continues.
// usage: bun test/browser-slow-send.ts

const DECOY = "47cYSGSjzWPX3KFEN9PaxT5zpWKgRtx568bazbGzt57ffBbUAQevjMk19sfZCrMB1RWHNJLbz1eKU63B77HpHwUVA6JGudr";

await ensureHealthyWallet();
const startUrl = `http://127.0.0.1:3003/pay/${shopPaymentLinkId()}`;
await pointShopsAtRegtest("http://127.0.0.1:3003");
console.log("checkout", startUrl);

const held: { requestId: string; sessionId?: string }[] = [];
const { ws, send } = await cdp((msg) => {
  if (msg.method !== "Fetch.requestPaused") return;
  const requestId = msg.params?.requestId;
  if (!requestId) return;
  held.push({ requestId, sessionId: msg.sessionId });
  console.log("node send held", msg.params?.request?.url || "");
});

const nt: any = await send("Target.createTarget", { url: startUrl });
{
  const start = Date.now();
  let co = "";
  while (Date.now() - start < 10000) {
    const list: any[] = await (await fetch(debugHttp() + "/json/list")).json();
    co = list.find((x) => x.id === nt.targetId)?.url || "";
    if (co.includes("checkoutId")) break;
    await new Promise((r) => setTimeout(r, 200));
  }
  if (!co.includes("checkoutId")) throw new Error("no checkout session");
}

async function panel(expr: string): Promise<any> {
  const t = await targetByUrl("sidebar.html");
  const s = await send("Target.attachToTarget", { targetId: t.id, flatten: true });
  await send("Runtime.enable", {}, s.sessionId);
  const r = await send("Runtime.evaluate", {
    expression: expr,
    returnByValue: true,
    awaitPromise: true,
  }, s.sessionId);
  return r.result?.value;
}

async function panelClick(elId: string): Promise<void> {
  const t = await targetByUrl("sidebar.html");
  const s = await send("Target.attachToTarget", { targetId: t.id, flatten: true });
  await send("Runtime.enable", {}, s.sessionId);
  const r = await send("Runtime.evaluate", {
    expression: `(() => { const el = document.getElementById(${JSON.stringify(elId)}); if (!el) return "missing"; el.scrollIntoView({block:"center"}); const b = el.getBoundingClientRect(); return JSON.stringify({x: b.x+b.width/2, y: b.y+b.height/2}); })()`,
    returnByValue: true,
  }, s.sessionId);
  if (r.result?.value === "missing") throw new Error("missing " + elId);
  const { x, y } = JSON.parse(r.result.value);
  await send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 }, s.sessionId);
  await send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 }, s.sessionId);
  await new Promise((rr) => setTimeout(rr, 400));
}

const targets: any[] = await (await fetch(debugHttp() + "/json/list")).json();
const bg = targets.find((t) => String(t.url || "").includes("background.html"));
if (!bg) {
  console.log(targets.map((t) => t.type + " " + t.url).join("\n"));
  throw new Error("offscreen background.html was not open");
}
const bgSession = await send("Target.attachToTarget", { targetId: bg.id, flatten: true });
await send("Fetch.enable", {
  patterns: [{ urlPattern: "*send_raw_transaction*", requestStage: "Request" }],
}, bgSession.sessionId);
console.log("holding send_raw_transaction");

await panel(`(() => { const al = window.wallets.actionLogOpened; for (const x of al.getActiveByPermissions(["spend"])) al.dismiss(x.invocationId); return 1; })()`);

{
  const t = await targetByUrl("checkoutId");
  await send("Target.activateTarget", { targetId: t.id });
  await new Promise((r) => setTimeout(r, 500));
  const s = await send("Target.attachToTarget", { targetId: t.id, flatten: true });
  await send("Runtime.enable", {}, s.sessionId);
  const r = await send("Runtime.evaluate", {
    expression: `(() => { const a=[...document.querySelectorAll("a")].filter(e=>e.getBoundingClientRect().width>0).find(e=>e.innerText.includes("pay with browser wallet")); if(!a) return "missing"; const b=a.getBoundingClientRect(); return JSON.stringify({x:b.x+b.width/2, y:b.y+b.height/2}); })()`,
    returnByValue: true,
  }, s.sessionId);
  if (r.result?.value === "missing") throw new Error("pay link missing");
  const { x, y } = JSON.parse(r.result.value);
  await send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 }, s.sessionId);
  await send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 }, s.sessionId);
}

{
  const start = Date.now();
  let open = "";
  while (Date.now() - start < 10000) {
    open = String(await panel(`(() => { const al = window.wallets.actionLogOpened; const o = al.getActiveByPermissions(["spend"]); return o.length + ":" + (o[0]?.amount || ""); })()`) ?? "");
    if (open.startsWith("1:")) break;
    await new Promise((r) => setTimeout(r, 200));
  }
  console.log("open spend calls:", open);
  if (!open.startsWith("1:")) throw new Error("no spend call opened");
}

if ((await panel(`String(window.unlocked)`)) !== "true") await panelClick("fire");
{
  const shown = async () => (await panel(`!!document.getElementById("send-action")`)) === true;
  if (!(await shown())) {
    if ((await panel(`window.activeWalletPlate`)) === "send") await panelClick("send");
    await panelClick("send");
    const start = Date.now();
    while (Date.now() - start < 8000 && !(await shown())) await new Promise((r) => setTimeout(r, 200));
  }
  if (!(await shown())) throw new Error("send form did not open");
}
{
  const start = Date.now();
  let ready = false;
  while (Date.now() - start < 20000) {
    const t = String(await panel(`document.body.innerText`) || "");
    const active = await panel(`(() => { const b = document.getElementById("send-action"); return !!(b && b.classList.contains("action-button")); })()`);
    if (active === true && t.includes("selected amount:") && !t.includes("selected amount: 0.00") && !t.includes("invalid address") && !t.includes("exceeds unlocked funds")) {
      ready = true;
      break;
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  if (!ready) throw new Error("tool block never populated");
}

const clicked = await panel(`(() => {
  const b = document.getElementById("send-action");
  if (!b || !b.classList.contains("action-button") || typeof b.onclick !== "function") return "not ready";
  // do not await. the send waits on the held node call and would block this page.
  void b.onclick();
  return "clicked";
})()`);
if (clicked !== "clicked") throw new Error("send button was not active");
console.log("send clicked, waiting for the held node call");

{
  const start = Date.now();
  while (!held.length && Date.now() - start < 90000) await new Promise((r) => setTimeout(r, 200));
}
if (!held.length) {
  const err = await panel(`(() => { const invs = Object.values(window.wallets.actionLogOpened.invocationsCache ?? {}); const v = invs.filter((x) => x.toolId === "001" && x.lastType === "execute_result").at(-1); return v ? String(v.error || v.ok) : ""; })()`);
  if (String(err).match(/decoy|make Input/i)) {
    console.log("decoy ring failed, mining 60, click send again");
    await mineTo(DECOY, 60);
    const again = await panel(`(() => {
      const b = document.getElementById("send-action");
      if (!b || typeof b.onclick !== "function") return "not ready";
      void b.onclick();
      return "clicked";
    })()`);
    if (again !== "clicked") throw new Error("send button was not active after decoy mine");
    const start = Date.now();
    while (!held.length && Date.now() - start < 90000) await new Promise((r) => setTimeout(r, 200));
  }
}
if (!held.length) throw new Error("send_raw_transaction was not held");

let hint = "";
{
  const start = Date.now();
  while (Date.now() - start < 10000) {
    const t = String(await panel(`document.body.innerText`) || "");
    const line = t.split("\n").find((row) => row.includes("sent tx to node"));
    if (line) { hint = line.trim(); break; }
    await new Promise((r) => setTimeout(r, 200));
  }
}
console.log("hint:", hint || "(not shown)");
if (!hint) {
  for (const row of held) {
    await send("Fetch.continueRequest", { requestId: row.requestId }, row.sessionId);
  }
  throw new Error("sent tx to node was not on the send plate while the node was held");
}

for (const row of held) {
  await send("Fetch.continueRequest", { requestId: row.requestId }, row.sessionId);
}
console.log("node answer released");

{
  const start = Date.now();
  let done = "";
  while (Date.now() - start < 60000 && !done) {
    const t = String(await panel(`document.body.innerText`) || "");
    if (t.includes("successfully sent transaction")) done = "success";
    if (t.includes("failed to send transaction")) done = "failed";
    if (!done) await new Promise((r) => setTimeout(r, 300));
  }
  console.log("after release:", done || "(no status)");
  if (done !== "success") throw new Error("send did not finish after the node answer");
}

ws.close();
console.log("PASS slow tool send showed the hint, then the success line");
