import { Database } from "bun:sqlite";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { cdp, targetByUrl } from "./cdp.js";
import { ensureHealthyWallet, mineTo, pointShopsAtRegtest, shopPaymentLinkId } from "./setup.js";
const REGTEST_NODE = "http://127.0.0.1:18081";
const DECOY = "47cYSGSjzWPX3KFEN9PaxT5zpWKgRtx568bazbGzt57ffBbUAQevjMk19sfZCrMB1RWHNJLbz1eKU63B77HpHwUVA6JGudr";
const here = dirname(fileURLToPath(import.meta.url));
function shopRoot(origin: string) {
  return origin.includes(":3004")
    ? join(here, "../../monero-wallet-api/standard-checkout")
    : join(here, "../../monero-payment-links");
}
function assertShopNode(origin: string) {
  const settings = JSON.parse(readFileSync(join(shopRoot(origin), "wallet-caches/ScanSettings.json"), "utf8"));
  if (settings.node_url !== REGTEST_NODE) throw new Error("shop node is " + settings.node_url + ", want " + REGTEST_NODE);
}
// Browser test for tool 001: full payment through the wallet.
// Opens a fresh checkout, clicks pay, fires the slider, sends, then mines
// with mineTo (the same generateblocks call as the regtest button) until the
// checkout confirmation count is reached.
// Needs Brave on :9222 with the wallet extension.
// The shop is ../monero-payment-links. start-regtest.sh runs bun run production there.
// CHECKOUT_URL overrides the shop, for example http://127.0.0.1:3004/newsession
// Usage: bun test/browser-001.ts
await ensureHealthyWallet();
const checkoutUrl = process.env.CHECKOUT_URL || "";
const startUrl = checkoutUrl || `http://127.0.0.1:3003/pay/${shopPaymentLinkId()}`;
if (checkoutUrl) await pointShopsAtRegtest(new URL(startUrl).origin);
assertShopNode(new URL(startUrl).origin);
console.log("wallet healthy, checkout " + startUrl);

const { ws, send } = await cdp();
const nt: any = await send("Target.createTarget", { url: startUrl });
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
  let reopened = false;
  while (Date.now() - start < 20000) {
    const t = String(await panel(`document.body.innerText`) || "");
    const active = await panel(`(() => { const b = document.getElementById("send-action"); return !!(b && b.classList.contains("action-button")); })()`);
    if (active === true && t.includes("selected amount:") && !t.includes("selected amount: 0.00") && !t.includes("invalid address") && !t.includes("exceeds unlocked funds")) { ready = true; break; }
    if (!reopened && t.includes("selected amount: 0.00")) {
      reopened = true;
      await panel(`document.getElementById("send")?.click()`);
      await new Promise((r) => setTimeout(r, 400));
      await panel(`document.getElementById("send")?.click()`);
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  if (!ready) throw new Error("tool block never populated");
}
const priorIds = new Set(String(await panel(`(() => { const invs = Object.values(window.wallets.actionLogOpened.invocationsCache ?? {}); return invs.filter((v) => v.toolId === "001" && v.lastType === "execute_result").map((v) => v.invocationId).join(","); })()`) || "").split(",").filter(Boolean));
async function poolIds(): Promise<Set<string>> {
  const d: any = await fetch("http://127.0.0.1:18081/get_transaction_pool").then((r) => r.json());
  return new Set((d.transactions || []).map((t: any) => t.id_hash));
}
async function newestExecute(): Promise<{ id: string; ok: boolean; err: string } | null> {
  const raw = String(await panel(`(() => {
    const prior = new Set(${JSON.stringify([...priorIds])});
    const invs = Object.values(window.wallets.actionLogOpened.invocationsCache ?? {});
    const rows = invs.filter((v) => v.toolId === "001" && v.lastType === "execute_result" && !prior.has(v.invocationId));
    rows.sort((a, b) => String(b.timestamp || "").localeCompare(String(a.timestamp || "")));
    const v = rows[0];
    if (!v) return "";
    return JSON.stringify({ id: v.invocationId, ok: v.ok === true, err: String(v.error || v.lastError || "") });
  })()`) || "");
  return raw ? JSON.parse(raw) : null;
}
async function clickSend(): Promise<boolean> {
  const clicked = await panel(`(async () => {
    const b = document.getElementById("send-action");
    if (!b || !b.classList.contains("action-button") || typeof b.onclick !== "function") return "not ready";
    await b.onclick();
    return "clicked";
  })()`);
  return clicked === "clicked";
}
const poolBefore = await poolIds();
{
  const waitSend = Date.now();
  let armed = false;
  while (Date.now() - waitSend < 10000) {
    if (await clickSend()) { armed = true; break; }
    await new Promise((r) => setTimeout(r, 200));
  }
  if (!armed) throw new Error("send button was not active");
}
let entry = "";
let decoyRetried = false;
{
  const start = Date.now();
  while (Date.now() - start < 60000 && !entry) {
    const result = await newestExecute();
    if (result?.ok) { entry = "execute_result|" + result.id; break; }
    if (result && !result.ok) {
      if (!decoyRetried && /decoy|make Input/i.test(result.err)) {
        decoyRetried = true;
        console.log("decoy ring failed, mining 60");
        priorIds.add(result.id);
        await mineTo(DECOY, 60);
        const waitSend = Date.now();
        let again = false;
        while (Date.now() - waitSend < 20000) {
          if (await clickSend()) { again = true; break; }
          await new Promise((r) => setTimeout(r, 400));
        }
        if (!again) throw new Error("send button was not active after decoy mine");
        continue;
      }
      throw new Error(result.err || "send failed");
    }
    const now = await poolIds();
    for (const id of now) {
      if (!poolBefore.has(id)) { entry = "pool|" + id; break; }
    }
    if (entry) break;
    await new Promise((r) => setTimeout(r, 400));
  }
}
console.log("entry:", entry || "(not found)");
if (!entry) throw new Error("send never confirmed");

const checkoutPage = new URL(co);
const checkoutId = checkoutPage.searchParams.get("checkoutId");
if (!checkoutId) throw new Error("no checkoutId on " + co);
function serverConfirmation() {
  const db = new Database(join(shopRoot(checkoutPage.origin), "monero_payments.db"), { readonly: true });
  try {
    const row = db.query("select paid_status, tx_confirmations, required_confirmations, tx_hash from checkout_session where session_id = ?").get(checkoutId) as { paid_status: number; tx_confirmations: number; required_confirmations: number; tx_hash: string | null } | null;
    if (!row) return { conf: 0, need: 10, paid: false, tx: null as string | null };
    return { conf: row.tx_confirmations, need: row.required_confirmations, paid: row.paid_status === 1, tx: row.tx_hash };
  } finally {
    db.close();
  }
}
let final = serverConfirmation();
await mineTo(DECOY, Math.max(final.need, 1) + 2);
const waitStart = Date.now();
while (Date.now() - waitStart < 45000 && !(final.paid && final.conf >= final.need)) {
  await new Promise((r) => setTimeout(r, 400));
  final = serverConfirmation();
}
console.log("server confirmations", final.conf + "/" + final.need, "tx", final.tx);
if (!(final.paid && final.conf >= final.need)) throw new Error("server confirmations " + final.conf + "/" + final.need);
console.log("PASS tool 001 paid and verified");
ws.close();
process.exit(0);
