import { Database } from "bun:sqlite";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { cdp, debugHttp, targetByUrl } from "./cdp.js";
import { ensureHealthyWallet, mineTo, pointShopsAtRegtest, shopPaymentLinkId } from "./setup.js";
const REGTEST_NODE = "http://127.0.0.1:18081";
const DECOY = "47cYSGSjzWPX3KFEN9PaxT5zpWKgRtx568bazbGzt57ffBbUAQevjMk19sfZCrMB1RWHNJLbz1eKU63B77HpHwUVA6JGudr";
const here = dirname(fileURLToPath(import.meta.url));
const runId = process.env.RUN_ID || "1";
const shotDir = join(here, "../testdata/browser-001-runs", runId);
mkdirSync(shotDir, { recursive: true });
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
// Needs Brave on BRAVE_PORT (default 9333) with the wallet extension.
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
let co = "";

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

// an unverified payment link shows an info message with a dismiss button.
await openCheckout();
{
  const href = `http://127.0.0.1:3003/#monerochan001_amount_0.1_address_${DECOY}_no_check`;
  const t = await targetByUrl("checkoutId");
  const s = await send("Target.attachToTarget", { targetId: t.id, flatten: true });
  await send("Runtime.enable", {}, s.sessionId);
  await send("Runtime.evaluate", {
    expression: `(() => {
      const a = document.createElement("a");
      a.id = "nocheck-link";
      a.href = ${JSON.stringify(href)};
      a.textContent = "nocheck";
      a.style.cssText = "position:fixed;left:8px;top:8px;z-index:99999";
      document.body.appendChild(a);
      return 1;
    })()`,
    returnByValue: true,
  }, s.sessionId);
  const box = await send("Runtime.evaluate", {
    expression: `(() => { const a = document.getElementById("nocheck-link"); const b = a.getBoundingClientRect(); return JSON.stringify({x:b.x+b.width/2,y:b.y+b.height/2}); })()`,
    returnByValue: true,
  }, s.sessionId);
  const pos = JSON.parse(box.result.value);
  await send("Input.dispatchMouseEvent", { type: "mousePressed", x: pos.x, y: pos.y, button: "left", clickCount: 1 }, s.sessionId);
  await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: pos.x, y: pos.y, button: "left", clickCount: 1 }, s.sessionId);
  const start = Date.now();
  let shown = false;
  while (Date.now() - start < 8000) {
    const text = String(await panel(`document.body.innerText`) || "");
    if (text.includes("skips destination checks")) { shown = true; break; }
    if ((await panel(`window.activeWalletPlate`)) !== "send") await panelClick("send");
    await new Promise((r) => setTimeout(r, 200));
  }
  if (!shown) throw new Error("unverified info message missing");
  const btn = await panel(`!!document.getElementById("dismissInfo")`);
  if (btn === true) throw new Error("dismiss button still next to the info message");
  console.log("info message: unverified, no dismiss");
  await panel(`(() => { const al = window.wallets.actionLogOpened; for (const x of al.getActiveByPermissions(["spend"])) al.dismiss(x.invocationId); return 1; })()`);
}

