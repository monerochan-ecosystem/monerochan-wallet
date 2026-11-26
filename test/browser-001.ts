import { Database } from "bun:sqlite";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { parseToolLink } from "@spirobel/monero-wallet-api/tools";
import * as walletApi from "@spirobel/monero-wallet-api";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { cdp, debugHttp, targetByUrl } from "./cdp.js";
import { ensureHealthyWallet, mineTo, pointShopsAtRegtest, shopPaymentLinkId } from "./setup.js";
const REGTEST_NODE = "http://127.0.0.1:18081";
const DECOY = "47cYSGSjzWPX3KFEN9PaxT5zpWKgRtx568bazbGzt57ffBbUAQevjMk19sfZCrMB1RWHNJLbz1eKU63B77HpHwUVA6JGudr";
const here = dirname(fileURLToPath(import.meta.url));
const runId = process.env.RUN_ID || "1";
if (!/^[a-zA-Z0-9_-]+$/.test(runId)) throw new Error("invalid run id");
const shotDir = join(here, "../testdata/browser-001-runs", runId);
rmSync(shotDir, { recursive: true, force: true });
mkdirSync(shotDir, { recursive: true });
const walletless = process.env.CHECKOUT_MODE === "walletless";
function shopRoot(origin: string) {
  if (process.env.CHECKOUT_ROOT) return process.env.CHECKOUT_ROOT;
  if (walletless) return join(here, "../../monero-wallet-api/walletless-checkout");
  return origin.includes(":3004")
    ? join(here, "../../monero-wallet-api/standard-checkout")
    : (process.env.SHOP_ROOT || join(here, "../../monero-payment-links"));
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
const nodeInfo = await fetch(REGTEST_NODE + "/get_info").then((r) => r.json());
if (nodeInfo.nettype !== "fakechain" || !nodeInfo.offline || nodeInfo.height < 10000) throw new Error("acceptance test needs an offline regtest chain with enough decoy history");
const checkoutUrl = process.env.CHECKOUT_URL || "";
let startUrl = checkoutUrl || `http://127.0.0.1:3003/pay/${shopPaymentLinkId()}`;
if (checkoutUrl && !walletless && !process.env.CHECKOUT_ROOT) await pointShopsAtRegtest(new URL(startUrl).origin);
if (!walletless) assertShopNode(new URL(startUrl).origin);
console.log("wallet healthy, checkout " + startUrl);

const heldPayerRequests: { requestId: string; sessionId?: string; tx_as_hex: string; released: boolean }[] = [];
const { ws, send } = await cdp((event) => {
  if (event.method !== "Fetch.requestPaused") return;
  heldPayerRequests.push({ requestId: event.params.requestId, sessionId: event.sessionId,
    tx_as_hex: JSON.parse(event.params.request.postData).tx_as_hex, released: false });
});
const handoverOnly = process.env.HANDOVER_ONLY === "1";
let co = "";
let expectedAmount = "";
let expectedAddress = "";
let expectedLink = "";
let checkoutTarget = "";

async function onCheckout(expr: string): Promise<any> {
  const t = checkoutTarget ? { id: checkoutTarget } : await targetByUrl("checkoutId");
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

if (!handoverOnly) {
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

}

async function openCheckout(label = "walletless-unpaid"): Promise<string> {
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
  if (walletless && !label.startsWith("checkout-handover-")) {
    const s = await send("Target.attachToTarget", { targetId: nt.targetId, flatten: true });
    for (let i = 0; i < 100; i++) {
      const ready = await send("Runtime.evaluate", { expression: '!!document.querySelector("a.pay-button") && !!document.querySelector("iframe")?.contentDocument?.body?.innerText', returnByValue: true }, s.sessionId);
      if (ready.result.value) break;
      await Bun.sleep(100);
    }
  }
  await shotTarget(nt.targetId, label);
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
async function drivePayment(label: string, kind = "001"): Promise<string> {
  const ntId: string = await openCheckout("checkout-" + label);
  checkoutTarget = ntId;
  // pay click with a trusted gesture (on the new checkout, not a stale tab)
  {
    const listed: any[] = await (await fetch(debugHttp() + "/json/list")).json();
    const t = listed.find((x) => x.id === ntId);
    if (!t) throw new Error("new checkout tab gone");
    await send("Target.activateTarget", { targetId: t.id });
    await new Promise((r) => setTimeout(r, 500));
    const s = await send("Target.attachToTarget", { targetId: t.id, flatten: true });
    await send("Runtime.enable", {}, s.sessionId);
    const r = await send("Runtime.evaluate", { expression: `(() => { const a=[...document.querySelectorAll("a")].filter(e=>e.getBoundingClientRect().width>0).find(e=>e.innerText.includes("pay with browser wallet")); if(!a) return "missing"; const b=a.getBoundingClientRect(); return JSON.stringify({x:b.x+b.width/2, y:b.y+b.height/2, href:a.href}); })()`, returnByValue: true }, s.sessionId);
    if (r.result?.value === "missing") throw new Error("pay link missing");
    const { x, y, href } = JSON.parse(r.result.value);
    const tool = parseToolLink(href);
    if (tool?.tool_id !== "001") throw new Error("checkout payment link is not 001");
    expectedAmount = tool.payload.amount;
    expectedAddress = tool.payload.address;
    expectedLink = kind === "001" ? href : `monero:${expectedAddress}${kind === "legacy-zero" ? "?tx_amount=0" : kind === "legacy-amount" ? `?tx_amount=${expectedAmount}` : ""}`;
    if (kind !== "001") {
      // change only the page fixture link. input fields are never filled by javascript.
      await send("Runtime.evaluate", { expression: `document.querySelector('a.pay-button').href = ${JSON.stringify(expectedLink)}` }, s.sessionId);
    }
    await send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 }, s.sessionId);
    await send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 }, s.sessionId);
  }
  let open = "";
  {
    const start = Date.now();
    while (Date.now() - start < 10000) {
      open = String(await panel(`(() => { const o = window.wallets.actionLogOpened.getActiveByPermissions(["spend"]); const x = o[0]; return o.length === 1 && x?.link === ${JSON.stringify(expectedLink)} && x.address === ${JSON.stringify(expectedAddress)} && x.amount === ${JSON.stringify(kind === "legacy-address" ? "" : kind === "legacy-zero" ? "0" : expectedAmount)} && (x.no_check ? ${kind !== "001"} : x.valid === "valid") ? "1:" + x.amount : ""; })()`) ?? "");
      if (open.startsWith("1:")) break;
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  console.log(label, "open spend calls:", open);
  if (!open.startsWith("1:")) throw new Error("no spend call opened");
  await shotTarget((await targetByUrl("sidebar.html")).id, "spend-" + label);
  const unlocked = await panel(`String(window.unlocked)`);
  if (unlocked !== "true") await panelClick("fire");
  return ntId;
}

async function openAndArm(label: string, kind = "001"): Promise<void> {
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
    if (kind === "legacy-address" || kind === "legacy-zero") {
      // a real click and physical key events prove the field is editable.
      await panelClick("amountInput");
      const field = await panel(`(() => { const el = document.getElementById("amountInput"); return { disabled: el?.disabled, value: el?.value, focused: document.activeElement === el, ready: typeof el?.oninput === "function" }; })()`);
      if (field.disabled || field.value !== "" || !field.focused || !field.ready) throw new Error("amount input is not ready for keyboard entry: " + JSON.stringify(field));
      const t = await targetByUrl("sidebar.html");
      const s = await send("Target.attachToTarget", { targetId: t.id, flatten: true });
      for (const key of expectedAmount) {
        const code = key === "." ? "Period" : `Digit${key}`;
        const windowsVirtualKeyCode = key === "." ? 190 : key.charCodeAt(0);
        await send("Input.dispatchKeyEvent", { type: "keyDown", key, code, windowsVirtualKeyCode, text: key }, s.sessionId);
        await send("Input.dispatchKeyEvent", { type: "keyUp", key, code, windowsVirtualKeyCode }, s.sessionId);
      }
      await new Promise((r) => setTimeout(r, 250));
      const typed = await panel(`document.getElementById("amountInput")?.value`);
      if (typed !== expectedAmount) throw new Error("keystrokes did not fill amount: " + JSON.stringify({ typed, expectedAmount }));
      console.log(label, "amount entered with keystrokes:", typed);
    }
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
    await shotTarget((await targetByUrl("sidebar.html")).id, (ready ? "ready-" : "failed-ready-") + label);
    if (!ready) throw new Error("payment form did not become ready: " + label);
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
  if (await panel(`window.wallets.node_url`) !== REGTEST_NODE) throw new Error("refuse to send outside regtest");
  const ready = await panel(`(() => { const b = document.getElementById("send-action"); return !!(b?.classList.contains("action-button") && typeof b.onclick === "function"); })()`);
  if (!ready) return false;
  await panelClick("send-action");
  return true;
}
const nodeGate = handoverOnly ? "" : process.env.CHECKOUT_NODE_GATE || "";
let gateSession = "";
let receiptCaptured = false;
if (nodeGate) {
  await fetch(nodeGate + "/hold", { method: "POST" });
  gateSession = (await send("Target.attachToTarget", { targetId: (await targetByUrl("background.html")).id, flatten: true })).sessionId;
  await send("Fetch.enable", { patterns: [{ urlPattern: REGTEST_NODE + "/send_raw_transaction", requestStage: "Request" }] }, gateSession);
}
// use the same signed, broadcast, and confirmed payment path for all link forms.
for (const kind of handoverOnly ? [] : walletless ? ["001"] : ["001", "legacy-amount", "legacy-address", "legacy-zero"]) {
const poolBefore = await poolIds();
await drivePayment(kind, kind);
await openAndArm(kind, kind);
let entry = "";
let decoyRetried = false;
{
  const start = Date.now();
  while (Date.now() - start < 60000 && !entry) {
    if (nodeGate && !receiptCaptured && heldPayerRequests.some((request) => !request.released)) {
      const gate = await fetch(nodeGate + "/state").then((response) => response.json());
      if (gate.pending > 0) {
        await send("Target.activateTarget", { targetId: checkoutTarget });
        const deadline = Date.now() + 6000;
        let visible = false;
        while (Date.now() < deadline) {
          const { value } = await onCheckout('document.querySelector("iframe")?.contentDocument?.body?.innerText || ""');
          if (String(value).includes("Transaction is valid & amount correct.")) { visible = true; break; }
          await Bun.sleep(100);
        }
        if (!visible) throw new Error("receipt was not shown before node acceptance");
        const held = heldPayerRequests.find((request) => !request.released)!;
        if (held.tx_as_hex !== gate.tx_as_hex) throw new Error("merchant received different bytes");
        const database = new Database(join(shopRoot(new URL(co).origin), "monero_payments.db"), { readonly: true });
        const row = database.query("SELECT tx_hash, paid_status, tx_confirmations FROM checkout_session WHERE session_id = ?").get(new URL(co).searchParams.get("checkoutId")) as any;
        database.close();
        if (!row?.tx_hash || row.paid_status || row.tx_confirmations) throw new Error("receipt was not saved as unpaid");
        if ((await poolIds()).has(row.tx_hash)) throw new Error("transaction reached the test node before either request was released");
        const { value: fits } = await onCheckout('(() => { const frame = document.querySelector("iframe"); const box = frame?.contentDocument?.querySelector(".payment-status")?.getBoundingClientRect(); return !!box && box.bottom <= frame.clientHeight + 1; })()');
        if (!fits) throw new Error("receipt status is clipped by its iframe");
        const receiptHoldMs = Math.max(0, Math.min(6000, Number(process.env.RECEIPT_HOLD_MS) || 2000));
        await Bun.sleep(receiptHoldMs);
        await shotTarget(checkoutTarget, "received-" + kind);
        await Bun.write(join(shotDir, "received-" + kind + ".json"), JSON.stringify({ ...row, payerSubmissionHeld: true, merchantSubmissionHeld: true, exactSignedBytes: true, absentFromNode: true, receiptHoldMs, timestamp: new Date().toISOString() }, null, 2));
        await fetch(nodeGate + "/release", { method: "POST" });
        for (const request of heldPayerRequests) {
          if (request.released) continue;
          await send("Fetch.continueRequest", { requestId: request.requestId }, request.sessionId);
          request.released = true;
        }
        await send("Fetch.disable", {}, gateSession);
        receiptCaptured = true;
        await send("Target.activateTarget", { targetId: (await targetByUrl("sidebar.html")).id });
        console.log("PASS receipt rendered while both submissions were held, before node acceptance");
      }
    }
    const result = await newestExecute();
    if (result?.ok) { entry = "execute_result|" + result.id; break; }
    if (result && !result.ok) {
      if (!decoyRetried && /decoy|make Input/i.test(result.err)) {
        decoyRetried = true;
        console.log("decoy ring failed, mining 60");
        priorIds.add(result.id);
        await mineTo(DECOY, 60);
        await drivePayment(kind + "-retry", kind);
        await openAndArm(kind + "-retry", kind);
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

const executedId = String(await panel(`(() => {
    const invs = Object.values(window.wallets.actionLogOpened.invocationsCache ?? {});
    const rows = invs.filter((v) => v.toolId === "001" && (v.lastType === "execute_result" || v.lastType === "execute_start"));
    rows.sort((a, b) => String(b.timestamp || "").localeCompare(String(a.timestamp || "")));
    return rows[0]?.invocationId || "";
  })()`) || "");
{
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
  await shotTarget((await targetByUrl("sidebar.html")).id, "executed-" + kind);
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
  // the visit above opened the action log in front. chrome pauses animation frames
  // for the panel behind it, so bring the panel back or it never repaints.
  await send("Target.activateTarget", { targetId: (await targetByUrl("sidebar.html")).id }).catch(() => {});
  await new Promise((r) => setTimeout(r, 500));
  await panelClick("dismissExecuted");
  let hidden = false;
  for (let i = 0; i < 20; i++) {
    hidden = (await panel(`!document.body.innerText.includes("tool call executed")`)) === true;
    if (hidden) break;
    await new Promise((r) => setTimeout(r, 200));
  }
  if (!hidden) throw new Error("dismiss did not hide the executed hint");
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
await send("Target.activateTarget", { targetId: checkoutTarget });
if (checkoutUrl && kind === "001") {
  const handover = await panel(`(() => { const x = window.wallets.actionLogOpened.invocations().find(x => x.invocationId === ${JSON.stringify(executedId)}); return [...(x?.events ?? [])].reverse().find(e => e.handover)?.handover; })()`);
  if (handover?.ok !== true) throw new Error("checkout handover failed: " + JSON.stringify(handover));
  const until = Date.now() + 10000;
  const expectedStatus = walletless ? "Transaction accepted by node." : "Transaction is valid & amount correct.";
  let acceptedVisible = false;
  while (Date.now() < until) {
    const { value } = await onCheckout('document.querySelector("iframe")?.contentDocument?.body?.innerText || ""');
    if (String(value).includes(expectedStatus)) { acceptedVisible = true; break; }
    await Bun.sleep(100);
  }
  if (!acceptedVisible) throw new Error("checkout did not render " + expectedStatus);
  await shotTarget(checkoutTarget, "accepted-" + kind);
  await mineTo(DECOY, 3);
  const afterThree = Date.now() + 15000;
  while (Date.now() < afterThree && serverConfirmation().conf < 3) await Bun.sleep(100);
  if (serverConfirmation().conf < 3) throw new Error("checkout did not track the first three confirmations");
  // the status frame reloads each second. wait until it shows the count, or the picture has the old text.
  const confirmingUntil = Date.now() + 10000;
  let confirmingVisible = false;
  while (Date.now() < confirmingUntil) {
    const { value } = await onCheckout('document.querySelector("iframe")?.contentDocument?.body?.innerText || ""');
    if (String(value).includes("Transaction confirming (")) { confirmingVisible = true; break; }
    await Bun.sleep(100);
  }
  if (!confirmingVisible) throw new Error("checkout did not render the confirming state");
  await shotTarget(checkoutTarget, "confirming-" + kind);
}
await mineTo(DECOY, Math.max(final.need, 1) + 2);
const waitStart = Date.now();
while (Date.now() - waitStart < 180000 && !(final.paid && final.conf >= final.need)) {
  await new Promise((r) => setTimeout(r, 400));
  final = serverConfirmation();
}
console.log("server confirmations", final.conf + "/" + final.need, "tx", final.tx);
if (!(final.paid && final.conf >= final.need)) throw new Error("server confirmations " + final.conf + "/" + final.need);
if (!final.tx) throw new Error("checkout has no transaction hash");
const chain = await fetch(REGTEST_NODE + "/get_transactions", {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ txs_hashes: [final.tx] }),
}).then((r) => r.json());
if (chain.txs?.[0]?.in_pool !== false || chain.txs?.[0]?.tx_hash !== final.tx) throw new Error("payment is not on chain: " + JSON.stringify(chain));
const paintDeadline = Date.now() + 15000;
let paidVisible = false;
while (Date.now() < paintDeadline) {
  const { value } = await onCheckout('document.querySelector("iframe")?.contentDocument?.body?.innerText || ""');
  if (String(value).includes("Payment received")) { paidVisible = true; break; }
  await Bun.sleep(100);
}
if (!paidVisible) throw new Error("checkout did not render the paid state");
await shotTarget(checkoutTarget, "paid-" + kind);
await Bun.write(join(shotDir, kind + "-state.json"), JSON.stringify({ ...final, kind, address: expectedAddress, amount: expectedAmount, invocationId: executedId, block_height: chain.txs[0].block_height }, null, 2));
console.log("PASS " + kind + " paid and verified on chain");
priorIds.add(executedId);
}
async function handoverAcceptance() {
  const merchant = await walletApi.makeTestKeyPair();
  const viewPair = await walletApi.ViewPair.create(merchant.view_key.mainnet_primary, merchant.view_key.view_key);
  const receipts = new Map<string, { tx_hash: string; count: number }>();
  const invoices = new Map<string, { id: string; paymentId: number; address: string; scenario: string; attempts: number }>();
  const requests: any[] = [];
  let scenario = "success";
  let serial = 0;
  let origin = "";
  const save = () => Bun.write(join(shotDir, "handover-state.json"), JSON.stringify({ requests, receipts: [...receipts.values()], invoices: [...invoices.values()] }, null, 2));
  const server = Bun.serve({
    hostname: "127.0.0.1", port: 0,
    async fetch(req) {
      const url = new URL(req.url);
      if (url.pathname === "/newsession") {
        const id = String(++serial);
        const paymentId = 1000 + serial;
        invoices.set(id, { id, paymentId, address: viewPair.makeIntegratedAddress(paymentId), scenario, attempts: 0 });
        return Response.redirect(`${origin}/checkout?checkoutId=${id}`, 303);
      }
      const id = url.searchParams.get("checkoutId") || "";
      if (url.pathname === "/checkout") {
        const invoice = invoices.get(id);
        if (!invoice) return new Response("missing checkout", { status: 404 });
        const link = (walletApi.tools["001"].counterparty as any).make({ address: invoice.address, amount: "0.1", no_check: false });
        return new Response(`<!doctype html><meta charset="utf-8"><title>001 handover checkout</title><a class="pay-button" href="/wallet_info?checkoutId=${id}#${link}">pay with browser wallet</a>`, { headers: {
          "Content-Type": "text/html",
          // the checkout page is an authenticated merchant page, like a real shop session.
          "Set-Cookie": `handover-session=${id}; Path=/; SameSite=Strict`,
        } });
      }
      if (url.pathname.startsWith("/monerochan001/")) {
        const address = decodeURIComponent(url.pathname.slice("/monerochan001/".length));
        const invoice = [...invoices.values()].find((row) => row.address === address);
        const handler = (walletApi.tools["001"].counterparty as any).validate_route({
          isPayAddressKnown: (check: string) => check === invoice?.address,
          getUrls: () => invoice ? { successUrl: `${origin}/return?checkoutId=${invoice.id}`, handoverUrl: `${origin}/handover?checkoutId=${invoice.id}` } : {},
        });
        return handler(req);
      }
      if (url.pathname === "/return") {
        return new Response("<!doctype html><title>001 handover return</title><p>payment handover</p>", { headers: { "Content-Type": "text/html", "Set-Cookie": `handover-session=${id}; Path=/; SameSite=Strict` } });
      }
      if (url.pathname === "/handover" && req.method === "POST") {
        const invoice = invoices.get(id);
        if (!invoice) return Response.json({ ok: false, error: "unknown checkout" }, { status: 404 });
        const body = await req.clone().json();
        requests.push({ id, origin: req.headers.get("origin"), referer: req.headers.get("referer"),
          cookie: (req.headers.get("cookie") || "").split(/;\s*/).find((part) => part.startsWith("handover-session=")), body });
        invoice.attempts++;
        const handler = (walletApi.tools["001"].counterparty as any).execute_route({
          node_url: invoice.scenario === "node-failure" && invoice.attempts === 1 ? "http://127.0.0.1:1" : REGTEST_NODE,
          primary_address: merchant.view_key.mainnet_primary,
          view_key: merchant.view_key.view_key,
          checkPayment: (scan: any) => scan.outputs
            .filter((out: any) => out.payment_id === String(invoice.paymentId))
            .reduce((sum: bigint, out: any) => sum + BigInt(out.amount), 0n) >= 100000000000n,
          onAccepted: (scan: any) => {
            if (!receipts.has(scan.tx_hash)) receipts.set(scan.tx_hash, { tx_hash: scan.tx_hash, count: 1 });
          },
        });
        const response = await handler(req);
        const result = await response.clone().json();
        requests.at(-1).result = result;
        await save();
        if (invoice.scenario === "lost-reply" && invoice.attempts === 1 && result.ok) return Response.json({ ok: false, tx_hash: result.tx_hash, error: "test lost reply" }, { status: 503 });
        return response;
      }
      return new Response("not found", { status: 404 });
    },
  });
  origin = `http://127.0.0.1:${server.port}`;
  startUrl = `${origin}/newsession`;
  const wait = async (check: () => Promise<any>, label: string, ms = 30000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      const result = await check();
      if (result) return result;
      await Bun.sleep(100);
    }
    throw new Error("handover timeout: " + label);
  };
  const returnTabs = async () => (await send("Target.getTargets")).targetInfos
    .filter((row: any) => String(row.url || "").startsWith(origin) && String(row.url || "").includes("/return")).length;
  const state = (id: string) => panel(`(() => { const x = window.wallets.actionLogOpened.invocations().find(x => x.invocationId === ${JSON.stringify(id)}); return x ? { ...JSON.parse(JSON.stringify(x, (_k,v) => typeof v === "bigint" ? String(v) : v)), status: x.status } : null; })()`);
  const handover = (row: any) => [...(row?.events ?? [])].reverse().find((event: any) => event.handover)?.handover;
  const lastResult = (row: any) => [...(row?.events ?? [])].reverse().find((event: any) => event.type === "execute_result");
  const background = await targetByUrl("background.html");
  const backgroundSession = (await send("Target.attachToTarget", { targetId: background.id, flatten: true })).sessionId;
  await send("Fetch.enable", { patterns: [{ urlPattern: REGTEST_NODE + "/send_raw_transaction", requestStage: "Request" }] }, backgroundSession);
  const releasePayer = async () => {
    for (const held of heldPayerRequests) {
      if (held.released) continue;
      await send("Fetch.continueRequest", { requestId: held.requestId }, held.sessionId);
      held.released = true;
    }
  };
  const clickInTarget = async (targetId: string, element: string) => {
    await send("Target.activateTarget", { targetId });
    const s = await send("Target.attachToTarget", { targetId, flatten: true });
    const box = await send("Runtime.evaluate", { expression: `(() => { const el = document.getElementById(${JSON.stringify(element)}); if (!el) return null; el.scrollIntoView({block:"center"}); const b = el.getBoundingClientRect(); return {x:b.x+b.width/2,y:b.y+b.height/2}; })()`, returnByValue: true }, s.sessionId);
    if (!box.result?.value) throw new Error("missing handover button " + element);
    const { x, y } = box.result.value;
    await send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 }, s.sessionId);
    await send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 }, s.sessionId);
  };
  try {
    const scenarios = (process.env.HANDOVER_SCENARIOS || "success,lost-reply,node-failure").split(",") as typeof scenario[];
    for (scenario of scenarios) {
      // a sparse regtest chain can fail to build a decoy ring. mine and pay again.
      let sourceTab = "";
      let invocationId = "";
      let tabsBefore = -1;
      for (let attempt = 0; attempt < 3; attempt++) {
        sourceTab = await drivePayment("handover-" + scenario);
        invocationId = await panel(`window.wallets.actionLogOpened.getActiveByPermissions(["spend"])[0].invocationId`);
        if (scenario !== "success") await send("Target.closeTarget", { targetId: sourceTab }).catch(() => {});
        // hold only the payer's browser request. the merchant's node request stays real.
        tabsBefore = await returnTabs();
        const heldBefore = heldPayerRequests.length;
        await openAndArm("handover-" + scenario);
        const beforeReply = await wait(async () => {
          const current = await state(invocationId);
          if (current?.lastType === "execute_result" && current.ok === false) return { buildFailed: current };
          const post = requests.find((item) => item.id === String(serial) && item.result);
          const held = heldPayerRequests[heldBefore];
          return post && held ? { post, held, current } : null;
        }, scenario + " merchant POST before payer reply");
        if (!beforeReply.buildFailed) {
          if (beforeReply.held.released || beforeReply.current.lastType !== "execute_start") throw new Error("payer request was not held during handover");
          if (beforeReply.post.body.tx_as_hex !== beforeReply.held.tx_as_hex) throw new Error("merchant received different signed bytes");
          await Bun.write(join(shotDir, "signing-order-" + scenario + ".json"), JSON.stringify({
            invocationId, payerRequestHeld: true, merchantReceivedSameBytes: true,
            merchantResult: beforeReply.post.result, payerResultNotWritten: true,
          }, null, 2));

          console.log("PASS " + scenario + " merchant received signed transaction while payer request was held");
        }
        await releasePayer();
        const sent = beforeReply.buildFailed || await wait(async () => {
          const current = await state(invocationId);
          return current?.lastType === "execute_result" ? current : null;
        }, scenario + " send result");
        // sent: a node has the transaction. with a failed handover the result is not ok, and that is the case under test.
        if (lastResult(sent)?.sent === true) break;
        const error = String([...(sent.events ?? [])].reverse().find((event: any) => event.error)?.error || "");
        if (!/decoy|make Input/i.test(error) || attempt === 2) throw new Error(scenario + " send failed: " + error);
        console.log(scenario, "decoy ring failed, mining 60");
        await mineTo(DECOY, 60);
      }
      let row = await wait(async () => {
        const current = await state(invocationId);
        const result = handover(current);
        return result && (result.ok === true || scenario !== "success") ? current : null;
      }, scenario + " handover result");
      // the open source page must be used. a closed one must get a fresh merchant tab.
      const tabsAfter = await returnTabs();
      if (scenario === "success" && tabsAfter !== tabsBefore) throw new Error("handover opened a tab although the source page was open");
      if (scenario !== "success" && tabsAfter !== tabsBefore + 1) throw new Error("handover did not open a merchant tab for the closed source page");
      console.log(scenario, "handover source:", scenario === "success" ? "open page" : "new tab");
      if (scenario === "success" && (row.ok !== true || row.status !== "done")) throw new Error("a delivered payment is not done: " + JSON.stringify(lastResult(row)));
      if (scenario === "success") await shotTarget((await targetByUrl("sidebar.html")).id, "handover-accepted");
      if (scenario !== "success") {
        const txHash = handover(row).tx_hash;
        // the payer sent the transaction but the merchant did not confirm the handover.
        if (row.ok !== false || lastResult(row)?.sent !== true || row.status !== "failed") throw new Error("a failed handover is not a failed call that says sent: " + JSON.stringify(lastResult(row)));
        await send("Target.activateTarget", { targetId: (await targetByUrl("sidebar.html")).id }).catch(() => {});
        const plateHint = await wait(async () => {
          const text = await panel(`document.querySelector(".executed-hint")?.innerText ?? ""`);
          return String(text).includes("transaction sent, merchant receipt unconfirmed") && await panel(`!!document.getElementById("retryHandover")`) ? text : null;
        }, scenario + " hint in the send plate");
        if (String(plateHint).includes("tool call executed")) throw new Error("the send plate says executed for a failed handover");
        await shotTarget((await targetByUrl("sidebar.html")).id, "handover-failed-plate-" + scenario);
        await mineTo(DECOY, 12);
        const logUrl = (await targetByUrl("sidebar.html")).url.replace(/sidebar\.html.*$/, `actionlog.html#/invo/${invocationId}`);
        const target = await send("Target.createTarget", { url: logUrl });
        const attached = await send("Target.attachToTarget", { targetId: target.targetId, flatten: true });
        await send("Page.enable", {}, attached.sessionId);
        await send("Page.reload", {}, attached.sessionId);
        await wait(async () => {
          const read = await send("Runtime.evaluate", { expression: '!!document.getElementById("retry-handover")', returnByValue: true }, attached.sessionId).catch(() => null);
          return read?.result?.value;
        }, "retry button after action log reload");
        const pageText = (await send("Runtime.evaluate", { expression: "document.body.innerText", returnByValue: true }, attached.sessionId)).result?.value ?? "";
        if (!String(pageText).includes("transaction sent, merchant receipt unconfirmed") || !/\bfailed\b/.test(String(pageText))) throw new Error("the action log page has no failed-handover hint: " + pageText);
        await shotTarget(target.targetId, "handover-failed-" + scenario);
        const beforeRetryTabs = await returnTabs();
        // one case uses the retry of the action log page, the other the retry of the send plate
        if (scenario === "lost-reply") await clickInTarget(target.targetId, "retry-handover");
        else {
          await send("Target.activateTarget", { targetId: (await targetByUrl("sidebar.html")).id }).catch(() => {});
          await Bun.sleep(500);
          await panelClick("retryHandover");
        }
        row = await wait(async () => {
          const current = await state(invocationId);
          return handover(current)?.ok === true ? current : null;
        }, scenario + " retry");
        if (row.ok !== true || row.status !== "done" || lastResult(row)?.sent !== true) throw new Error("an accepted retry did not make the call done: " + JSON.stringify(lastResult(row)));
        await send("Target.activateTarget", { targetId: (await targetByUrl("sidebar.html")).id }).catch(() => {});
        await wait(async () => (await panel(`document.querySelector(".executed-hint")?.innerText ?? ""`)).includes("tool call executed"), scenario + " hint after the retry");
        await shotTarget((await targetByUrl("sidebar.html")).id, "handover-retried-plate-" + scenario);
        if (await returnTabs() !== beforeRetryTabs) throw new Error("retry opened another tab although the merchant return page was open");
        if (handover(row).tx_hash !== txHash) throw new Error("retry changed the transaction");
      }
      const rows = requests.filter((item) => item.id === String(serial));
      if (rows.length !== (scenario === "success" ? 1 : 2)) throw new Error("wrong handover attempt count");
      if (rows.some((item) => item.origin !== origin || !item.cookie?.includes(`handover-session=${serial}`))) throw new Error("handover did not use the merchant page");
      const expectedPage = `${origin}/${scenario === "success" ? "checkout" : "return"}?checkoutId=${serial}`;
      if (rows.some((item) => item.referer !== expectedPage)) throw new Error("handover ran outside the expected merchant page");
      if (rows.some((item) => item.body.tx_as_hex !== rows[0].body.tx_as_hex)) throw new Error("retry used new transaction bytes");
      if (rows.at(-1).result?.ok !== true || rows.at(-1).result?.tx_hash !== handover(row).tx_hash) throw new Error("merchant did not accept the exact transaction");
      const nodeState = await fetch(REGTEST_NODE + "/get_transactions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ txs_hashes: [handover(row).tx_hash] }) }).then((r) => r.json());
      if (nodeState.txs?.[0]?.in_pool !== (scenario === "success")) throw new Error("unexpected node state: " + JSON.stringify(nodeState));
      const txLogCount = await panel(`window.wallets.wallets.flatMap(w => w.tx_logs).filter(row => row.invocationId === ${JSON.stringify(invocationId)}).length`);
      if (txLogCount !== 1) throw new Error("retry created another payment");
      if (receipts.get(handover(row).tx_hash)?.count !== 1) throw new Error("payment was not recorded once");
      await Bun.write(join(shotDir, "handover-" + scenario + ".json"), JSON.stringify({ invocationId, tx_hash: handover(row).tx_hash, nodeState: nodeState.txs?.[0] }, null, 2));
      await save();
      console.log("PASS 001 handover " + scenario + ": exact signed transaction, one payment, one receipt");
      if (scenario === "success") await mineTo(DECOY, 12);
    }
  } finally {
    await releasePayer().catch(() => {});
    await send("Fetch.disable", {}, backgroundSession).catch(() => {});
    await save();
    server.stop(true);
  }
}

await handoverAcceptance();
ws.close();
process.exit(0);
