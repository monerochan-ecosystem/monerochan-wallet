import { cdp, targetByUrl } from "./cdp.js";
import { ensureHealthyWallet, mineTo, shopPaymentLinkId } from "./setup.js";
// Browser test for tool 001: full payment through the wallet.
// Opens a fresh checkout, clicks pay, fires the slider, sends, then verifies
// the node pool grew and the action log entry executed ok. Cleans nothing:
// an executed call needs no dismissal.
// Needs Brave on :9222 with the wallet extension.
// The shop is ../monero-payment-links. start-regtest.sh runs bun run production there.
// Usage: bun test/browser-001.ts
await ensureHealthyWallet();
const linkId = shopPaymentLinkId();
console.log("wallet healthy, payment link", linkId);

const { ws, send } = await cdp();
const nt: any = await send("Target.createTarget", { url: `http://127.0.0.1:3003/pay/${linkId}` });
let co = "";
{
  const start = Date.now();
  while (Date.now() - start < 10000) {
    const list: any[] = await (await fetch("http://127.0.0.1:9222/json/list")).json();
    co = list.find((x) => x.id === nt.targetId)?.url || "";
    if (co.includes("checkoutId")) break;
    await new Promise((r) => setTimeout(r, 200));
  }
}
if (!co.includes("checkoutId")) throw new Error("no checkout session");

async function onCheckout(expr: string): Promise<any> {
  const t = await targetByUrl("checkoutId");
  const s = await send("Target.attachToTarget", { targetId: t.id, flatten: true });
  await send("Runtime.enable", {}, s.sessionId);
  const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true }, s.sessionId);
  return { session: s, value: r.result?.value };
}

async function panel(expr: string): Promise<any> {
  const t = await targetByUrl("sidebar.html");
  const s = await send("Target.attachToTarget", { targetId: t.id, flatten: true });
  await send("Runtime.enable", {}, s.sessionId);
  const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true }, s.sessionId);
  return r.result?.value;
}

async function panelClick(elId: string): Promise<void> {
  const t = await targetByUrl("sidebar.html");
  const s = await send("Target.attachToTarget", { targetId: t.id, flatten: true });
  await send("Runtime.enable", {}, s.sessionId);
  const r = await send("Runtime.evaluate", { expression: `(() => { const el = document.getElementById(${JSON.stringify(elId)}); if (!el) return "missing"; el.scrollIntoView({block:"center"}); const b = el.getBoundingClientRect(); return JSON.stringify({x: b.x+b.width/2, y: b.y+b.height/2}); })()`, returnByValue: true }, s.sessionId);
  if (r.result?.value === "missing") throw new Error("missing " + elId);
  const { x, y } = JSON.parse(r.result.value);
  await send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 }, s.sessionId);
  await send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 }, s.sessionId);
  await new Promise((rr) => setTimeout(rr, 1500));
}

await panel(`(() => { const al = window.wallets.actionLogOpened; for (const x of al.getActiveByPermissions(["spend"])) al.dismiss(x.invocationId); return 1; })()`);

// pay click with a trusted gesture
{
  const t = await targetByUrl("checkoutId");
  await send("Target.activateTarget", { targetId: t.id });
  await new Promise((r) => setTimeout(r, 500));
  const s = await send("Target.attachToTarget", { targetId: t.id, flatten: true });
  await send("Runtime.enable", {}, s.sessionId);
  const r = await send("Runtime.evaluate", { expression: `(() => { const a=[...document.querySelectorAll("a")].filter(e=>e.getBoundingClientRect().width>0).find(e=>e.innerText.includes("pay with browser wallet")); if(!a) return "missing"; const b=a.getBoundingClientRect(); return JSON.stringify({x:b.x+b.width/2, y:b.y+b.height/2}); })()`, returnByValue: true }, s.sessionId);
  if (r.result?.value === "missing") throw new Error("pay link missing");
  const { x, y } = JSON.parse(r.result.value);
  await send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 }, s.sessionId);
  await send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 }, s.sessionId);
}

let open = "";
{
  const start = Date.now();
  while (Date.now() - start < 10000) {
    open = String(await panel(`(() => { const al = window.wallets.actionLogOpened; const o = al.getActiveByPermissions(["spend"]); return o.length + ":" + (o[0]?.amount || ""); })()`) ?? "");
    if (open.startsWith("1:")) break;
    await new Promise((r) => setTimeout(r, 200));
  }
}
console.log("open spend calls:", open);
if (!open.startsWith("1:")) throw new Error("no spend call opened");