// same link, but the anchor sits in an open shadow root. x chat does this.
{
  const href = `http://127.0.0.1:3003/#monerochan001_amount_0.1_address_${DECOY}_no_check`;
  const t = await targetByUrl("checkoutId");
  const s = await send("Target.attachToTarget", { targetId: t.id, flatten: true });
  await send("Runtime.enable", {}, s.sessionId);
  await send("Runtime.evaluate", {
    expression: `(() => {
      const host = document.createElement("div");
      host.id = "shadow-host";
      host.style.cssText = "position:fixed;left:8px;top:40px;z-index:99999";
      const root = host.attachShadow({ mode: "open" });
      const a = document.createElement("a");
      a.id = "shadow-link";
      a.href = ${JSON.stringify(href)};
      a.textContent = "shadow";
      a.style.cssText = "display:inline-block;padding:8px";
      root.appendChild(a);
      document.body.appendChild(host);
      return 1;
    })()`,
    returnByValue: true,
  }, s.sessionId);
  const box = await send("Runtime.evaluate", {
    expression: `(() => { const a = document.getElementById("shadow-host").shadowRoot.getElementById("shadow-link"); const b = a.getBoundingClientRect(); return JSON.stringify({x:b.x+b.width/2,y:b.y+b.height/2}); })()`,
    returnByValue: true,
  }, s.sessionId);
  const pos = JSON.parse(box.result.value);
  await send("Input.dispatchMouseEvent", { type: "mousePressed", x: pos.x, y: pos.y, button: "left", clickCount: 1 }, s.sessionId);
  await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: pos.x, y: pos.y, button: "left", clickCount: 1 }, s.sessionId);
  const start = Date.now();
  let shown = false;
  while (Date.now() - start < 8000) {
    const text = String(await panel(`document.body.innerText`) || "");
    if (text.includes("skips destination checks")) { shown = true; break; }
    if ((await panel(`window.activeWalletPlate`)) !== "send") await panelClick("send");
    await new Promise((r) => setTimeout(r, 200));
  }
  if (!shown) throw new Error("shadow link did not open the unverified info message");
  const btn = await panel(`!!document.getElementById("dismissInfo")`);
  if (btn === true) throw new Error("dismiss button still next to the shadow info message");
  console.log("shadow link: unverified, no dismiss");
  await panel(`(() => { const al = window.wallets.actionLogOpened; for (const x of al.getActiveByPermissions(["spend"])) al.dismiss(x.invocationId); return 1; })()`);
}

