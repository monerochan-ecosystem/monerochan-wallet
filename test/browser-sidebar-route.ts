import { mkdirSync } from "node:fs";
import { cdp, debugHttp, ensureSidePanel, targetByUrl } from "./cdp";
import { reviveSidebar, startNodeAndBrowser } from "./setup";

// Select wallets with CDP input events, then close the actual Chrome side panel.
// Read ScanSettings.json from IndexedDB in the background context while the panel is closed.
// Usage: bun test/browser-sidebar-route.ts
const SETTINGS = "ScanSettings.json";
startNodeAndBrowser();
await ensureSidePanel();
await reviveSidebar();
const { ws, send } = await cdp();
const checks: { name: string; detail: unknown }[] = [];
let panelId = "";
let panelSession = "";
let originalRoute = "";

async function evaluate(sessionId: string, expression: string): Promise<any> {
  const result = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }, sessionId);
  if (result.exceptionDetails)
    throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  return result.result?.value;
}
async function wait<T>(label: string, read: () => Promise<T>, accept: (value: T) => boolean): Promise<T> {
  const start = Date.now();
  let last: T | undefined;
  while (Date.now() - start < 20000) {
    last = await read();
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
const readPanel = (expression: string) => evaluate(panelSession, expression);
async function openPanel() {
  await ensureSidePanel(send);
  const target = await targetByUrl("sidebar.html");
  panelId = target.id;
  panelSession = (await send("Target.attachToTarget", { targetId: panelId, flatten: true })).sessionId;
  await send("Target.activateTarget", { targetId: panelId });
  await wait("wallet UI", () => readPanel(`!!window.wallets?.wallets.length && !!window.walletRouteParams && !!document.getElementById("wallets")`), Boolean);
}
async function closePanel() {
  const oldId = panelId;
  await readPanel(`(() => {
    void chrome.windows.getCurrent().then(window => chrome.sidePanel.close({windowId: window.id}));
    return true;
  })()`);
  await wait("side panel closed", async () => (await fetch(debugHttp() + "/json/list").then((response) => response.json())).some((target: any) => target.id === oldId), (present) => !present);
  panelId = "";
  panelSession = "";
  return oldId;
}
async function click(selector: string) {
  await wait("click target", () => readPanel(`(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    return !!element && (element.tagName === "A" || typeof element.onclick === "function") && element.getBoundingClientRect().width > 0;
  })()`), Boolean);
  await readPanel(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block: "center", behavior: "instant"})`);
  await Bun.sleep(150);
  const box = await readPanel(`(() => {
    const box = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();
    return {x: box.x + box.width / 2, y: box.y + box.height / 2};
  })()`);
  for (const type of ["mousePressed", "mouseReleased"])
    await send("Input.dispatchMouseEvent", { type, ...box, button: "left", clickCount: 1 }, panelSession);
}
async function selectRoute(route: string) {
  if (await readPanel("window.activeWalletPlate") !== "wallets") await click("#wallets");
  await click(`a.wallet-route-link[href=${JSON.stringify("#/" + route)}]`);
}
const routeState = () => readPanel(`(() => {
  const params = window.walletRouteParams;
  return {hash: location.hash, selected: params ? [params.identity, params.domain, params.wallet_type, params.wallet_slot].join("/") : ""};
})()`);

try {
  await openPanel();
  // Reopen once so the test uses the latest sidebar bundle.
  await closePanel();
  await openPanel();
  originalRoute = (await routeState()).selected;
  const routes: string[] = await readPanel(`window.wallets.wallets.map(wallet => wallet.wallet_route).filter(Boolean)`);
  if (routes.length < 2) throw new Error("test profile needs two routed wallets; run test/browser-002.ts first");
  const first = routes[0]!;
  const second = routes[1]!;
  const background = await targetByUrl("background.html");
  const backgroundSession = (await send("Target.attachToTarget", { targetId: background.id, flatten: true })).sessionId;
  const readSetting = (key: string): Promise<string> => evaluate(backgroundSession, `(async () => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open("files");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      return await new Promise((resolve, reject) => {
        const request = db.transaction("files", "readonly").objectStore("files").get(${JSON.stringify(key)});
        request.onsuccess = () => resolve(request.result ?? "");
        request.onerror = () => reject(request.error);
      });
    } finally { db.close(); }
  })()`);
  const savedRoute = async () => {
    const raw = await readSetting(SETTINGS);
    return raw ? String(JSON.parse(raw).selected_wallet ?? "") : "";
  };
  const writeSelection = (route: string) => evaluate(backgroundSession, `(async () => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open("files");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      const raw = await new Promise((resolve, reject) => {
        const request = db.transaction("files", "readonly").objectStore("files").get(${JSON.stringify(SETTINGS)});
        request.onsuccess = () => resolve(request.result ?? "");
        request.onerror = () => reject(request.error);
      });
      if (!raw) return false;
      const settings = JSON.parse(raw);
      settings.selected_wallet = ${JSON.stringify(route)};
      await Bun.write(${JSON.stringify(SETTINGS)}, JSON.stringify(settings, null, 2));
      return true;
    } finally { db.close(); }
  })()`);

  await selectRoute(second);
  const closedId = await closePanel();
  check("route is stored in ScanSettings after immediate close", await wait("saved second route", savedRoute, (route) => route === second) === second, second);
  await openPanel();
  const secondState = await wait("restore second wallet", routeState, (state) => state.selected === second && state.hash === "#/" + second);
  check("reopened sidebar restores the second wallet", panelId !== closedId, secondState);
  check("startup does not replace the saved route with the first wallet", await savedRoute() === second, await savedRoute());

  await readPanel(`(() => {
    const original = Bun.write;
    const state = window.__selectedRouteWrites = {count: 0, restore: () => { Bun.write = original; delete window.__selectedRouteWrites; }};
    Bun.write = (path, ...args) => {
      if (path === ${JSON.stringify(SETTINGS)}) state.count++;
      return original(path, ...args);
    };
  })()`);
  await selectRoute(first);
  await wait("saved first route", savedRoute, (route) => route === first);
  await Bun.sleep(1000);
  check("route selection writes once, not on every render", await readPanel("window.__selectedRouteWrites.count") === 1);
  await readPanel("window.__selectedRouteWrites.restore()");
  await closePanel();
  await openPanel();
  check("changing back to the first wallet also persists", (await wait("restore first wallet", routeState, (state) => state.selected === first)).hash === "#/" + first, first);

  for (const invalid of ["main/removed.example/single/999", "not a wallet route"]) {
    await closePanel();
    await writeSelection(invalid);
    await openPanel();
    const fallback = await wait("fallback wallet", routeState, (state) => state.selected === first);
    check("unavailable or invalid saved route falls back: " + invalid, fallback.hash === "#/" + first, fallback);
    check("fallback replaces the invalid saved route", await wait("saved fallback", savedRoute, (route) => route === first) === first, await savedRoute());
  }
  mkdirSync("testdata", { recursive: true });
  await Bun.write("testdata/browser-sidebar-route-result.json", JSON.stringify({ passed: true, file: SETTINGS, checks }, null, 2));
  console.log(`PASS sidebar wallet route: ${checks.length} browser checks`);
} finally {
  if (panelSession) await readPanel("window.__selectedRouteWrites?.restore()").catch(() => {});
  if (originalRoute) {
    if (!panelSession) await openPanel().catch(() => {});
    if (panelSession && (await routeState()).selected !== originalRoute)
      await selectRoute(originalRoute).catch(() => {});
  }
  ws.close();
}
