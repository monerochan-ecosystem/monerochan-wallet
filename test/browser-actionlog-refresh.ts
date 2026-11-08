import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { cdp, ensureSidePanel, recordTab, targetByUrl } from "./cdp";
import { reviveSidebar, startNodeAndBrowser } from "./setup";

// Keep an action log open while the worker wallet list changes.
// Only the regtest profile is used. Restore its settings and all read overrides.
// Usage: RUN_ID=wallet-list bun test/browser-actionlog-refresh.ts
const NODE = "http://127.0.0.1:18081";
const runId = process.env.RUN_ID || new Date().toISOString().replace(/[:.]/g, "-");
if (!/^[a-zA-Z0-9_-]+$/.test(runId)) throw new Error("invalid run id");
const out = join("testdata/actionlog-refresh-runs", runId);
mkdirSync(out, { recursive: true });
startNodeAndBrowser();
await ensureSidePanel();
await reviveSidebar();
const { ws, send } = await cdp();
const checks: { name: string; detail: unknown }[] = [];
let panelSession = "";
let backgroundSession = "";
let logSession = "";
let targetId = "";
let originalSettings = "";
let recording: Awaited<ReturnType<typeof recordTab>> | undefined;

async function evaluate(sessionId: string, expression: string): Promise<any> {
  const result = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }, sessionId);
  if (result.exceptionDetails)
    throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  return result.result?.value;
}
const read = (expression: string) => evaluate(logSession, expression);
async function wait<T>(label: string, load: () => Promise<T>, accept: (value: T) => boolean, timeout = 15000): Promise<T> {
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
async function shot(name: string) {
  await send("Target.activateTarget", { targetId });
  const image = await send("Page.captureScreenshot", { format: "png" }, logSession);
  await Bun.write(join(out, name + ".png"), Buffer.from(image.data, "base64"));
}
const labels = () => read(`[...(document.getElementById("log-wallet")?.options ?? [])].map(option => option.text)`);
async function chooseWallet(address: string) {
  const index = await read(`(() => {
    const select = document.getElementById("log-wallet");
    select.focus();
    return [...select.options].findIndex(option => option.value === ${JSON.stringify(address)});
  })()`);
  if (index < 0) throw new Error("wallet option is missing");
  for (const key of ["Home", ...Array(index).fill("ArrowDown")]) {
    const code = key === "Home" ? 36 : 40;
    await send("Input.dispatchKeyEvent", { type:"keyDown", key, code:key, windowsVirtualKeyCode:code }, logSession);
    await send("Input.dispatchKeyEvent", { type:"keyUp", key, code:key, windowsVirtualKeyCode:code }, logSession);
  }
  await wait("wallet selection", () => read(`document.getElementById("log-wallet").value`), (value) => value === address);
}
async function rebuild(settings: unknown) {
  await evaluate(panelSession, "window.wallets.stopWorker()");
  await evaluate(backgroundSession, `Bun.write("ScanSettings.json", ${JSON.stringify(JSON.stringify(settings, null, 2))})`);
  await evaluate(panelSession, "window.wallets.buildWallets()");
}
async function notify() {
  await evaluate(backgroundSession, `chrome.runtime.sendMessage({kind:"walletsChanged",payload:{scan_settings_path:"ScanSettings.json"}})`);
}

try {
  const info = await fetch(`${NODE}/get_info`).then((response) => response.json());
  if (info.nettype !== "fakechain" || !info.offline) throw new Error("refuse to change settings outside offline regtest");
  const panel = await targetByUrl("sidebar.html");
  panelSession = (await send("Target.attachToTarget", { targetId: panel.id, flatten: true })).sessionId;
  if (await evaluate(panelSession, "window.wallets.node_url") !== NODE) throw new Error("wallet is not on regtest");
  const background = await targetByUrl("background.html");
  backgroundSession = (await send("Target.attachToTarget", { targetId: background.id, flatten: true })).sessionId;
  originalSettings = await evaluate(backgroundSession, `Bun.file("ScanSettings.json").text()`);
  const settings = JSON.parse(originalSettings);
  const routed = settings.wallets.filter((wallet: any) => wallet.wallet_route && !wallet.halted);
  const subject = routed.at(-1);
  if (routed.length < 2 || !subject) throw new Error("test profile needs two routed wallets");
  const url = new URL("actionlog.html", panel.url);
  url.searchParams.set("wallet", subject.primary_address);
  url.searchParams.set("refreshTest", runId);
  url.hash = "/";
  targetId = (await send("Target.createTarget", { url: url.href })).targetId;
  logSession = (await send("Target.attachToTarget", { targetId, flatten: true })).sessionId;
  await send("Target.activateTarget", { targetId });
  const initialLabels: string[] = await wait("initial routes", labels, (values) => values.length > 1);
  check("initial filter survives asynchronous startup", await read(`document.getElementById("log-wallet").value`) === subject.primary_address, initialLabels);
  recording = await recordTab("refreshTest=" + runId, join(out, "wallet-list-updates.mp4"));
  await shot("01-initial");
  await Bun.sleep(1500);

  await rebuild({ ...settings, wallets: settings.wallets.filter((wallet: any) => wallet.primary_address !== subject.primary_address) });
  await wait("removed route leaves open page", labels, (values) => !values.includes(subject.wallet_route));
  check("removed wallet leaves the dropdown without reopening", await read(`document.getElementById("log-wallet").value`) === "", await labels());
  check("removed selection resets pagination", await read(`document.getElementById("log-page").value`) === "1");
  await shot("02-removed");

  await rebuild(settings);
  await wait("restored route reaches open page", labels, (values) => JSON.stringify(values) === JSON.stringify(initialLabels));
  check("restored wallet reaches the existing page", true, await labels());
  await chooseWallet(subject.primary_address);
  check("restored wallet can be selected", await read(`document.getElementById("log-wallet").value`) === subject.primary_address);
  await shot("03-restored");
  await rebuild({ ...settings, wallets: [] });
  await wait("empty wallet list", labels, (values) => JSON.stringify(values) === '["all wallets"]');
  check("removing all wallets clears the dropdown", true, await labels());
  await rebuild(settings);
  await wait("restore after empty list", labels, (values) => JSON.stringify(values) === JSON.stringify(initialLabels));
  check("empty list recovery works without reopening", true, await labels());

  await Bun.sleep(1000);
  await read(`(async () => {
    const originalFile = Bun.file;
    const status = JSON.parse(await originalFile("ConnectionStatus-ScanSettings.json").text());
    const state = window.__actionlogRefreshTest = {
      polls:0, settingsReads:0, cacheReads:0, height:status.sync.daemon_height, settingsMode:"ok",
      restore:()=>{Bun.file=originalFile;delete window.__actionlogRefreshTest;},
    };
    Bun.file = (path, ...args) => {
      if (path === "ConnectionStatus-ScanSettings.json") return {text:async()=>{
        state.polls++;
        const timestamp = new Date().toISOString();
        return JSON.stringify({...status,
          sync:{...status.sync,daemon_height:state.height,current_scan_height:state.height-100+state.polls,timestamp},
          last_packet:{...status.last_packet,daemon_height:state.height,timestamp},
        });
      }};
      if (path === "ScanSettings.json") return {text:async()=>{
        state.settingsReads++;
        if(state.settingsMode === "reject") throw new Error("test read failure");
        if(state.settingsMode === "missing") return "";
        if(state.settingsMode === "bad-json") return "{";
        return originalFile(path,...args).text();
      }};
      if(String(path).endsWith("_cache.json")) state.cacheReads++;
      return originalFile(path,...args);
    };
  })()`);
  await wait("three scan ticks", () => read(`window.__actionlogRefreshTest.polls`), (polls) => polls >= 3);
  let counts = await read(`({settings:window.__actionlogRefreshTest.settingsReads,caches:window.__actionlogRefreshTest.cacheReads})`);
  check("scan ticks do not reread wallet files", counts.settings === 0 && counts.caches === 0, counts);
  const nextPoll = await read(`(() => {const state=window.__actionlogRefreshTest;state.height++;return state.polls+2;})()`);
  await wait("daemon height ticks", () => read(`window.__actionlogRefreshTest.polls`), (polls) => polls >= nextPoll);
  counts = await read(`({settings:window.__actionlogRefreshTest.settingsReads,caches:window.__actionlogRefreshTest.cacheReads})`);
  check("daemon height ticks do not reread wallet files", counts.settings === 0 && counts.caches === 0, counts);

  const beforeFailures = await evaluate(backgroundSession, `Bun.file("ScanSettings.json").text()`);
  for (const mode of ["reject", "missing", "bad-json"]) {
    await read(`window.__actionlogRefreshTest.settingsMode=${JSON.stringify(mode)}`);
    await notify();
    await wait("clear wallets after " + mode, labels, (values) => JSON.stringify(values) === '["all wallets"]');
    check("settings " + mode + " clears stale routes", await read(`document.getElementById("log-wallet").value`) === "", await labels());
    check("settings " + mode + " does not rewrite the file", await evaluate(backgroundSession, `Bun.file("ScanSettings.json").text()`) === beforeFailures);
    await read(`window.__actionlogRefreshTest.settingsMode="ok"`);
    await notify();
    await wait("settings recovery", labels, (values) => JSON.stringify(values) === JSON.stringify(initialLabels));
    check("settings recovery restores routes after " + mode, true, await labels());
  }
  await read(`window.__actionlogRefreshTest.restore()`);
  await shot("04-final");
  await Bun.write(join(out, "result.json"), JSON.stringify({ passed:true, targetId, checks }, null, 2));
  console.log(`PASS action log live wallet list: ${checks.length} checks; evidence ${out}`);
} catch (error) {
  const state = logSession ? await read(`({url:location.href,script:document.scripts[0]?.src,labels:[...(document.getElementById("log-wallet")?.options??[])].map(option=>option.text)})`).catch(() => null) : null;
  await Bun.write(join(out, "result.json"), JSON.stringify({ passed:false, targetId, checks, state, error:String(error) }, null, 2));
  if (logSession) await shot("failure").catch(() => {});
  throw error;
} finally {
  if (logSession) await read(`window.__actionlogRefreshTest?.restore()`).catch(() => {});
  if (originalSettings && backgroundSession && panelSession)
    await rebuild(JSON.parse(originalSettings)).catch((error) => console.error("settings restore failed", error));
  if (recording) await recording.stop().catch((error) => console.error("recording failed", error));
  ws.close();
}
