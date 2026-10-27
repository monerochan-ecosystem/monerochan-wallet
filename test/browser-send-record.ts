import { cdp, debugHttp, recordTabs, targetByUrl } from "./cdp.js";
import { ensureHealthyWallet, mineTo, nodeHeight, pointShopsAtRegtest, shopPaymentLinkId } from "./setup.js";
// Recorded tool 001 send. Slow mode holds send_raw_transaction so the
// "sent tx to node" hint stays on screen for 8 seconds before success.
// Realtime mode (SLOW=0) slows nothing down.
// usage: bun test/browser-send-record.ts
//        SLOW=0 bun test/browser-send-record.ts

const DECOY = "47cYSGSjzWPX3KFEN9PaxT5zpWKgRtx568bazbGzt57ffBbUAQevjMk19sfZCrMB1RWHNJLbz1eKU63B77HpHwUVA6JGudr";
const SLOW = process.env.SLOW !== "0";
const OUT = SLOW ? "testdata/videos/send-slow-8s.mp4" : "testdata/videos/send-realtime.mp4";
const TRIM = SLOW ? 2 : 1;

await ensureHealthyWallet();
const startUrl = `http://127.0.0.1:3003/pay/${shopPaymentLinkId()}`;
await pointShopsAtRegtest("http://127.0.0.1:3003");
console.log("checkout", startUrl, SLOW ? "(slow, 8s hold)" : "(realtime)");

const held: { requestId: string; sessionId?: string }[] = [];
const { ws, send } = await cdp((msg) => {
  if (msg.method !== "Fetch.requestPaused") return;
  const requestId = msg.params?.requestId;
  if (!requestId) return;
  held.push({ requestId, sessionId: msg.sessionId });
  console.log("node send held", msg.params?.request?.url || "");
});

// close stale checkouts so targetByUrl hits the fresh tab
{
  const stale: any[] = await (await fetch(debugHttp() + "/json/list")).json();
  for (const st of stale.filter((x) => (x.url || "").includes("checkoutId"))) {
    await send("Target.closeTarget", { targetId: st.id }).catch(() => {});
  }
}
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

// deep chain, mature decoys: mine extra blocks and wait for the scan to catch up
await mineTo(DECOY, 120);
{
  const tip = await nodeHeight();
  const start = Date.now();
  while (Date.now() - start < 120000) {
    const h = await panel(`window.wallets?.wallets?.[0]?.current_top_range_height ?? window.wallets?.wallets?.[0]?.current_height ?? 0`);
    if (Number(h) + 2 >= tip) break;
    await new Promise((r) => setTimeout(r, 2000));
  }
}

if (SLOW) {
  const targets: any[] = await (await fetch(debugHttp() + "/json/list")).json();
  const bg = targets.find((t) => String(t.url || "").includes("background.html"));
  if (!bg) throw new Error("offscreen background.html was not open");
  const bgSession = await send("Target.attachToTarget", { targetId: bg.id, flatten: true });
  await send("Fetch.enable", {
    patterns: [{ urlPattern: "*send_raw_transaction*", requestStage: "Request" }],
  }, bgSession.sessionId);
  console.log("holding send_raw_transaction");
}

await panel(`(() => { const al = window.wallets.actionLogOpened; for (const x of al.getActiveByPermissions(["spend"])) al.dismiss(x.invocationId); return 1; })()`);

// clear leftovers from previous runs so viewers only see this run's states
if ((await panel(`window.activeWalletPlate`)) === "send") await panelClick("send");
await panelClick("send");
for (const btn of ["dismissExecuted", "dismissStatus"]) {
  if ((await panel(`!!document.getElementById(${JSON.stringify(btn)})`)) === true) {
    await panelClick(btn);
  }
}

