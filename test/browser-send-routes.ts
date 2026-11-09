import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { cdp, debugHttp, recordTab, targetByUrl } from "./cdp";
import { ensureTwoFundedRoutes, type TestRouteWallet } from "./send-route-setup";
import { mineTo } from "./setup";

// Hold real regtest send requests and switch wallet routes before each result.
// The rejected send gets a local test response and is not broadcast to the node.
// Usage: RUN_ID=send-routes bun test/browser-send-routes.ts
const NODE = "http://127.0.0.1:18081";
const DECOY = "47cYSGSjzWPX3KFEN9PaxT5zpWKgRtx568bazbGzt57ffBbUAQevjMk19sfZCrMB1RWHNJLbz1eKU63B77HpHwUVA6JGudr";
const wallets = await ensureTwoFundedRoutes();
const a = wallets[0]!;
const b = wallets[1]!;
const runId = process.env.RUN_ID || new Date().toISOString().replace(/[:.]/g, "-");
if (!/^[a-zA-Z0-9_-]+$/.test(runId)) throw new Error("invalid run id");
const out = join("testdata/send-route-runs", runId);
mkdirSync(out, { recursive: true });
const held: { requestId: string; sessionId: string; at: number }[] = [];
const heldFees: { requestId: string; sessionId: string }[] = [];
const checks: { name: string; detail: unknown }[] = [];
const checkpoints: unknown[] = [];
const browserErrors: unknown[] = [];
const clicks: unknown[] = [];
const { ws, send } = await cdp((event) => {
  if (event.method === "Runtime.exceptionThrown") browserErrors.push(event.params.exceptionDetails);
  if (event.method !== "Fetch.requestPaused") return;
  if (event.sessionId === panelSession && event.params.request.postData?.includes('"get_fee_estimate"'))
    heldFees.push({ requestId: event.params.requestId, sessionId: event.sessionId! });
  else if (event.sessionId === backgroundSession && event.params.request.url.includes("send_raw_transaction"))
    held.push({ requestId: event.params.requestId, sessionId: event.sessionId!, at: Date.now() });
  else void send("Fetch.continueRequest", { requestId: event.params.requestId }, event.sessionId).catch(() => {});
});
const panel = await targetByUrl("sidebar.html");
const panelSession = (await send("Target.attachToTarget", { targetId: panel.id, flatten: true })).sessionId;
const background = await targetByUrl("background.html");
const backgroundSession = (await send("Target.attachToTarget", { targetId: background.id, flatten: true })).sessionId;
let recording: Awaited<ReturnType<typeof recordTab>> | undefined;
const fixture = Bun.serve({
  port: 0,
  fetch: () => new Response(`<html><body><a id="pay" href="#monerochan001_amount_0.1_address_${DECOY}_no_check">test payment</a></body></html>`, { headers: { "Content-Type": "text/html" } }),
});

