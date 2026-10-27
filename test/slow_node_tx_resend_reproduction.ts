import { cdp, debugHttp, targetByUrl } from "./cdp.js";
import { ensureHealthyWallet, mineTo, pointShopsAtRegtest, shopPaymentLinkId } from "./setup.js";
// one slow tool send, then a second tool send.
// the second send must not reach the node. the first tx log still locks the coinbase.
// today the lock value is 0, and 0 is treated as missing, so the second send is allowed.
// usage: bun test/slow_node_tx_resend_reproduction.ts

const DECOY = "47cYSGSjzWPX3KFEN9PaxT5zpWKgRtx568bazbGzt57ffBbUAQevjMk19sfZCrMB1RWHNJLbz1eKU63B77HpHwUVA6JGudr";

await ensureHealthyWallet();
await pointShopsAtRegtest("http://127.0.0.1:3003");

const held: { requestId: string; sessionId?: string }[] = [];
const { ws, send } = await cdp((msg) => {
  if (msg.method !== "Fetch.requestPaused") return;
  const requestId = msg.params?.requestId;
  if (!requestId) return;
  held.push({ requestId, sessionId: msg.sessionId });
  console.log("node send held", msg.params?.request?.url || "");
});

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

async function releaseHeld() {
  const rows = held.splice(0, held.length);
  for (const row of rows) {
    await send("Fetch.continueRequest", { requestId: row.requestId }, row.sessionId);
  }
}

async function openPayLink() {
  const startUrl = `http://127.0.0.1:3003/pay/${shopPaymentLinkId()}`;
  console.log("checkout", startUrl);
  const nt: any = await send("Target.createTarget", { url: startUrl });
  const start = Date.now();
  while (Date.now() - start < 10000) {
    const list: any[] = await (await fetch(debugHttp() + "/json/list")).json();
    const co = list.find((x) => x.id === nt.targetId)?.url || "";
    if (co.includes("checkoutId")) return;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error("no checkout session");
}

async function clickPay() {
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

async function waitSpendCall() {
  const start = Date.now();
  let open = "";
  while (Date.now() - start < 10000) {
    open = String(await panel(`(() => { const al = window.wallets.actionLogOpened; const o = al.getActiveByPermissions(["spend"]); return o.length + ":" + (o[0]?.amount || ""); })()`) ?? "");
    if (open.startsWith("1:")) return open;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error("no spend call opened");
}

async function waitSendReady(): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < 20000) {
    const t = String(await panel(`document.body.innerText`) || "");
    const active = await panel(`(() => { const b = document.getElementById("send-action"); return !!(b && b.classList.contains("action-button")); })()`);
    if (t.includes("exceeds unlocked funds")) return false;
    if (active === true && t.includes("selected amount:") && !t.includes("selected amount: 0.00") && !t.includes("invalid address")) return true;
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
}

function clickSend() {
  return panel(`(() => {
    const b = document.getElementById("send-action");
    if (!b || !b.classList.contains("action-button") || typeof b.onclick !== "function") return "not ready";
    void b.onclick();
    return "clicked";
  })()`);
}

const targets: any[] = await (await fetch(debugHttp() + "/json/list")).json();
const bg = targets.find((t) => String(t.url || "").includes("background.html"));
if (!bg) throw new Error("offscreen background.html was not open");
const bgSession = await send("Target.attachToTarget", { targetId: bg.id, flatten: true });
await send("Fetch.enable", {
  patterns: [{ urlPattern: "*send_raw_transaction*", requestStage: "Request" }],
}, bgSession.sessionId);

await panel(`(() => { const al = window.wallets.actionLogOpened; for (const x of al.getActiveByPermissions(["spend"])) al.dismiss(x.invocationId); return 1; })()`);
await openPayLink();
await clickPay();
const firstOpen = await waitSpendCall();
console.log("first spend call", firstOpen);
if ((await panel(`String(window.unlocked)`)) !== "true") await panelClick("fire");
if ((await panel(`!!document.getElementById("send-action")`)) !== true) {
  if ((await panel(`window.activeWalletPlate`)) === "send") await panelClick("send");
  await panelClick("send");
}
if (!(await waitSendReady())) throw new Error("first send was not ready");
if ((await clickSend()) !== "clicked") throw new Error("first send button was not active");

{
  const start = Date.now();
  while (!held.length && Date.now() - start < 90000) await new Promise((r) => setTimeout(r, 200));
}
if (!held.length) {
  console.log("decoy ring failed, mining 60");
  await mineTo(DECOY, 60);
  if ((await clickSend()) !== "clicked") throw new Error("send button was not active after decoy mine");
  const start = Date.now();
  while (!held.length && Date.now() - start < 90000) await new Promise((r) => setTimeout(r, 200));
}
if (!held.length) throw new Error("first send_raw_transaction was not held");

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
  await releaseHeld();
  throw new Error("sent tx to node was not on the send plate");
}
await releaseHeld();
{
  const start = Date.now();
  let done = "";
  while (Date.now() - start < 60000 && !done) {
    const t = String(await panel(`document.body.innerText`) || "");
    if (t.includes("successfully sent transaction")) done = "success";
    if (t.includes("failed to send transaction")) done = "failed";
    if (!done) await new Promise((r) => setTimeout(r, 300));
  }
  console.log("first send:", done || "(no status)");
  if (done !== "success") throw new Error("first send did not succeed");
}

console.log("second send: click SEND. the locked coinbase must keep the button inactive");
await openPayLink();
await clickPay();
const secondOpen = await waitSpendCall();
console.log("second spend call", secondOpen);
if ((await panel(`!!document.getElementById("send-action")`)) !== true) {
  if ((await panel(`window.activeWalletPlate`)) === "send") await panelClick("send");
  await panelClick("send");
}
const buttonClass = String(await panel(`document.getElementById("send-action")?.className || ""`) || "");
console.log("second send button:", buttonClass);
if (!buttonClass.includes("inactive-action-button")) {
  throw new Error("second SEND button was active: " + buttonClass);
}
await panelClick("send-action");
{
  const start = Date.now();
  while (!held.length && Date.now() - start < 8000) await new Promise((r) => setTimeout(r, 200));
}
if (held.length) {
  await releaseHeld();
  throw new Error("second SEND click reached the node");
}
const plate = String(await panel(`document.body.innerText`) || "");
const line = plate.split("\n").find((row) => row.includes("exceeds unlocked funds") || row.includes("not enough funds") || row.includes("successfully sent transaction"));
console.log("after second click:", line || "(no status line)");
ws.close();
console.log("PASS second SEND click stayed inactive");