const rec = await recordTabs(["checkoutId", "sidebar.html"], OUT, { trimStartSec: TRIM });
const vt0 = Date.now();
const timing: Record<string, number> = {};
const mark = (k: string) => { timing[k] = (Date.now() - vt0) / 1000; };
console.log("recording to", OUT);
await new Promise((r) => setTimeout(r, 1500));

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
  mark("pay_click");
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
  mark("spend_open");
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

mark("ready");
// linger on the open tool call so it's easy to follow
await new Promise((r) => setTimeout(r, 3000));

if (SLOW) {
  const clicked = await panel(`(() => {
    const b = document.getElementById("send-action");
    if (!b || !b.classList.contains("action-button") || typeof b.onclick !== "function") return "not ready";
    // do not await. the send waits on the held node call and would block this page.
    void b.onclick();
    return "clicked";
  })()`);
  if (clicked !== "clicked") throw new Error("send button was not active");
  console.log("send clicked, waiting for the held node call");
  mark("send_click");

  // bail out early on decoy failure instead of idling the full 90s
  const lastErr = async () => String(await panel(`(() => { const invs = Object.values(window.wallets.actionLogOpened.invocationsCache ?? {}); const v = invs.filter((x) => x.toolId === "001" && x.lastType === "execute_result").at(-1); return v ? String(v.error || "") : ""; })()`) || "");
  {
    const start = Date.now();
    while (!held.length && Date.now() - start < 90000) {
      await new Promise((r) => setTimeout(r, 1000));
      if (!held.length && (await lastErr()).match(/decoy|make Input/i)) break;
    }
  }
  if (!held.length) throw new Error("send never reached the node: " + (await lastErr()));

  let hintAt = 0;
  {
    const start = Date.now();
    while (Date.now() - start < 10000) {
      const t = String(await panel(`document.body.innerText`) || "");
      const line = t.split("\n").find((row) => row.includes("sent tx to node"));
      if (line) { hintAt = Date.now(); console.log("hint:", line.trim()); break; }
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  if (!hintAt) {
    for (const row of held) {
      await send("Fetch.continueRequest", { requestId: row.requestId }, row.sessionId);
    }
    throw new Error("sent tx to node was not on the send plate while the node was held");
  }
  // keep the hint on screen for 8 seconds before letting the answer through
  const wait = 8000 - (Date.now() - hintAt);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  for (const row of held.splice(0, held.length)) {
    await send("Fetch.continueRequest", { requestId: row.requestId }, row.sessionId);
  }
  timing["hint"] = (hintAt - vt0) / 1000;
  mark("released");
  console.log("node answer released after 8s of hint");
} else {
  const clicked = await panel(`(async () => {
    const b = document.getElementById("send-action");
    if (!b || !b.classList.contains("action-button") || typeof b.onclick !== "function") return "not ready";
    await b.onclick();
    return "clicked";
  })()`);
  if (clicked !== "clicked") throw new Error("send button was not active");
  console.log("send clicked (realtime, nothing held");
  mark("send_click");
}

{
  const start = Date.now();
  let done = "";
  while (Date.now() - start < 60000 && !done) {
    const t = String(await panel(`document.body.innerText`) || "");
    if (t.includes("successfully sent transaction")) done = "success";
    if (t.includes("failed to send transaction")) done = "failed";
    if (!done) await new Promise((r) => setTimeout(r, 300));
  }
  if (done === "success") mark("success");
  console.log("after release:", done || "(no status)");
  if (done !== "success") throw new Error("send did not finish with success");
}

// let the success line sit on screen briefly, then stop recording
await new Promise((r) => setTimeout(r, 1500));
mark("end");
await Bun.write(`${rec.framesDir}/timing.json`, JSON.stringify({ trim: TRIM, marks: timing }, null, 1));
const stats = await rec.stop();
console.log("frames:", stats.framesDir, `${stats.frames} frames, ${stats.seconds.toFixed(1)}s, ${stats.fps.toFixed(2)}fps (compose with test/compose-video.py)`);

ws.close();
console.log(SLOW ? "PASS slow recorded send: 8s hint then success" : "PASS realtime recorded send");