async function evaluate(sessionId: string, expression: string): Promise<any> {
  const result = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }, sessionId);
  if (result.exceptionDetails)
    throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  return result.result?.value;
}
const read = (expression: string) => evaluate(panelSession, expression);
async function wait<T>(label: string, load: () => Promise<T>, accept: (value: T) => boolean, timeout = 20000): Promise<T> {
  const start = Date.now();
  let last: T | undefined;
  while (Date.now() - start < timeout) {
    last = await load();
    if (accept(last)) return last;
    await Bun.sleep(100);
  }
  throw new Error(`timeout: ${label}; last=${JSON.stringify(last)}`);
}
function check(name: string, ok: boolean, detail: unknown = "") {
  if (!ok) throw new Error(`${name}: ${JSON.stringify(detail)}`);
  checks.push({ name, detail });
  console.log("PASS", name, JSON.stringify(detail));
}
async function click(sessionId: string, selector: string) {
  await wait("click target " + selector, () => evaluate(sessionId, `(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    return {
      exists:!!element, tag:element?.tagName, width:element?.getBoundingClientRect().width ?? 0,
      clickable:!!element && (element.tagName === "A" || element.tagName === "INPUT" || typeof element.onclick === "function"),
      route:location.hash, plate:window.activeWalletPlate, visibility:document.visibilityState,
      links:[...document.querySelectorAll("a")].map(link=>({href:link.getAttribute("href"),class:link.className})),
    };
  })()`), (state) => state.clickable && state.width > 0);
  await evaluate(sessionId, `document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block: "center", behavior: "instant"})`);
  await Bun.sleep(150);
  const box = await evaluate(sessionId, `(() => {
    const box = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();
    return {x: box.x + box.width / 2, y: box.y + box.height / 2};
  })()`);
  clicks.push({ selector, box, before: await evaluate(sessionId, `({route:location.hash,plate:window.activeWalletPlate,hit:document.elementFromPoint(${box.x},${box.y})?.outerHTML.slice(0,400)})`) });
  for (const type of ["mousePressed", "mouseReleased"])
    await send("Input.dispatchMouseEvent", { type, ...box, button: "left", clickCount: 1 }, sessionId);
  await Bun.sleep(100);
}
async function fill(selector: string, value: string) {
  await click(panelSession, selector);
  await send("Input.dispatchKeyEvent", { type: "keyDown", key: "a", code: "KeyA", windowsVirtualKeyCode: 65, modifiers: 2 }, panelSession);
  await send("Input.dispatchKeyEvent", { type: "keyUp", key: "a", code: "KeyA", windowsVirtualKeyCode: 65, modifiers: 2 }, panelSession);
  await send("Input.insertText", { text: value }, panelSession);
}
async function switchTo(wallet: TestRouteWallet) {
  await send("Target.activateTarget", { targetId: panel.id });
  await send("Page.bringToFront", {}, panelSession);
  if (await read("window.activeWalletPlate") !== "wallets") await click(panelSession, "#wallets");
  await click(panelSession, `a.wallet-route-link[href=${JSON.stringify("#/" + wallet.route)}]`);
  await wait("wallet route", () => read("location.hash"), (hash) => hash === "#/" + wallet.route);
  await click(panelSession, "#send");
  await wait("selected route", () => read(`({route:location.hash,send:typeof document.getElementById("send-action")?.onclick})`), (state) => state.route === "#/" + wallet.route && state.send === "function");
}
async function state() {
  return read(`(() => {
    const params = window.walletRouteParams;
    const route = [params.identity, params.domain, params.wallet_type, params.wallet_slot].join("/");
    const wallet = window.wallets.wallets.find(wallet => wallet.wallet_route === route);
    const log = wallet?.tx_logs.at(-1);
    return {
      route, address:wallet?.primary_address,
      status:document.querySelector(".status-line")?.innerText ?? "",
      hint:document.querySelector(".executed-hint")?.innerText ?? "",
      amount:document.getElementById("amountInput")?.value,
      destination:document.getElementById("addressInput")?.value,
      fee:document.querySelector(".cc-extra")?.innerText,
      log:log ? {timestamp:log.timestamp,status:log.sendResult?.status,error:log.error,hidden:log.hidden_on_send_plate,invocationId:log.invocationId} : null,
    };
  })()`);
}
async function diskLog(wallet: TestRouteWallet) {
  return evaluate(backgroundSession, `(async () => {
    const cache = JSON.parse(await Bun.file(${JSON.stringify(wallet.address + "_cache.json")}).text());
    const log = cache.tx_logs?.at(-1);
    return log ? {timestamp:log.timestamp,status:log.sendResult?.status,error:log.error,hidden:log.hidden_on_send_plate,invocationId:log.invocationId} : null;
  })()`);
}
// the panel keeps its in-memory view mode between runs
async function ensureStandardForm() {
  if (await read(`!!document.getElementById("amountInput")`)) return;
  await read(`document.getElementById("openCoinControlButton")?.onclick?.()`);
  await wait("standard send form", () => read(`!!document.getElementById("amountInput")`), Boolean);
}
async function shot(name: string) {
  await send("Target.activateTarget", { targetId: panel.id });
  await Bun.sleep(250);
  const image = await send("Page.captureScreenshot", { format: "png" }, panelSession);
  await Bun.write(join(out, name + ".png"), Buffer.from(image.data, "base64"));
}
async function checkpoint(name: string, wallet: TestRouteWallet) {
  checkpoints.push({ name, ui: await state(), disk: await diskLog(wallet) });
  await Bun.write(join(out, "checkpoints.json"), JSON.stringify(checkpoints, null, 2));
  await shot(name).catch(() => {});
}
async function expectStatus(wallet: TestRouteWallet, text: string, name: string) {
  const current = await wait(name, state, (value) => value.route === wallet.route && value.status.includes(text), 10000);
  check(name, current.address === wallet.address, current);
}
async function expectEmpty(wallet: TestRouteWallet, name: string) {
  await Bun.sleep(150);
  const current = await state();
  check(name, current.route === wallet.route && current.status === "" && current.hint === "", current);
}
async function beginSend(expectedRequests = 1) {
  check("send uses only regtest", await read("window.wallets.node_url") === NODE);
  await wait("send ready", () => read(`!!document.querySelector("#send-action.action-button")`), Boolean);
  await click(panelSession, "#send-action");
  await wait("held node request", async () => held.length, (count) => count === expectedRequests, 120000);
}
async function release(fail = false) {
  const request = held.shift();
  if (!request) throw new Error("no held request");
  const left = 8000 - (Date.now() - request.at);
  if (left > 0) await Bun.sleep(left);
  if (!fail) {
    await send("Fetch.continueRequest", { requestId: request.requestId }, request.sessionId);
  } else {
    const result = { status: "Failed", reason: "send route test rejection", double_spend:false, fee_too_low:false, invalid_input:false, invalid_output:false, low_mixin:false, not_relayed:true, overspend:false, too_big:false, untrusted:false };
    await send("Fetch.fulfillRequest", {
      requestId: request.requestId, responseCode: 200,
      responseHeaders: [{ name: "Content-Type", value: "application/json" }],
      body: Buffer.from(JSON.stringify(result)).toString("base64"),
    }, request.sessionId);
  }
}
async function feeValue() {
  const text = await read(`document.querySelector(".cc-extra")?.innerText ?? ""`);
  return text.match(/fee estimate:\s*([\d.]+)/)?.[1] ?? "";
}
async function fulfillFee(message: { requestId: string; sessionId: string }, fee: number) {
  await send("Fetch.fulfillRequest", {
    requestId: message.requestId, responseCode: 200,
    responseHeaders: [{ name: "Content-Type", value: "application/json" }],
    body: Buffer.from(JSON.stringify({ id: "0", jsonrpc: "2.0", result: { status: "OK", fee, fees: [fee], quantization_mask: 1 } })).toString("base64"),
  }, message.sessionId);
}
async function checkDelayedSweepFee() {
  check("fee test uses regtest", await read("window.wallets.node_url") === NODE);
  await send("Fetch.enable", { patterns: [{ urlPattern: NODE + "/json_rpc", requestStage: "Request" }] }, panelSession);
  try {
    await click(panelSession, "#openCoinControlButton");
    await click(panelSession, "#cc-sweep");
    await wait("held fee for B", async () => heldFees.length, (count) => count === 1);
    await switchTo(a);
    await click(panelSession, "#cc-sweep");
    await wait("held fee for A", async () => heldFees.length, (count) => count === 2);
    await fulfillFee(heldFees.pop()!, 200);
    await wait("fee for A", feeValue, (value) => value === "0.000002");
    await fulfillFee(heldFees.shift()!, 100);
    await switchTo(b);
    await wait("late fee reaches its original wallet B", feeValue, (value) => value === "0.000001", 3000);
    check("late fee is stored on wallet B", true, await feeValue());
    await shot("fee-result-wallet-b");
    await switchTo(a);
    check("late B fee does not replace A fee", await feeValue() === "0.000002", await feeValue());
    await ensureStandardForm();
    await switchTo(b);
    await click(panelSession, "#openCoinControlButton");
    await ensureStandardForm();
  } finally {
    for (const message of heldFees.splice(0))
      await send("Fetch.continueRequest", { requestId: message.requestId }, message.sessionId).catch(() => {});
    await send("Fetch.disable", {}, panelSession).catch(() => {});
  }
}
async function toolCall(wallet: TestRouteWallet): Promise<string> {
  await switchTo(wallet);
  const targetId = (await send("Target.createTarget", { url: fixture.url.href })).targetId;
  const sessionId = (await send("Target.attachToTarget", { targetId, flatten: true })).sessionId;
  await send("Target.activateTarget", { targetId });
  await click(sessionId, "#pay");
  const id = await wait<string>("tool call", () => read(`window.wallets.actionLogOpened.getActiveByPermissions(["spend"])[0]?.invocationId ?? ""`), Boolean);
  await send("Target.activateTarget", { targetId: panel.id });
  await wait("tool amount", () => read(`document.getElementById("amountInput")?.value`), (value) => value === "0.1");
  return id;
}
async function visit(id: string, name: string) {
  await click(panelSession, "#visitExecuted");
  const url = await wait<string>(name, async () => (await fetch(debugHttp() + "/json/list").then((response) => response.json())).find((target: any) => target.url?.includes("actionlog.html") && target.url.includes(id))?.url ?? "", Boolean);
  check(name, url.includes(id), id);
  await send("Target.activateTarget", { targetId: panel.id });
  await Bun.sleep(200);
}

