import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { cdp, debugHttp, targetByUrl } from "./cdp";
import { ensureHealthyWallet, mineTo, nodeHeight, shopPaymentLinkId } from "./setup";

// Run a real payment on the offline regtest chain. Use CDP input events for UI actions.
// Needs two wallet routes. test/browser-002.ts can add the second route.
// Usage: bun test/browser-actionlog-eta.ts
const NODE = "http://127.0.0.1:18081";
const DECOY = "47cYSGSjzWPX3KFEN9PaxT5zpWKgRtx568bazbGzt57ffBbUAQevjMk19sfZCrMB1RWHNJLbz1eKU63B77HpHwUVA6JGudr";
const runId = process.env.RUN_ID || new Date().toISOString().replace(/[:.]/g, "-");
if (!/^[a-zA-Z0-9_-]+$/.test(runId)) throw new Error("invalid run id");
const out = join("testdata/actionlog-eta-runs", runId);
mkdirSync(out, { recursive: true });
await ensureHealthyWallet();
const info = await fetch(`${NODE}/get_info`).then((response) => response.json());
if (info.nettype !== "fakechain" || !info.offline) throw new Error("refuse to test outside offline regtest");

const errors: string[] = [];
const { ws, send } = await cdp((event) => {
  if (event.method === "Runtime.exceptionThrown")
    errors.push(event.params?.exceptionDetails?.exception?.description || event.params?.exceptionDetails?.text || "page exception");
});
const sessions = new Map<string, string>();
const checks: { name: string; detail: unknown }[] = [];
const state: Record<string, unknown> = { runId };

async function session(targetId: string): Promise<string> {
  let id = sessions.get(targetId);
  if (!id) {
    id = (await send("Target.attachToTarget", { targetId, flatten: true })).sessionId;
    if (!id) throw new Error("no CDP session");
    sessions.set(targetId, id);
    await send("Runtime.enable", {}, id);
  }
  return id;
}
async function evaluate(targetId: string, expression: string): Promise<any> {
  const result = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }, await session(targetId));
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  return result.result?.value;
}
async function wait<T>(label: string, read: () => Promise<T>, accept: (value: T) => boolean, timeoutMs = 60000): Promise<T> {
  const start = Date.now();
  let last: T | undefined;
  while (Date.now() - start < timeoutMs) {
    last = await read();
    if (accept(last)) return last;
    await Bun.sleep(250);
  }
  throw new Error(`timeout: ${label}; last=${JSON.stringify(last)}`);
}
async function activate(targetId: string) {
  await send("Target.activateTarget", { targetId });
  await Bun.sleep(300);
}
async function click(targetId: string, selector: string) {
  await wait("click target ready: " + selector, () => evaluate(targetId, `(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    return !!element && (element.tagName === "A" || typeof element.onclick === "function");
  })()`), Boolean);
  await evaluate(targetId, `document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block: "center", behavior: "instant"})`);
  // A scan update can replace a history row. Wait for its layout and handler before clicking.
  await Bun.sleep(200);
  const box = await evaluate(targetId, `(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!element) return null;
    const box = element.getBoundingClientRect();
    return box.width && box.height ? {x: box.x + box.width / 2, y: box.y + box.height / 2} : null;
  })()`);
  if (!box) throw new Error(`no visible element: ${selector}`);
  const id = await session(targetId);
  await send("Input.dispatchMouseEvent", { type: "mousePressed", ...box, button: "left", clickCount: 1 }, id);
  await send("Input.dispatchMouseEvent", { type: "mouseReleased", ...box, button: "left", clickCount: 1 }, id);
  await Bun.sleep(300);
}
async function screenshot(targetId: string, name: string) {
  await activate(targetId);
  const image = await send("Page.captureScreenshot", { format: "png" }, await session(targetId));
  await Bun.write(join(out, `${name}.png`), Buffer.from(image.data, "base64"));
}
function check(name: string, ok: boolean, detail: unknown = "") {
  if (!ok) throw new Error(`${name}: ${JSON.stringify(detail)}`);
  checks.push({ name, detail });
  console.log("PASS", name, typeof detail === "string" ? detail : JSON.stringify(detail));
}
async function eta(targetId: string, selector: string, currentHeight: number, expectedHeight: number, name: string) {
  const blocks = expectedHeight - currentHeight;
  const expected = `~${blocks * 2} min (${blocks} ${blocks === 1 ? "block" : "blocks"} left; height ${currentHeight} to ${expectedHeight})`;
  const text = await wait(name, () => evaluate(targetId, `document.querySelector(${JSON.stringify(selector)})?.innerText ?? ""`), (text) => text.includes(expected));
  check(name, text.includes(expected), expected);
}

