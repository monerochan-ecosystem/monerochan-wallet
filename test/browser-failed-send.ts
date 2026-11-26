// ad hoc local-regtest check through real content clicks, send, and recovery buttons.
import { mkdir } from "node:fs/promises";
import { cdp, targetByUrl } from "./cdp";
import { makeTestKeyPair, ViewPair, tools } from "@spirobel/monero-wallet-api";

const node = "http://127.0.0.1:18081";
const info = await fetch(node + "/get_info").then((response) => response.json());
if (info.nettype !== "fakechain" || !info.offline) throw Error("requires the owned offline regtest node");
// finish earlier local test payments and unlock new change.
const mined = await fetch(node + "/json_rpc", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: "0", method: "generateblocks", params: { amount_of_blocks: 12, wallet_address: "47cYSGSjzWPX3KFEN9PaxT5zpWKgRtx568bazbGzt57ffBbUAQevjMk19sfZCrMB1RWHNJLbz1eKU63B77HpHwUVA6JGudr" } }) }).then((response) => response.json());
if (mined.error) throw Error("regtest preparation failed: " + JSON.stringify(mined.error));
const preparedHeight = (await fetch(node + "/get_info").then((response) => response.json())).height;
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const directory = `testdata/send-lock-review/${stamp}`;
await mkdir(directory, { recursive: true });
const key = await makeTestKeyPair();
const view = await ViewPair.create(key.view_key.mainnet_primary, key.view_key.view_key);
const invoices = [false, true, false].map((handover, i) => ({ id: i + 1, handover, address: view.makeIntegratedAddress(i + 1) }));
const posts: any[] = [];
let origin = "";
const merchant = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(req) {
  const url = new URL(req.url);
  const invoice = invoices.find((i) => i.id === Number(url.searchParams.get("id"))) || invoices.find((i) => url.pathname.endsWith(i.address));
  if (!invoice) return new Response("unknown invoice", { status: 404 });
  if (url.pathname.startsWith("/monerochan001/")) return tools["001"].counterparty.validate_route({
    isPayAddressKnown: (address) => address === invoice.address,
    getUrls: () => invoice.handover ? { handoverUrl: `${origin}/handover?id=${invoice.id}`, successUrl: `${origin}/checkout?id=${invoice.id}` } : {},
  })(req);
  if (url.pathname === "/handover") {
    const response = await tools["001"].counterparty.execute_route({ node_url: node, primary_address: key.view_key.mainnet_primary, view_key: key.view_key.view_key,
      checkPayment: (scan) => scan.outputs.filter((out) => out.payment_id === String(invoice.id)).reduce((sum, out) => sum + BigInt(out.amount), 0n) >= 100_000_000_000n,
    })(req);
    posts.push(await response.clone().json());
    return response;
  }
  const link = tools["001"].counterparty.make({ address: invoice.address, amount: "0.1", no_check: false });
  return new Response(`<!doctype html><title>Local failed-send check</title><h1>Local regtest checkout</h1><p>${invoice.handover ? "Merchant handover enabled" : "Legacy backend without handover"}</p><a id="pay" href="/checkout?id=${invoice.id}#${link}">pay with browser wallet</a>`, { headers: { "Content-Type": "text/html" } });
} });
origin = `http://127.0.0.1:${merchant.port}`;
let failPayer = true;
const submitted: string[] = [];
const attached: { sessionId: string; targetInfo: { type: string; targetId: string } }[] = [];
const c = await cdp(async (event) => {
  if (event.method === "Target.attachedToTarget") { attached.push(event.params); return; }
  if (event.method !== "Fetch.requestPaused") return;
  submitted.push(JSON.parse(event.params.request.postData).tx_as_hex);
  await c.send(failPayer ? "Fetch.failRequest" : "Fetch.continueRequest", { requestId: event.params.requestId, ...(failPayer ? { errorReason: "TimedOut" } : {}) }, event.sessionId);
});
let bg = "";
const tabs: string[] = [];
const results: any[] = [];
const audits: { type: string; sessionId: string; targetId: string }[] = [];
try {
  const panel = await targetByUrl("sidebar.html");
  const panelSession = (await c.send("Target.attachToTarget", { targetId: panel.id, flatten: true })).sessionId;
  bg = (await c.send("Target.attachToTarget", { targetId: (await targetByUrl("background.html")).id, flatten: true })).sessionId;
  // worker sessions must be attached through their owning offscreen document.
  await c.send("Target.setAutoAttach", { autoAttach: true, waitForDebuggerOnStart: false, flatten: true }, bg);
  await Bun.sleep(200);
  for (const { sessionId, targetInfo: target } of [...new Map(attached.map((entry) => [entry.targetInfo.targetId, entry])).values()]) {
    const installed = await c.send("Runtime.evaluate", { expression: `(()=>{if(typeof IDBObjectStore==="undefined")return false;globalThis.__cacheWrites=[];globalThis.__cachePut=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(value,key){if(this.name==="files"&&String(key).endsWith("_cache.json"))globalThis.__cacheWrites.push({key,stack:new Error().stack,at:Date.now()});return globalThis.__cachePut.call(this,value,key)};return true})()`, returnByValue: true }, sessionId);
    if (installed.result?.value) audits.push({ type: target.type, sessionId, targetId: target.targetId });
  }
  await c.send("Fetch.enable", { patterns: [{ urlPattern: node + "/send_raw_transaction", requestStage: "Request" }] }, bg);
  async function evaluate(expression: string, session = panelSession) {
    const response = await c.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }, session);
    if (response.exceptionDetails) throw Error(response.exceptionDetails.exception?.description || response.exceptionDetails.text);
    return response.result?.value;
  }
  async function wait(check: () => Promise<any>, name: string) {
    for (let i = 0; i < 150; i++) { const result = await check(); if (result) return result; await Bun.sleep(100); }
    throw Error("timeout: " + name);
  }
  async function click(id: string, session = panelSession) {
    const point = await evaluate(`(()=>{const e=document.getElementById(${JSON.stringify(id)});if(!e)throw Error("missing ${id}");e.scrollIntoView({block:"nearest"});const r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`, session);
    for (const type of ["mousePressed", "mouseReleased"]) await c.send("Input.dispatchMouseEvent", { type, ...point, button: "left", clickCount: 1 }, session);
    await Bun.sleep(250);
  }
  async function shot(name: string, session = panelSession, targetId = panel.id) {
    await c.send("Target.activateTarget", { targetId });
    const snapshot = await evaluate(`JSON.stringify({timestamp:new Date().toISOString(),text:document.body.innerText,amount:String(window.wallets?.wallets[0].amount),pending:String(window.wallets?.wallets[0].pending_amount),failed:window.wallets?.wallets[0].failed_txs.map(r=>({index:r.index,txlog:r.txlog})),locks:window.wallets?.wallets[0].cache.pending_spent_utxos},(_k,v)=>typeof v==="bigint"?String(v):v)`, session);
    await Bun.write(`${directory}/${name}.json`, snapshot);
    const image = await c.send("Page.captureScreenshot", { format: "png" }, session);
    await Bun.write(`${directory}/${name}.png`, Buffer.from(image.data, "base64"));
  }
  await wait(() => evaluate(`window.wallets.current_height >= ${preparedHeight - 1}`), "wallet scanned prepared regtest height");
  const latest = (id: string) => evaluate(`(()=>{const x=window.wallets.actionLogOpened.invocations().find(x=>x.invocationId===${JSON.stringify(id)});return x&&JSON.parse(JSON.stringify(x))})()`);
  const failedIndex = (id: string) => evaluate(`window.wallets.wallets[0].failed_txs.find(r=>r.txlog.invocationId===${JSON.stringify(id)})?.index`);
  for (const invoice of invoices) {
    failPayer = invoice.id !== 3;
    const { targetId } = await c.send("Target.createTarget", { url: `${origin}/checkout?id=${invoice.id}` });
    tabs.push(targetId);
    const session = (await c.send("Target.attachToTarget", { targetId, flatten: true })).sessionId;
    await wait(() => evaluate('!!document.getElementById("pay")', session), "merchant link");
    await c.send("Target.activateTarget", { targetId });
    await click("pay", session);
    const id = await wait(() => evaluate(`window.wallets.actionLogOpened.getActiveByPermissions(["spend"]).find(x=>x.address===${JSON.stringify(invoice.address)})?.invocationId`), "tool invocation");
    await c.send("Target.activateTarget", { targetId: panel.id });
    if (!await evaluate('!!document.getElementById("send-action")')) await click("send");
    if (!await evaluate("window.unlocked === true")) await click("fire");
    await wait(() => evaluate('document.getElementById("send-action")?.classList.contains("action-button")'), "send button");
    const requestsBeforeSend = submitted.length;
    await click("send-action");
    const result = await wait(async () => { const r = await latest(id); return r?.lastType === "execute_result" ? r : null; }, "send result");
    results.push({ invoice, invocationId: id, result });
    if (submitted.length === requestsBeforeSend) throw Error("send did not reach the payer node: " + result.error);
    if (!failPayer) {
      if (result.ok !== true || result.error || result.events.some((event: any) => event.handover)) throw Error("legacy backend reported a handover error");
      await shot("06-legacy-backend-success");
      continue;
    }
    if (invoice.handover) {
      if (result.ok !== true || !result.error || posts.at(-1)?.ok !== true) throw Error("merchant acceptance missing after payer timeout");
      await wait(() => evaluate(`window.wallets.wallets[0].tx_logs.some(row => row.invocationId === ${JSON.stringify(id)} && row.broadcast_accepted === true)`), "merchant acceptance saved");
      if (typeof await failedIndex(id) === "number") throw Error("accepted payment still appears as a failed send");
      await shot("05-merchant-accepted-payer-failed");
      continue;
    }
    const index = await failedIndex(id);
    if (typeof index !== "number") throw Error("failed payer row missing");
    await wait(() => evaluate(`!!document.getElementById("cc-txlog-${index}")`), "transaction log link");
    if (await evaluate('document.querySelector(".failed-sends")?.textContent.includes("free inputs") || document.querySelector("[id^=cc-unlock-]")')) throw Error("failed send offers release outside the transaction log");
    if (await evaluate('document.querySelector(".cc-timer") || document.querySelector(".failed-sends")?.textContent.includes("inputs unlock in")')) throw Error("failed send shows an unlock countdown");
    await shot("01-failed-standard");
    const internalError = "A listener indicated an asynchronous response by returning true, but the message channel closed before a response was received";
    const requestsBefore = submitted.length;
    await evaluate(`(()=>{const rt=(globalThis.browser||globalThis.chrome).runtime;window.__recoverySendMessage=rt.sendMessage;rt.sendMessage=function(message,...args){if(message?.kind==="worker.rebroadcastTx")return Promise.reject(new Error(${JSON.stringify(internalError)}));return window.__recoverySendMessage.call(this,message,...args)}})()`);
    try {
      await click(`cc-re-${index}`);
      await wait(() => evaluate('document.body.innerText.includes("The wallet connection was interrupted.")'), "plain channel error");
      if (submitted.length !== requestsBefore) throw Error("injected channel failure reached the node");
      if (await evaluate(`document.body.innerText.includes(${JSON.stringify(internalError)})`)) throw Error("internal error is shown outside technical details");
      await shot("07-plain-channel-error");
    } finally {
      await evaluate('(()=>{const rt=(globalThis.browser||globalThis.chrome).runtime;if(window.__recoverySendMessage){rt.sendMessage=window.__recoverySendMessage;delete window.__recoverySendMessage}})()');
    }
    await click("toggle-failed-sends");
    await Bun.sleep(1200);
    if (await evaluate('document.getElementById("failed-sends").open')) throw Error("the collapsed list reopened after rendering");
    await shot("08-collapsed-failures");
    await click("toggle-failed-sends");
    await click("openCoinControlButton");
    await shot("02-failed-coin-control");
    await click("send-mode-standard");
    const first = await evaluate(`window.wallets.wallets[0].tx_logs[${index}].last_broadcast_at`);
    const sentBefore = submitted.length;
    const sender = await evaluate("window.wallets.wallets[0].primary_address");
    const { targetInfos } = await c.send("Target.getTargets");
    for (const { url, targetId } of targetInfos) {
      if (url.startsWith("chrome-extension://") && url.includes("/actionlog.html")) await c.send("Target.closeTarget", { targetId });
    }
    await click(`cc-txlog-${index}`);
    const detail = await wait(() => targetByUrl(`#/tx/${sender}/${index}`).catch(() => null), "transaction log detail tab");
    await c.send("Target.closeTarget", { targetId: detail.id });
    await c.send("Target.activateTarget", { targetId: panel.id });
    await click("reset-send");
    await wait(() => evaluate('!document.getElementById("failed-sends")'), "reset clears all failed notices");
    if (await evaluate(`!window.wallets.wallets[0].failed_txs.some(r => r.index === ${index} && r.txlog.hidden_on_send_plate && !r.txlog.inputs_unlocked)`)) throw Error("reset changed the locked transaction");
    await shot("01b-notices-cleared-after-reset");
    await click("openActionLog");
    const log = await wait(() => targetByUrl("actionlog.html").catch(() => null), "action log tab");
    const detailSession = (await c.send("Target.attachToTarget", { targetId: log.id, flatten: true })).sessionId;
    await wait(() => evaluate('!!document.getElementById("log-tab-txlog")', detailSession), "transaction log tab");
    await click("log-tab-txlog", detailSession);
    const rowId = `txlog-${sender.slice(0, 8)}-${index}`;
    await wait(() => evaluate(`document.getElementById(${JSON.stringify(rowId)})?.textContent.includes("inputs reserved")`, detailSession), "reserved transaction appears in the list");
    await shot("03a-txlog-list-after-reset", detailSession, log.id);
    await click(rowId, detailSession);
    await wait(() => evaluate('document.getElementById("txlog-free-inputs")?.textContent === "free inputs" && !!document.getElementById("txlog-rebroadcast")', detailSession), "transaction recovery controls");
    await shot("03b-txlog-recovery", detailSession, log.id);
    await click("txlog-rebroadcast", detailSession);
    await wait(() => evaluate(`window.wallets.wallets[0].failed_txs.some(r=>r.index===${index}) && window.wallets.wallets[0].tx_logs[${index}].last_broadcast_at > ${first}`), "rebroadcast recorded another attempt");
    if (submitted.length !== sentBefore + 1 || submitted.at(-1) !== submitted.at(-2)) throw Error("rebroadcast changed signed bytes");
    await shot("03c-txlog-rebroadcast-locked", detailSession, log.id);
    await click("txlog-free-inputs", detailSession);
    await wait(() => evaluate('!!document.getElementById("txlog-confirm-release")', detailSession), "release confirmation");
    if (await evaluate(`window.wallets.wallets[0].tx_logs[${index}].inputs_unlocked === true`)) throw Error("opening the confirmation released the inputs");
    await shot("04a-free-inputs-confirmation", detailSession, log.id);
    await click("txlog-cancel-release", detailSession);
    await wait(() => evaluate('!document.getElementById("txlog-confirm-release")', detailSession), "cancelled release");
    await click("txlog-free-inputs", detailSession);
    await click("txlog-confirm-release", detailSession);
    await wait(() => evaluate(`window.wallets.wallets[0].tx_logs[${index}].inputs_unlocked === true`), "coordinator unlock");
    await wait(() => evaluate(`!window.wallets.wallets[0].failed_txs.some(r => r.index === ${index})`), "dismissed notice after release");
    await wait(() => evaluate('document.querySelector(".log-recovery")?.textContent.includes("inputs released")', detailSession), "transaction details record the release");
    await shot("04b-txlog-inputs-released", detailSession, log.id);
    await c.send("Target.closeTarget", { targetId: log.id });
    await shot("04c-notice-cleared-after-release");
  }
  const writes = [];
  for (const audit of audits) {
    const observed = await c.send("Runtime.evaluate", { expression: "globalThis.__cacheWrites", returnByValue: true }, audit.sessionId);
    writes.push({ ...audit, cacheWrites: observed.result?.value || [] });
  }
  await Bun.write(`${directory}/cache-writes.json`, JSON.stringify(writes, null, 2));
  if (writes.some((row) => row.type !== "worker" && row.cacheWrites.length)) throw Error("cache written outside a coordinator worker");
  const active = writes.filter((row) => row.cacheWrites.length);
  if (active.length !== 1 || active[0].cacheWrites.some((write: any) => !write.stack.includes("coordinatorMainMultithreaded"))) throw Error("cache write ownership was not verified");
  await Bun.write(`${directory}/results.json`, JSON.stringify({ timestamp: new Date().toISOString(), results, posts, payerRequests: submitted.length }, null, 2));
  console.log("PASS timeout, both modes, same-byte rebroadcast, unlock, plain errors, collapse, merchant acceptance, legacy backend", directory);
} catch (error) {
  await Bun.write(`${directory}/failure.json`, JSON.stringify({ error: String(error), results, posts, payerRequests: submitted.length }, null, 2));
  throw error;
} finally {
  for (const audit of audits) await c.send("Runtime.evaluate", { expression: "if(globalThis.__cachePut){IDBObjectStore.prototype.put=globalThis.__cachePut;delete globalThis.__cachePut;delete globalThis.__cacheWrites}" }, audit.sessionId).catch(() => {});
  if (bg) await c.send("Fetch.disable", {}, bg).catch(() => {});
  for (const targetId of tabs) await c.send("Target.closeTarget", { targetId }).catch(() => {});
  c.ws.close(); merchant.stop(true);
}