try {
  for (const [name, sessionId] of [["sidebar", panelSession], ["background", backgroundSession]] as const) {
    const html = await Bun.file(`dist/chrome/${name}.html`).text();
    const expected = html.match(/src="\.\/([^\"]+)"/)?.[1];
    const loaded = await evaluate(sessionId, "document.scripts[0]?.src ?? ''");
    check(name + " uses the current build", !!expected && loaded.endsWith("/" + expected), { expected, loaded });
  }
  await send("Runtime.enable", {}, panelSession);
  await send("Runtime.enable", {}, backgroundSession);
  recording = await recordTab("sidebar.html", join(out, "slow-route-notifications.mp4"));
  await read(`(async () => { for (const row of window.wallets.actionLogOpened.getActiveByPermissions(["spend"])) await window.wallets.actionLogOpened.dismiss(row.invocationId); })()`);
  for (const wallet of [a, b]) {
    await switchTo(wallet);
    if (await read(`!!document.getElementById("dismissExecuted")`)) await click(panelSession, "#dismissExecuted");
    if (await read(`!!document.getElementById("dismissStatus")`)) await click(panelSession, "#dismissStatus");
  }
  await switchTo(b);
  await ensureStandardForm();
  if (!await read("window.unlocked")) await click(panelSession, "#fire");
  await checkDelayedSweepFee();
  await send("Fetch.enable", { patterns: [{ urlPattern: NODE + "/*send_raw_transaction*", requestStage: "Request" }] }, backgroundSession);

  await switchTo(b);
  await fill("#amountInput", "0.1");
  await fill("#addressInput", DECOY);
  await beginSend();
  await checkpoint("non-first-wallet-pending", b);
  await expectStatus(b, "sent tx to node", "non-first wallet shows the held send immediately");
  for (let index = 0; index < 3; index++) {
    await switchTo(a);
    await expectEmpty(a, "other route hides pending message " + index);
    await switchTo(b);
    await expectStatus(b, "sent tx to node", "pending message returns to its route " + index);
  }
  await switchTo(a);
  await fill("#amountInput", "0.25");
  await fill("#addressInput", DECOY);
  await Bun.sleep(Math.max(0, 12_000 - (Date.now() - held[0]!.at)));
  const connected = await read(`({ connected:window.wallets.connectionStatusOpened.isConnected, warning:document.querySelector(".connection-warning")?.innerText ?? "", status:window.connectionStatus })`);
  await checkpoint("held-send-after-12-seconds", b);
  check("a held send does not show node disconnected after 12 seconds", connected.connected && !connected.warning.includes("no connection"), connected);
  await beginSend(2);
  check("another wallet can send before the first node answer", held.length === 2);
  await fill("#amountInput", "0.26");
  await fill("#addressInput", DECOY);
  await click(panelSession, "#openCoinControlButton");
  await wait("coin control during pending sends", () => read(`!!document.querySelector('input[id^="cc-amt-"]')`), Boolean);
  await fill('input[id^="cc-amt-"]', "0.42");
  await release();
  await wait("non-first send accepted", () => diskLog(b), (log) => log?.status === "OK");
  await expectStatus(a, "sent tx to node", "another route keeps its own pending send");
  check("other route coin control draft survives send completion", await read(`document.querySelector('input[id^="cc-amt-"]')?.value`) === "0.42");
  await release();
  await wait("overlapping first route send accepted", () => diskLog(a), (log) => log?.status === "OK");
  check("a new coin control draft survives its own earlier send completion", await read(`document.querySelector('input[id^="cc-amt-"]')?.value`) === "0.42");
  await ensureStandardForm();
  check("new standard draft survives earlier send completion", (await state()).amount === "0.42", await state());
  await switchTo(b);
  await expectStatus(b, "successfully sent transaction", "non-first success arrives without mining a block");
  check("manual send has no tool-call hint", (await state()).hint === "");
  await checkpoint("non-first-wallet-success", b);
  await mineTo(DECOY, 10);

  const aId = await toolCall(a);
  await beginSend();
  await expectStatus(a, "sent tx to node", "first route shows its held tool send");
  await switchTo(b);
  await expectStatus(b, "successfully sent transaction", "other route keeps its own earlier result");
  check("tool-call hint does not leak to another route", (await state()).hint === "", await state());
  await release();
  await wait("first route send accepted", () => diskLog(a), (log) => log?.status === "OK");
  await expectStatus(b, "successfully sent transaction", "first route completion does not replace the other result");
  await switchTo(a);
  await expectStatus(a, "successfully sent transaction", "first route success is visible");
  await visit(aId, "first route visit opens its own tool call");
  await switchTo(b);
  await click(panelSession, "#reset-send");
  await wait("reset hides only non-first result", state, (value) => value.status === "");
  await switchTo(a);
  await expectStatus(a, "successfully sent transaction", "reset on another route leaves this result visible");

  const bId = await toolCall(b);
  await beginSend();
  await expectStatus(b, "sent tx to node", "new send appears after the old result was reset");
  await switchTo(a);
  await expectStatus(a, "successfully sent transaction", "first route stays unchanged while second send is held");
  await visit(aId, "first route keeps its earlier tool-call link");
  await release(true);
  await wait("test rejection recorded", () => diskLog(b), (log) => !!log?.error && log.status === "Failed");
  await expectStatus(a, "successfully sent transaction", "other route failure does not replace this success");
  await switchTo(b);
  await expectStatus(b, "failed to send transaction", "non-first route shows its own failure");
  await visit(bId, "non-first route visit opens its own failed tool call");
  await checkpoint("non-first-wallet-failure", b);
  await click(panelSession, "#dismissStatus");
  await wait("failure dismissed", state, (value) => value.status === "");
  await click(panelSession, "#dismissExecuted");
  await wait("tool hint dismissed", state, (value) => value.hint === "");
  await switchTo(a);
  await expectStatus(a, "successfully sent transaction", "dismissing another route leaves this success visible");
  check("dismissing another route leaves this tool hint visible", (await state()).hint.includes("tool call executed"));
  await visit(aId, "dismiss on other route does not change this tool-call link");
  await switchTo(b);
  await expectEmpty(b, "dismissed messages stay hidden after switching back");
  check("dismissal is stored only for its wallet", (await diskLog(b)).hidden === true && (await diskLog(a)).hidden !== true);
  await switchTo(a);
  await click(panelSession, "#dismissStatus");
  await click(panelSession, "#dismissExecuted");
  await wait("first route dismissed", state, (value) => value.status === "" && value.hint === "");
  check("first route messages can also be dismissed", true);
  // a fresh failure on the non-first route, standard form, kept visible for rebroadcast
  await switchTo(b);
  await ensureStandardForm();
  await fill("#amountInput", "0.11");
  await fill("#addressInput", DECOY);
  await beginSend();
  await release(true);
  await wait("fresh rejection recorded", () => diskLog(b), (log) => log?.status === "Failed" && !log.hidden);
  await expectStatus(b, "failed to send transaction", "fresh failure shows on its own route");
  await shot("10-fresh-failure-own-route");

  // coin control: the draft and the failed list belong to the route that made them
  await click(panelSession, "#openCoinControlButton");
  await wait("coin control rows", () => read(`!!document.querySelector('input[id^="cc-amt-"]')`), Boolean);
  await fill('input[id^="cc-amt-"]', "0.42");
  await wait("draft stored", () => read(`document.querySelector('input[id^="cc-amt-"]')?.value`), (value) => value === "0.42");
  await shot("11-coincontrol-first-route");
  await switchTo(a);
  const leaked = await read(`(() => {
    const rows = [...document.querySelectorAll('input[id^="cc-amt-"]')];
    return {rows: rows.length, values: rows.map(row => row.value), text: document.body.innerText.includes("0.42")};
  })()`);
  check("coin control draft does not leak to another route", leaked.rows <= 1 && !leaked.values.includes("0.42") && !leaked.text, leaked);
  check("other route shows no rebroadcast button", !await read(`!!document.querySelector('[id^="cc-re-"]')`));
  await shot("12-coincontrol-other-route");
  await switchTo(b);
  // handlers restore input values one frame after the route renders
  check("coin control draft returns to its own route", await wait(
    "coin control draft",
    () => read(`document.querySelector('input[id^="cc-amt-"]')?.value ?? ""`),
    (value) => value === "0.42",
  ) === "0.42");
  const rebroadcast: string = await read(`document.querySelector('[id^="cc-re-"]')?.id ?? ""`);
  check("failed transaction offers rebroadcast on its own route", !!rebroadcast, rebroadcast);
  await shot("13-rebroadcast-available");

  await click(panelSession, `[id=${JSON.stringify(rebroadcast)}]`);
  await wait("rebroadcast reached the node", async () => held.length, (count) => count === 1, 60000);
  await release();
  await wait("rebroadcast accepted", () => diskLog(b), (log) => log?.status === "OK");
  await expectStatus(b, "successfully sent transaction", "rebroadcast result shows on its own route");
  check("rebroadcast clears the failed transaction", !await read(`!!document.querySelector('[id^="cc-re-"]')`));
  await switchTo(a);
  // the first route was dismissed earlier, so it must stay empty after B rebroadcasts
  await expectEmpty(a, "rebroadcast did not disturb the other route");
  await shot("14-rebroadcast-done");

  await Bun.write(join(out, "result.json"), JSON.stringify({ passed: true, checks, checkpoints }, null, 2));
  console.log(`PASS slow wallet-route notifications: ${checks.length} checks; evidence ${out}`);
} catch (error) {
  await checkpoint("failure", b).catch(() => {});
  await Bun.write(join(out, "result.json"), JSON.stringify({ passed: false, checks, checkpoints, browserErrors, clicks: clicks.slice(-12), error: String(error) }, null, 2));
  throw error;
} finally {
  for (const request of held.splice(0))
    await send("Fetch.continueRequest", { requestId: request.requestId }, request.sessionId).catch(() => {});
  await send("Fetch.disable", {}, backgroundSession).catch(() => {});
  if (recording) await recording.stop().catch((error) => console.error("recording failed", error));
  fixture.stop(true);
  ws.close();
}
