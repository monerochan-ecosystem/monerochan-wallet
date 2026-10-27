// Fresh install. Empty profile, no seed.
// Generate a seed, finish setup, save a node url.
// The background must already be listening, or save fails and no heights show.
// Usage: bun test/browser-fresh-install.ts
// The one test Brave runs on FRESH_BRAVE_PORT (default 9334) with dist/chrome and this empty profile.
// Then save those files, start a second empty profile, and import the file.
// The dot must go green with no extra browser restart.
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { cdp, ensureSidePanel, setDebugPort, targetByUrl, type SendFn } from "./cdp.js";

// one test Brave at a time. test/brave.sh closes every other Brave, wipes this profile, and starts a new one.
// the global pid file /tmp/monerochan-test-brave.pid holds its pid.
const PORT = Number(process.env.FRESH_BRAVE_PORT) || 9334;
setDebugPort(PORT);

function startFreshBrowser() {
  const root = process.cwd();
  const r = spawnSync("bash", [
    resolve(root, "test/brave.sh"), "ensure", "--fresh",
    "--profile", resolve(root, "testdata/fresh-install-profile"),
    "--port", String(PORT),
    "--log", resolve(root, "testdata/fresh-install-brave.log"),
    "--", "--start-maximized", "--new-window", "http://127.0.0.1:18081/get_height",
  ], { stdio: "inherit" });
  if (r.status !== 0) throw new Error("fresh browser did not start");
}

startFreshBrowser();
// node and shop only. SKIP_BRAVE keeps start-regtest.sh from closing the fresh Brave.
spawnSync("bash", ["test/start-regtest.sh"], { stdio: "inherit", env: { ...process.env, SKIP_BRAVE: "1" } });

const extWait = Date.now();
while (Date.now() - extWait < 20000) {
  const list = await (await fetch("http://127.0.0.1:" + PORT + "/json/list")).json() as { url?: string }[];
  if (list.some((x) => (x.url || "").startsWith("chrome-extension://"))) break;
  await new Promise((r) => setTimeout(r, 300));
}

const first = await cdp();
let send: SendFn = first.send;
let ws = first.ws;
await ensureSidePanel(send);

async function panel(expr: string): Promise<any> {
  const t = await targetByUrl("sidebar.html");
  const s = await send("Target.attachToTarget", { targetId: t.id, flatten: true });
  await send("Runtime.enable", {}, s.sessionId);
  const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true }, s.sessionId);
  if (r.exceptionDetails) return "";
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