let panelId = "";
let logId = "";
try {
  panelId = (await targetByUrl("sidebar.html")).id;
  const panel = (expression: string) => evaluate(panelId, expression);
  check("wallet uses regtest", await panel("window.wallets.node_url") === NODE);
  const wallets: { address: string; route: string }[] = await panel(`window.wallets.wallets.map(wallet => ({address: wallet.primary_address, route: wallet.wallet_route}))`);
  check("two wallet routes are available", wallets.length >= 2, wallets.map((wallet) => wallet.route));
  const primary = wallets[0]!;
  const other = wallets[1]!;
  state.wallet = primary.address;

  for (const target of await fetch(debugHttp() + "/json/list").then((response) => response.json())) {
    if (target.url?.includes("actionlog.html")) await send("Target.closeTarget", { targetId: target.id });
  }
  await activate(panelId);
  if (await panel("window.activeWalletPlate") !== "wallets") await click(panelId, "#wallets");
  await click(panelId, `a.wallet-route-link[href=${JSON.stringify("#/" + primary.route)}]`);
  await panel(`(async () => { for (const row of window.wallets.actionLogOpened.getActiveByPermissions(["spend"])) await window.wallets.actionLogOpened.dismiss(row.invocationId); })()`);

  const poolBefore = new Set<string>((await fetch(`${NODE}/get_transaction_pool`).then((response) => response.json())).transactions?.map((tx: any) => tx.id_hash) ?? []);
  const checkoutId = (await send("Target.createTarget", { url: `http://127.0.0.1:3003/pay/${shopPaymentLinkId()}` })).targetId;
  await activate(checkoutId);
  await wait("checkout payment link", () => evaluate(checkoutId, `!!document.querySelector("a.pay-button")`), Boolean);
  await click(checkoutId, "a.pay-button");
  const invocationId = await wait<string>("payment tool call", () => panel(`window.wallets.actionLogOpened.getActiveByPermissions(["spend"])[0]?.invocationId ?? ""`), Boolean);
  state.invocationId = invocationId;
  await activate(panelId);
  if (!await panel("window.unlocked")) await click(panelId, "#fire");
  await wait("send button", () => panel(`!!document.querySelector("#send-action.action-button")`), Boolean);
  await click(panelId, "#send-action");
  await wait("successful send", () => panel(`(() => {
    const row = window.wallets.actionLogOpened.invocations().find(row => row.invocationId === ${JSON.stringify(invocationId)});
    return {type: row?.lastType, ok: row?.ok, error: row?.error};
  })()`), (row) => {
    if (row.type === "execute_result" && row.ok === false) throw new Error("send failed: " + row.error);
    return row.type === "execute_result" && row.ok === true;
  }, 120000);
  const txHash = await wait<string>("new transaction in pool", async () => {
    const pool = await fetch(`${NODE}/get_transaction_pool`).then((response) => response.json());
    return pool.transactions?.find((tx: any) => !poolBefore.has(tx.id_hash))?.id_hash ?? "";
  }, Boolean);
  state.txHash = txHash;
  check("real payment is in the node pool", !!txHash, txHash);
  const inputId: string = await panel(`window.wallets.wallets[0].tx_logs.find(log => log.invocationId === ${JSON.stringify(invocationId)}).inputs_index[0]`);
  const poolHeight = await nodeHeight();

  await click(panelId, "#history");
  await wait("pending history row", () => panel(`!!document.getElementById(${JSON.stringify("inputId0-" + inputId)})`), Boolean);
  await click(panelId, `#inputId0-${inputId}`);
  await eta(panelId, `#inputId0-${inputId}-details`, poolHeight, poolHeight + 10, "history pool ETA");
  await screenshot(panelId, "01-history-pool");
  await click(panelId, `#log-pre-${inputId}`);
  logId = await wait<string>("action log tab", async () => (await fetch(debugHttp() + "/json/list").then((response) => response.json())).find((target: any) => target.url?.includes("actionlog.html"))?.id ?? "", Boolean);
  await activate(logId);
  await eta(logId, ".log-page", poolHeight, poolHeight + 10, "tool 001 pool ETA");
  check("new action log defaults to selected wallet", await evaluate(logId, "new URLSearchParams(location.search).get('wallet')") === primary.address);
  await screenshot(logId, "02-tool-001-pool");
  await click(logId, "#open-txlog");
  await eta(logId, ".log-page", poolHeight, poolHeight + 10, "txlog detail pool ETA");
  await screenshot(logId, "03-txlog-pool");

  async function chooseWallet(address: string) {
    const index: number = await evaluate(logId, `(() => {
      const select = document.getElementById("log-wallet");
      select.focus();
      return [...select.options].findIndex(option => option.value === ${JSON.stringify(address)});
    })()`);
    if (index < 0) throw new Error("wallet option is missing");
    const id = await session(logId);
    for (const key of ["Home", ...Array(index).fill("ArrowDown")]) {
      await send("Input.dispatchKeyEvent", { type: "keyDown", key, code: key, windowsVirtualKeyCode: key === "Home" ? 36 : 40 }, id);
      await send("Input.dispatchKeyEvent", { type: "keyUp", key, code: key, windowsVirtualKeyCode: key === "Home" ? 36 : 40 }, id);
    }
    await wait("wallet selection", () => evaluate(logId, `document.getElementById("log-wallet")?.value`), (value) => value === address);
    await Bun.sleep(150);
  }
  const callSelector = `#row-${invocationId}`;
  await click(logId, "#log-home");
  await wait("wallet options", () => evaluate(logId, `document.getElementById("log-wallet")?.options.length ?? 0`), (length) => length >= 3);
  check("dropdown default is the selected wallet", await evaluate(logId, `document.getElementById("log-wallet").value`) === primary.address);
  const labels: string[] = await evaluate(logId, `[...document.getElementById("log-wallet").options].map(option => option.text)`);
  const expectedLabels = ["all wallets", ...wallets.filter((wallet) => wallet.route).map((wallet) => wallet.route)];
  check("selector shows only current wallet routes", JSON.stringify(labels) === JSON.stringify(expectedLabels), labels);
  const layout = await evaluate(logId, `(() => {
    const select = document.getElementById("log-wallet");
    const tab = document.getElementById("log-tab-txlog");
    const a = tab.getBoundingClientRect();
    const b = select.getBoundingClientRect();
    return {nextToTab: select.parentElement === tab.parentElement && b.left >= a.right && Math.abs(a.top - b.top) < 2,
      visibleLabel: !!document.querySelector('label[for="log-wallet"]'), accessibleLabel: select.getAttribute("aria-label")};
  })()`);
  check("selector is next to txlog with no visible label", layout.nextToTab && !layout.visibleLabel && layout.accessibleLabel === "wallet", layout);
  await chooseWallet(other.address);
  check("other wallet hides the payment call", !await evaluate(logId, `!!document.querySelector(${JSON.stringify(callSelector)})`));
  await chooseWallet("");
  check("all wallets shows the payment call", await evaluate(logId, `!!document.querySelector(${JSON.stringify(callSelector)})`));
  await chooseWallet(other.address);
  await click(logId, "#log-tab-success");
  check("success tab keeps the wallet filter", !await evaluate(logId, `!!document.querySelector(${JSON.stringify(callSelector)})`));
  await click(logId, "#log-tab-txlog");
  check("txlog rows belong to the selected wallet only", await evaluate(logId, `(() => {
    const rows = [...document.querySelectorAll('[id^="txlog-"]')];
    return rows.every(row => !row.innerText.includes(${JSON.stringify(primary.address.slice(0, 12))}));
  })()`));
  await chooseWallet(primary.address);
  await eta(logId, ".log-page", poolHeight, poolHeight + 10, "txlog list pool ETA");
  await chooseWallet(other.address);
  await screenshot(logId, "04-wallet-filter");

  await activate(panelId);
  await click(panelId, `#log-pre-${inputId}`);
  await activate(logId);
  await click(logId, "#log-home");
  check("filter survives a tool-call visit", await evaluate(logId, `document.getElementById("log-wallet").value`) === other.address);
  await send("Target.closeTarget", { targetId: logId });
  await activate(panelId);
  await click(panelId, "#wallets");
  await click(panelId, `a.wallet-route-link[href=${JSON.stringify("#/" + other.route)}]`);
  await click(panelId, "#openActionLog");
  logId = await wait<string>("new action log", async () => (await fetch(debugHttp() + "/json/list").then((response) => response.json())).find((target: any) => target.url?.includes("actionlog.html"))?.id ?? "", Boolean);
  await activate(logId);
  await wait("new wallet default", () => evaluate(logId, `document.getElementById("log-wallet")?.value`), (value) => value === other.address);
  await chooseWallet(primary.address);
  await send("Target.closeTarget", { targetId: logId });
  await activate(panelId);
  await click(panelId, "#openActionLog");
  logId = await wait<string>("reopened action log", async () => (await fetch(debugHttp() + "/json/list").then((response) => response.json())).find((target: any) => target.url?.includes("actionlog.html"))?.id ?? "", Boolean);
  await activate(logId);
  await wait("reset wallet default", () => evaluate(logId, `document.getElementById("log-wallet")?.value`), (value) => value === other.address);
  check("close and reopen resets filter to the sidebar wallet", true, other.route);
  await screenshot(logId, "05-reopened-wallet-default");

  await activate(panelId);
  await click(panelId, `a.wallet-route-link[href=${JSON.stringify("#/" + primary.route)}]`);
  await click(panelId, "#history");
  await mineTo(DECOY, 1);
  const mined = await wait("transaction mined", async () => {
    const result = await fetch(`${NODE}/get_transactions`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ txs_hashes: [txHash] }) }).then((response) => response.json());
    return result.txs?.[0];
  }, (tx) => !!tx && tx.in_pool === false);
  const expectedHeight = mined.block_height + 10;
  state.minedHeight = mined.block_height;
  state.expectedHeight = expectedHeight;
  await activate(panelId);
  await wait("mined history row", () => panel(`!!document.getElementById(${JSON.stringify(txHash)})`), Boolean);
  await click(panelId, `[id=${JSON.stringify(txHash)}]`);
  await eta(panelId, `[id=${JSON.stringify(txHash + "-details")}]`, await nodeHeight(), expectedHeight, "history mined ETA");
  await screenshot(panelId, "06-history-mined");
  await click(panelId, `[id=${JSON.stringify("log-" + txHash)}]`);
  await activate(logId);
  await eta(logId, ".log-page", await nodeHeight(), expectedHeight, "tool 001 mined ETA");
  await click(logId, "#open-txlog");
  await eta(logId, ".log-page", await nodeHeight(), expectedHeight, "txlog mined ETA");
  await screenshot(logId, "07-txlog-mined");

  await mineTo(DECOY, 3);
  await activate(panelId);
  await eta(panelId, `[id=${JSON.stringify(txHash + "-details")}]`, await nodeHeight(), expectedHeight, "history ETA falls after three blocks");
  await activate(logId);
  await eta(logId, ".log-page", await nodeHeight(), expectedHeight, "txlog ETA updates without reload");
  await click(logId, "#open-tool-call");
  await eta(logId, ".log-page", await nodeHeight(), expectedHeight, "tool 001 ETA falls after three blocks");
  await screenshot(logId, "08-tool-001-countdown");

  const blocksLeft = expectedHeight - await nodeHeight();
  if (blocksLeft > 0) await mineTo(DECOY, blocksLeft);
  await activate(panelId);
  await wait("confirmed wallet transaction", () => panel(`window.wallets.wallets[0].transactions.find(tx => tx.tx_hash === ${JSON.stringify(txHash)})?.status.status`), (status) => status === "spendable");
  const historyText: string = await panel(`document.getElementById(${JSON.stringify(txHash + "-details")})?.innerText ?? ""`);
  check("confirmed history no longer shows ETA", historyText.includes("confirmed:") && !historyText.includes("ETA:"));
  await screenshot(panelId, "09-history-confirmed");
  await activate(logId);
  await wait("confirmed tool call has no ETA", () => evaluate(logId, `document.querySelector('.log-page')?.innerText ?? ''`), (text) => !text.includes("confirmation ETA:"));
  check("confirmed tool 001 no longer shows ETA", true);
  await click(logId, "#open-txlog");
  check("confirmed txlog no longer shows ETA", !await evaluate(logId, `document.querySelector('.log-page').innerText.includes('confirmation ETA:')`));
  await screenshot(logId, "10-txlog-confirmed");
  check("no page exceptions", errors.length === 0, errors);
  await Bun.write(join(out, "result.json"), JSON.stringify({ ...state, checks, errors, passed: true }, null, 2));
  console.log(`PASS browser action log and ETA: ${checks.length} checks; evidence ${out}`);
} catch (error) {
  const failureShots: [string, string][] = [["failure-sidebar", panelId], ["failure-actionlog", logId]];
  for (const [name, targetId] of failureShots) {
    if (!targetId) continue;
    await screenshot(targetId, name).catch(() => {});
    await Bun.write(join(out, name + ".txt"), String(await evaluate(targetId, "document.body.innerText").catch(() => "page unavailable")));
  }
  await Bun.write(join(out, "result.json"), JSON.stringify({ ...state, checks, errors, passed: false, error: String(error) }, null, 2));
  throw error;
} finally {
  ws.close();
}