async function openCheckout(): Promise<string> {
  const nt: any = await send("Target.createTarget", { url: startUrl });
  {
    const start = Date.now();
    while (Date.now() - start < 10000) {
      const list: any[] = await (await fetch(debugHttp() + "/json/list")).json();
      co = list.find((x) => x.id === nt.targetId)?.url || "";
      if (co.includes("checkoutId")) break;
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  if (!co.includes("checkoutId")) throw new Error("no checkout session");
  await shotTarget(nt.targetId, "checkout");
  return nt.targetId;
}
async function shotTarget(targetId: string, name: string) {
  try {
    const s = await send("Target.attachToTarget", { targetId, flatten: true });
    await send("Page.enable", {}, s.sessionId).catch(() => {});
    const r = await send("Page.captureScreenshot", { format: "png" }, s.sessionId);
    await Bun.write(join(shotDir, name + ".png"), Buffer.from(r.data, "base64"));
  } catch (err) {
    console.log("shot fail", name, err instanceof Error ? err.message : String(err));
  }
}
async function drivePayment(label: string): Promise<void> {
  const ntId: string = await openCheckout();
  // pay click with a trusted gesture (on the new checkout, not a stale tab)
  {
    const listed: any[] = await (await fetch(debugHttp() + "/json/list")).json();
    const t = listed.find((x) => x.id === ntId);
    if (!t) throw new Error("new checkout tab gone");
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
  console.log(label, "open spend calls:", open);
  if (!open.startsWith("1:")) throw new Error("no spend call opened");
  await shotTarget((await targetByUrl("sidebar.html")).id, "spend-" + label);
  const unlocked = await panel(`String(window.unlocked)`);
  if (unlocked !== "true") await panelClick("fire");
}

async function openAndArm(label: string): Promise<void> {
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
    const waitSend = Date.now();
    let armed = false;
    while (Date.now() - waitSend < 10000) {
      if (await clickSend()) { armed = true; break; }
      await new Promise((r) => setTimeout(r, 200));
    }
    if (!armed) throw new Error("send button was not active " + label);
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
await drivePayment("first");
await openAndArm("first");
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
        await drivePayment("retry");
        await openAndArm("retry");
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

{
  const executedId = String(await panel(`(() => {
    const invs = Object.values(window.wallets.actionLogOpened.invocationsCache ?? {});
    const rows = invs.filter((v) => v.toolId === "001" && (v.lastType === "execute_result" || v.lastType === "execute_start"));
    rows.sort((a, b) => String(b.timestamp || "").localeCompare(String(a.timestamp || "")));
    return rows[0]?.invocationId || "";
  })()`) || "");
  const start = Date.now();
  let hint = false;
  while (Date.now() - start < 8000) {
    const text = String(await panel(`document.body.innerText`) || "");
    const buttons = await panel(`!!document.getElementById("dismissExecuted") && !!document.getElementById("visitExecuted")`);
    if (text.includes("tool call executed") && buttons === true) { hint = true; break; }
    await new Promise((r) => setTimeout(r, 200));
  }
  if (!hint) throw new Error("tool call executed hint missing");
  console.log("hint: tool call executed");
  await shotTarget((await targetByUrl("sidebar.html")).id, "executed");
  await panelClick("visitExecuted");
  const look = Date.now();
  let visitUrl = "";
  while (Date.now() - look < 8000) {
    const targets = await send("Target.getTargets");
    const hit = (targets.targetInfos || []).find((row: any) => String(row.url || "").includes("actionlog.html") && String(row.url || "").includes(executedId));
    if (hit) { visitUrl = hit.url; break; }
    await new Promise((r) => setTimeout(r, 200));
  }
  if (!visitUrl) throw new Error("visit did not open the action log entry");
  console.log("visit:", visitUrl);
  {
    const targets = await send("Target.getTargets");
    const hit = (targets.targetInfos || []).find((row: any) => String(row.url || "").includes("actionlog.html") && String(row.url || "").includes(executedId));
    const s = await send("Target.attachToTarget", { targetId: hit.targetId, flatten: true });
    await send("Runtime.enable", {}, s.sessionId);
    const raw = await send("Runtime.evaluate", {
      expression: `(() => {
        const rows = [...document.querySelectorAll(".log-info-row")];
        const row = (label) => rows.find((r) => (r.querySelector(".log-info-label")?.textContent || "").trim().toLowerCase() === label);
        const page = row("page");
        const pageA = page?.querySelector("a");
        return JSON.stringify({
          pageHref: pageA?.getAttribute("href") || "",
          pageText: (pageA?.textContent || "").trim(),
          linkIsAnchor: !!row("link")?.querySelector("a"),
          destIsAnchor: !!row("destination")?.querySelector("a"),
        });
      })()`,
      returnByValue: true,
    }, s.sessionId);
    const info = JSON.parse(raw.result?.value || "{}");
    if (!info.pageHref || info.pageHref !== info.pageText) throw new Error("page link is not clickable: " + JSON.stringify(info));
    if (!info.pageHref.includes("checkoutId")) throw new Error("page link is not the context page: " + info.pageHref);
    if (info.linkIsAnchor || info.destIsAnchor) throw new Error("destination link is clickable: " + JSON.stringify(info));
    console.log("action log: page link clickable, destination not");
  }
  await panelClick("dismissExecuted");
  const hidden = await panel(`!document.body.innerText.includes("tool call executed")`);
  if (hidden !== true) throw new Error("dismiss did not hide the executed hint");
  console.log("executed hint dismissed");
}

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
while (Date.now() - waitStart < 180000 && !(final.paid && final.conf >= final.need)) {
  await new Promise((r) => setTimeout(r, 400));
  final = serverConfirmation();
}
console.log("server confirmations", final.conf + "/" + final.need, "tx", final.tx);
if (!(final.paid && final.conf >= final.need)) throw new Error("server confirmations " + final.conf + "/" + final.need);
await shotTarget((await targetByUrl("checkoutId")).id, "paid");
await Bun.write(join(shotDir, "state.json"), JSON.stringify(final, null, 2));
console.log("PASS tool 001 paid and verified");
ws.close();
process.exit(0);