async function waitText(part: string, ms = 20000): Promise<string> {
  const start = Date.now();
  let last = "";
  while (Date.now() - start < ms) {
    last = String(await panel("document.body.innerText") || "");
    if (last.includes(part)) return last;
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error("missing " + part + ": " + last.replaceAll("\n", " | ").slice(0, 400));
}

await waitText("GENERATE SEEDPHRASE");
console.log("onboarding open");
await panelClick("generate");
{
  const start = Date.now();
  let ok = false;
  while (Date.now() - start < 20000) {
    if ((await panel(`!!document.getElementById("word1")`)) === true) { ok = true; break; }
    await new Promise((r) => setTimeout(r, 300));
  }
  if (!ok) throw new Error("seed words did not appear");
}
console.log("seed generated");
await panelClick("finish-setup");
await waitText("SEND");
console.log("setup finished");

await panelClick("connection");
await panel(`(() => {
  const a = document.getElementById("nodeUrl");
  const b = document.getElementById("startHeight");
  a.value = "http://127.0.0.1:18081";
  a.dispatchEvent(new Event("input", { bubbles: true }));
  b.value = "0";
  b.dispatchEvent(new Event("input", { bubbles: true }));
  return 1;
})()`);
await panelClick("saveNodeUrl");
const saved = await waitText("Node URL, start height saved");
if (saved.includes("Node URL, start height not saved")) {
  throw new Error("node url was not saved");
}
console.log("node url saved");

let daemon = 0;
const heightWait = Date.now();
while (Date.now() - heightWait < 30000) {
  daemon = Number(await panel(`(() => {
    const s = window.connectionStatus;
    return s?.sync?.daemon_height ?? s?.last_packet?.daemon_height ?? 0;
  })()`) || 0);
  if (daemon > 0) break;
  await new Promise((r) => setTimeout(r, 500));
}
const body = String(await panel("document.body.innerText") || "");
console.log("daemon height", daemon);
console.log(body.split("\n").slice(0, 25).join(" | "));
if (!(daemon > 0)) throw new Error("no daemon height after fresh setup");
console.log("PASS fresh install saved the node and synced");

const walletFile = resolve(process.cwd(), "testdata/fresh-import-wallet.json");
const exported = await panel(`(async () => {
  const db = await new Promise((resolve, reject) => {
    const req = indexedDB.open("files");
    req.onerror = () => reject(req.error);
    req.onsuccess = () => resolve(req.result);
  });
  const keys = await new Promise((resolve, reject) => {
    const req = db.transaction("files").objectStore("files").getAllKeys();
    req.onerror = () => reject(req.error);
    req.onsuccess = () => resolve(req.result || []);
  });
  const files = [];
  for (const key of keys) {
    if (typeof key !== "string") continue;
    if (key.startsWith("ConnectionStatus")) continue;
    const content = await new Promise((resolve, reject) => {
      const req = db.transaction("files").objectStore("files").get(key);
      req.onerror = () => reject(req.error);
      req.onsuccess = () => resolve(req.result);
    });
    if (typeof content !== "string") continue;
    files.push({ filename: key, content });
  }
  return files;
})()`);
if (!Array.isArray(exported) || exported.length === 0) {
  throw new Error("did not read wallet files for import");
}
await Bun.write(walletFile, JSON.stringify({ files: exported }, null, 2));
console.log("wallet file", exported.map((f) => f.filename).join(", "));
ws.close();

// Second empty profile. The background starts before the import, with no wallets.
startFreshBrowser();
const extWait2 = Date.now();
while (Date.now() - extWait2 < 20000) {
  const list = await (await fetch("http://127.0.0.1:" + PORT + "/json/list")).json() as { url?: string }[];
  if (list.some((x) => (x.url || "").startsWith("chrome-extension://"))) break;
  await new Promise((r) => setTimeout(r, 300));
}
type Chooser = { sessionId: string; backendNodeId: number };
let chooser: Chooser | null = null;
const second = await cdp((msg) => {
  if (msg.method === "Page.fileChooserOpened" && msg.sessionId && msg.params?.backendNodeId) {
    chooser = { sessionId: msg.sessionId, backendNodeId: msg.params.backendNodeId };
  }
});
send = second.send;
ws = second.ws;
await ensureSidePanel(send);
await waitText("GENERATE SEEDPHRASE");
console.log("second install is empty");
await panelClick("recover");
{
  const start = Date.now();
  let ok = false;
  while (Date.now() - start < 10000) {
    if ((await panel(`!!document.getElementById("importWallet")`)) === true) { ok = true; break; }
    await new Promise((r) => setTimeout(r, 200));
  }
  if (!ok) throw new Error("import button did not appear");
}
// the cdp callback sets it. the cast keeps tsc from narrowing it to null.
chooser = null as Chooser | null;
{
  const t = await targetByUrl("sidebar.html");
  const s = await send("Target.attachToTarget", { targetId: t.id, flatten: true });
  await send("Page.enable", {}, s.sessionId);
  await send("Page.setInterceptFileChooserDialog", { enabled: true }, s.sessionId);
  await send("Runtime.enable", {}, s.sessionId);
  const r = await send("Runtime.evaluate", {
    expression: `(() => { const el = document.getElementById("importWallet"); if (!el) return "missing"; el.scrollIntoView({block:"center"}); const b = el.getBoundingClientRect(); return JSON.stringify({x: b.x+b.width/2, y: b.y+b.height/2}); })()`,
    returnByValue: true,
  }, s.sessionId);
  if (r.result?.value === "missing") throw new Error("missing importWallet");
  const { x, y } = JSON.parse(r.result.value);
  await send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 }, s.sessionId);
  await send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 }, s.sessionId);
  const start = Date.now();
  while (!chooser && Date.now() - start < 10000) {
    await new Promise((rr) => setTimeout(rr, 100));
  }
  if (!chooser) throw new Error("file chooser did not open");
  await send("DOM.setFileInputFiles", {
    files: [walletFile],
    backendNodeId: chooser.backendNodeId,
  }, chooser.sessionId);
}
await waitText("SEND", 45000);
console.log("wallet file imported, no browser restart");

let importedDaemon = 0;
let connected = false;
let status = "";
const importWait = Date.now();
while (Date.now() - importWait < 40000) {
  const snap = await panel(`(() => {
    const s = window.connectionStatus;
    return {
      connected: window.wallets?.connectionStatusOpened?.isConnected === true,
      daemon: s?.sync?.daemon_height ?? s?.last_packet?.daemon_height ?? 0,
      status: s?.last_packet?.status ?? "",
    };
  })()`).catch(() => null);
  if (snap && typeof snap === "object") {
    importedDaemon = Number(snap.daemon) || 0;
    connected = snap.connected === true;
    status = String(snap.status || "");
    if (connected && importedDaemon > 0) break;
  }
  await new Promise((r) => setTimeout(r, 500));
}
const importedBody = String(await panel("document.body.innerText").catch(() => "") || "");
console.log("import daemon", importedDaemon, "connected", connected, "status", status);
console.log(importedBody.split("\n").slice(0, 25).join(" | "));
if (!(connected && importedDaemon > 0)) {
  throw new Error("file import did not show connected without a restart");
}
console.log("PASS file import showed connected without a restart");
ws.close();