const unlocked = await panel(`String(window.unlocked)`);
if (unlocked !== "true") await panelClick("fire");

const callAmt = await panel(`(() => { const al = window.wallets.actionLogOpened; const o = al.getActiveByPermissions(["spend"]); return o[0]?.invocationId || ""; })()`);
{
  const shown = async () => (await panel(`!!document.getElementById("send-action")`)) === true;
  if (!(await shown())) {
    if ((await panel(`window.activeWalletPlate`)) === "send") await panelClick("send");
    await panelClick("send");
    const start = Date.now();
    while (Date.now() - start < 8000 && !(await shown())) {
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  if (!(await shown())) throw new Error("send form did not open");
}
{
  const start = Date.now();
  let ready = false;
  while (Date.now() - start < 15000) {
    const t = await panel(`document.body.innerText`);
    const active = await panel(`(() => { const b = document.getElementById("send-action"); return !!(b && b.classList.contains("action-button")); })()`);
    if (t && active === true && t.includes("selected amount:") && !t.includes("selected amount: 0.00") && !t.includes("invalid address")) { ready = true; break; }
    await new Promise((r) => setTimeout(r, 200));
  }
  if (!ready) throw new Error("tool block never populated");
}
const shownBal = String(await panel(`document.body.innerText`) || "");
const balDigits = shownBal.match(/(\d+\.\d+) XMR/)?.[1];
const spend = balDigits ? parseFloat(balDigits) : 0;
if (!(spend >= 1)) {
  console.log("spendable", spend, "mining 60 to unlock");
  const addr = await panel(`window.wallets.wallets[0].primary_address`);
  await mineTo(String(addr), 60);
}
const poolBefore: number = await fetch("http://127.0.0.1:18081/get_transaction_pool").then((x: any) => x.json()).then((d: any) => (d.transactions || []).length);
const beforeText = String(await panel(`document.body.innerText`) || "");
const hadStatus = beforeText.includes("successfully sent transaction");
const hadFail = beforeText.includes("failed to send transaction");
const priorIds = new Set(String(await panel(`(() => { const invs = Object.values(window.wallets.actionLogOpened.invocationsCache ?? {}); return invs.filter((v) => v.toolId === "001" && v.lastType === "execute_result").map((v) => v.invocationId).join(","); })()`) || "").split(",").filter(Boolean));
const clicked = await panel(`(async () => {
  const b = document.getElementById("send-action");
  if (!b || !b.classList.contains("action-button") || typeof b.onclick !== "function") return "not ready";
  await b.onclick();
  return "clicked";
})()`);
if (clicked !== "clicked") throw new Error("send button was not active");

let sent: string | null = null;
{
  const start = Date.now();
  while (Date.now() - start < 45000) {
    const p: number = await fetch("http://127.0.0.1:18081/get_transaction_pool").then((x: any) => x.json()).then((d: any) => (d.transactions || []).length);
    if (p === poolBefore + 1) { sent = "pool"; break; }
    const t = String(await panel(`document.body.innerText`) || "");
    if (!hadStatus && t.includes("successfully sent transaction")) { sent = "status"; break; }
    if (!hadFail && t.includes("failed to send transaction")) throw new Error("wallet reports failed send");
    if (t.includes("exceeds unlocked funds")) throw new Error("funds locked");
    await new Promise((r) => setTimeout(r, 400));
  }
}
if (!sent) throw new Error("send never confirmed");
let entry = "";
{
  const start = Date.now();
  while (Date.now() - start < 20000) {
    entry = String(await panel(`(() => { const invs = Object.values(window.wallets.actionLogOpened.invocationsCache ?? {}); const v = invs.find((x) => x.toolId === "001" && x.lastType === "execute_result" && x.ok === true && !${JSON.stringify([...priorIds])}.includes(x.invocationId)); return v ? v.lastType + "|" + v.invocationId : ""; })()`) || "");
    if (entry.startsWith("execute_result")) break;
    await new Promise((r) => setTimeout(r, 400));
  }
}
console.log("entry:", entry || "(not found in caches)", "| confirmed via", sent);
if (!entry.startsWith("execute_result")) throw new Error("no execute result, got " + entry);
console.log("PASS tool 001 paid and verified");
ws.close();
process.exit(0);
