import { Database } from "bun:sqlite";
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { cdp, ensureSidePanel, targetByUrl } from "./cdp.js";
// Shared setup for browser tool-call tests. Ensures a healthy funded wallet
// on a tall chain: resets on reorg, sets the node url, mines funding plus
// decoy depth. Skips whatever is already fine. Prints what it does.
// start-regtest.sh starts monerod and Brave when the ports do not answer.
// monerod comes from test/download-monerod.ts into testdata/moneronode.
// Brave profile: testdata/brave-profile
// Extension: this repo dist/chrome
// Shop: ../monero-payment-links with bun run production. Clone it only when the folder is absent.
const NODE = "http://127.0.0.1:18081";

export function startNodeAndBrowser(): void {
  const script = join(dirname(fileURLToPath(import.meta.url)), "start-regtest.sh");
  const r = spawnSync("bash", [script], { stdio: "inherit" });
  if (r.status !== 0) throw new Error("node or browser did not start");
}
const DECOY_ADDR = "47cYSGSjzWPX3KFEN9PaxT5zpWKgRtx568bazbGzt57ffBbUAQevjMk19sfZCrMB1RWHNJLbz1eKU63B77HpHwUVA6JGudr";

// The shop assigns link ids. Read one open product link at call time.
export function shopPaymentLinkId(): string {
  const dbPath = join(process.env.SHOP_ROOT || join(dirname(fileURLToPath(import.meta.url)), "../../monero-payment-links"), "monero_payments.db");
  const db = new Database(dbPath, { readonly: true });
  try {
    const row = db.query(`
      SELECT payment_link_id FROM product_payment_links
      WHERE (currency IS NULL OR currency = 'XMR')
        AND (maxUses IS NULL OR currentUses < maxUses)
      UNION ALL
      SELECT payment_link_id FROM product_payment_links
      WHERE maxUses IS NULL OR currentUses < maxUses
      LIMIT 1
    `).get() as { payment_link_id: string } | null;
    if (!row?.payment_link_id) throw new Error("shop has no open payment link");
    return row.payment_link_id;
  } finally {
    db.close();
  }
}

export async function nodeHeight(): Promise<number> {
  try {
    return (await fetch(NODE + "/get_height").then((x) => x.json())).height;
  } catch {
    return 0;
  }
}

export async function mineTo(addr: string, n: number): Promise<void> {
  let left = n;
  while (left > 0) {
    const chunk = Math.min(left, 100);
    const r: any = await fetch(NODE + "/json_rpc", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: "0", method: "generateblocks", params: { amount_of_blocks: chunk, wallet_address: addr } }),
    }).then((x) => x.json());
    if (r.error) throw new Error("mine failed: " + JSON.stringify(r.error).slice(0, 100));
    left -= chunk;
    console.log(`mined, ${left} left, height=${r.result.height}`);
  }
}

export async function panelEval(expr: string): Promise<any> {
  const { ws, send } = await cdp();
  const t = await targetByUrl("sidebar.html");
  const s = await send("Target.attachToTarget", { targetId: t.id, flatten: true });
  await send("Runtime.enable", {}, s.sessionId);
  const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true }, s.sessionId);
  ws.close();
  return r.result?.value;
}

async function panelClick(elId: string): Promise<void> {
  const { ws, send } = await cdp();
  const t = await targetByUrl("sidebar.html");
  const s = await send("Target.attachToTarget", { targetId: t.id, flatten: true });
  await send("Runtime.enable", {}, s.sessionId);
  let present = false;
  for (let i = 0; i < 10; i++) {
    const q = await send("Runtime.evaluate", { expression: `document.getElementById(${JSON.stringify(elId)}) ? "yes" : "no"`, returnByValue: true }, s.sessionId);
    if (q.result?.value === "yes") { present = true; break; }
    await new Promise((rr) => setTimeout(rr, 2000));
  }
  if (!present) throw new Error("missing element " + elId);
  await send("Runtime.evaluate", { expression: `(() => { document.getElementById(${JSON.stringify(elId)}).scrollIntoView({block:"center"}); return 1; })()`, returnByValue: true }, s.sessionId);
  await new Promise((r) => setTimeout(r, 400));
  const r = await send("Runtime.evaluate", { expression: `(() => { const el = document.getElementById(${JSON.stringify(elId)}); if (!el) return "missing"; const b = el.getBoundingClientRect(); return JSON.stringify({x: b.x+b.width/2, y: b.y+b.height/2}); })()`, returnByValue: true }, s.sessionId);
  if (!r.result?.value || r.result.value === "missing") throw new Error("missing element " + elId);
  const { x, y } = JSON.parse(r.result.value);
  await send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 }, s.sessionId);
  await send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 }, s.sessionId);
  await new Promise((r) => setTimeout(r, 1500));
  ws.close();
}

async function ensurePlate(): Promise<void> {
  for (let round = 0; round < 2; round++) {
    const cur = await panelEval(`window.activeWalletPlate`);
    if (cur === "connection") return;
    await panelClick("connection");
    const start = Date.now();
    while (Date.now() - start < 4000) {
      const now = await panelEval(`window.activeWalletPlate`);
      if (now === "connection") return;
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  throw new Error("connection plate would not open");
}

async function panelText(): Promise<string> {
  let t = (await panelEval(`document.body.innerText`)) ?? "";
  if (t.length < 10) {
    // A side-panel reload leaves the module unrun. Import it once.
    await panelEval(`(async () => {
      const src = document.scripts[0] && document.scripts[0].src;
      if (src && document.body.innerText.length < 10) await import(src);
      return 1;
    })()`);
    t = (await panelEval(`document.body.innerText`)) ?? "";
  }
  return t;
}

async function walletScannedHeight(): Promise<number> {
  const n = await panelEval(`(() => {
    const w = window.wallets && window.wallets.wallets && window.wallets.wallets[0];
    const h = w && w._stats ? Number(w._stats.height) : 0;
    return Number.isFinite(h) ? h : 0;
  })()`);
  return typeof n === "number" ? n : 0;
}

export async function needsReorgReset(): Promise<boolean> {
  const t = await panelText();
  if (t.includes("catastrophic reorg")) return true;
  const h = await nodeHeight();
  const scanned = await walletScannedHeight();
  return scanned > h + 1;
}

// brave.sh stops every Brave and waits until the process is gone. its pid file is the global mutex.
// start-regtest.sh then starts the one test Brave again.
function restartBrave(): void {
  const script = join(dirname(fileURLToPath(import.meta.url)), "brave.sh");
  const stopped = spawnSync("bash", [script, "stop"], { stdio: "inherit" });
  if (stopped.status !== 0) throw new Error("Brave did not stop");
  startNodeAndBrowser();
}

export async function resetWallet(): Promise<void> {
  console.log("reset wallet before mining");
  await ensurePlate();
  await panelClick("openDevSettingsButton");
  await panelEval(`(() => {
    const el = document.getElementById("wipeWallet");
    el.value = "DELETE ALL FILES";
    el.dispatchEvent(new Event("input", {bubbles:true}));
    if (typeof el.oninput === "function") el.oninput();
    return 1;
  })()`);
  const wiped = await pollText((x) => x.includes("GENERATE SEEDPHRASE"), 60000, "wipe");
  if (!wiped) throw new Error("wipe did not finish");
  await panelClick("generate");
  await panelClick("finish-setup");
  const made = await pollText((x) => x.includes("0 XMR"), 60000, "new wallet");
  if (!made) throw new Error("new wallet did not finish");
  // onboarding stores a public node. point at regtest before the worker scans it.
  await useRegtestNodeBeforeRestart();
  await reloadWalletBackground();
}

// a new wallet file points at a public node. tests need the regtest node.
// stop the worker, write the local url, drop caches, then the caller restarts brave.
export async function useRegtestNodeBeforeRestart(): Promise<void> {
  const wrote = await panelEval(`(async () => {
    try { await window.wallets?.stopWorker?.(); } catch {}
    const db = await new Promise((resolve, reject) => {
      const req = indexedDB.open("files");
      req.onerror = () => reject(req.error);
      req.onsuccess = () => resolve(req.result);
    });
    const read = db.transaction("files").objectStore("files");
    const text = await new Promise((resolve, reject) => {
      const req = read.get("ScanSettings.json");
      req.onerror = () => reject(req.error);
      req.onsuccess = () => resolve(req.result || "");
    });
    const keys = await new Promise((resolve, reject) => {
      const req = db.transaction("files").objectStore("files").getAllKeys();
      req.onerror = () => reject(req.error);
      req.onsuccess = () => resolve(req.result || []);
    });
    if (!text) return 0;
    const settings = JSON.parse(text);
    settings.node_url = ${JSON.stringify(NODE)};
    settings.start_height = 0;
    const tx = db.transaction("files", "readwrite");
    const store = tx.objectStore("files");
    store.put(JSON.stringify(settings, null, 2), "ScanSettings.json");
    for (const key of keys) {
      if (typeof key !== "string") continue;
      if (key.endsWith("_cache.json") || key.endsWith("_stats.json") || key.startsWith("ConnectionStatus")) {
        store.delete(key);
      }
    }
    await new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve(1);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
    return 1;
  })()`);
  if (wrote !== 1) throw new Error("did not point the new wallet at regtest");
}

export async function reloadWalletBackground(): Promise<void> {
  // The background worker keeps the old wallet until Brave starts again.
  restartBrave();
  await ensureSidePanel();
}

async function pollText(want: (x: string) => boolean, timeoutMs: number, label: string): Promise<string | null> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const t = await panelText();
    if (want(t)) return t;
    await new Promise((r) => setTimeout(r, 3000));
  }
  console.log("timeout waiting " + label);
  return null;
}

export async function reviveSidebar(): Promise<void> {
  await ensureSidePanel();
  const { ws, send } = await cdp();
  try {
    const start = Date.now();
    while (Date.now() - start < 10000) {
      const t = await targetByUrl("sidebar.html").catch(() => null);
      if (!t) {
        await new Promise((rr) => setTimeout(rr, 300));
        continue;
      }
      const s = await send("Target.attachToTarget", { targetId: t.id, flatten: true }).catch(() => null);
      if (!s?.sessionId) {
        await new Promise((rr) => setTimeout(rr, 300));
        continue;
      }
      await send("Runtime.enable", {}, s.sessionId).catch(() => null);
      const r = await send("Runtime.evaluate", {
        expression: `(async () => {
          if (document.body && document.body.innerText.length > 50) return document.body.innerText.length;
          const src = document.scripts[0] && document.scripts[0].src;
          if (src) await import(src);
          await new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)));
          return document.body ? document.body.innerText.length : 0;
        })()`,
        awaitPromise: true,
        returnByValue: true,
      }, s.sessionId).catch(() => null);
      if ((r?.result?.value ?? 0) > 50) return;
      await new Promise((rr) => setTimeout(rr, 300));
    }
  } finally {
    ws.close();
  }
  throw new Error("side panel stayed blank");
}

function shopScanIsStale(root: string): boolean {
  const statusPath = join(root, "wallet-caches/ConnectionStatus-ScanSettings.json");
  if (!existsSync(statusPath)) return false;
  const status = JSON.parse(readFileSync(statusPath, "utf8"));
  return status?.last_packet?.status === "catastrophic_reorg";
}

async function shopHttpCode(port: number): Promise<string | null> {
  for (const path of ["/login", "/"]) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}${path}`, { signal: AbortSignal.timeout(2000) });
      if (r.status >= 100 && r.status < 600) return String(r.status);
    } catch {
      // not up yet
    }
  }
  return null;
}

function logTail(path: string): string {
  if (!existsSync(path)) return "no log at " + path;
  const lines = readFileSync(path, "utf8").trim().split("\n");
  return lines.slice(-15).join("\n");
}

async function waitForShop(port: number, logPath: string, timeoutMs: number): Promise<boolean> {
  const start = Date.now();
  let lastLog = 0;
  while (Date.now() - start < timeoutMs) {
    const code = await shopHttpCode(port);
    if (code) {
      console.log("shop up", port, code);
      return true;
    }
    if (Date.now() - lastLog > 2000) {
      lastLog = Date.now();
      console.log("waiting for shop", port, Math.round((Date.now() - start) / 1000) + "s");
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  console.log("shop log", port, "\n" + logTail(logPath));
  return false;
}

async function pointShopAtRegtest(root: string, port: number, startCmd: string, logPath: string) {
  const settingsPath = join(root, "wallet-caches/ScanSettings.json");
  if (!existsSync(settingsPath)) return;
  const settings = JSON.parse(readFileSync(settingsPath, "utf8"));
  const wrongNode = settings.node_url !== NODE;
  const stale = shopScanIsStale(root);
  if (!wrongNode && !stale) {
    console.log("shop on regtest", port);
    return;
  }
  if (wrongNode) {
    console.log("set shop node", settings.node_url, "->", NODE, "port", port);
    settings.node_url = NODE;
    settings.start_height = 0;
    writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
  } else {
    console.log("shop scan is stale, clearing caches", port);
  }
  const dir = join(root, "wallet-caches");
  for (const name of readdirSync(dir)) {
    if (name.endsWith("_cache.json") || name.endsWith("_stats.json") || name.startsWith("ConnectionStatus")) {
      rmSync(join(dir, name));
    }
  }
  console.log("restarting shop", port);
  for (let attempt = 1; attempt <= 2; attempt++) {
    spawnSync("bash", ["-lc", `fuser -k ${port}/tcp >/dev/null 2>&1 || true`], { timeout: 5000 });
    await new Promise((r) => setTimeout(r, 300));
    // do not wait on the shop process. a trailing & still keeps spawnSync open.
    const child = spawn("bash", ["-lc", startCmd.replace(/\s*&\s*$/, "")], {
      detached: true,
      stdio: "ignore",
    });
    child.unref();
    if (await waitForShop(port, logPath, 20000)) return;
    console.log("shop did not answer, retry", port, attempt);
  }
  throw new Error("shop did not come back on port " + port);
}

export async function pointShopsAtRegtest(origin?: string) {
  const projects = join(dirname(fileURLToPath(import.meta.url)), "../..");
  const want3004 = origin?.includes(":3004");
  if (!want3004) {
    const root = process.env.SHOP_ROOT || join(projects, "monero-payment-links");
    await pointShopAtRegtest(
      root,
      3003,
      "cd " + root + " && setsid bun run production >/tmp/payment-links.log 2>&1 </dev/null &",
      "/tmp/payment-links.log",
    );
    return;
  }
  await pointShopAtRegtest(
    join(projects, "monero-wallet-api/standard-checkout"),
    3004,
    "cd " + join(projects, "monero-wallet-api/standard-checkout") + " && setsid bun checkout.ts >/tmp/standard-checkout.log 2>&1 </dev/null &",
    "/tmp/standard-checkout.log",
  );
}

export async function ensureHealthyWallet(): Promise<string> {
  startNodeAndBrowser();
  await pointShopsAtRegtest();
  await ensureSidePanel();
  await reviveSidebar();
  const h = await nodeHeight();
  if (h < 1) throw new Error("node down, start it first");
  console.log("node height", h);
  if (await needsReorgReset()) await resetWallet();
  if ((await panelText()).includes("GENERATE SEEDPHRASE")) {
    await panelClick("generate");
    await panelClick("finish-setup");
    const made = await pollText((x) => x.includes("0 XMR"), 60000, "new wallet");
    if (!made) throw new Error("new wallet did not finish");
    await useRegtestNodeBeforeRestart();
    restartBrave();
    await ensureSidePanel();
  }
  // node url. skip the click when the worker is already connected.
  const connected = await panelEval(`window.wallets?.connectionStatusOpened?.isConnected === true`);
  if (!connected) {
    await ensurePlate();
    await panelEval(`(() => { const a = document.getElementById("nodeUrl"); a.value = ${JSON.stringify(NODE)}; a.dispatchEvent(new Event("input", {bubbles:true})); const b = document.getElementById("startHeight"); b.value = "0"; b.dispatchEvent(new Event("input", {bubbles:true})); return 1; })()`);
    await panelClick("saveNodeUrl");
    await pollText((x) => x.includes("saved"), 20000, "save confirm");
  } else {
    console.log("node already connected");
  }
  // fund + decoy depth
  const addr = await panelEval(`window.wallets.wallets[0].primary_address`);
  console.log("wallet", String(addr).slice(0, 12));
  const bal = await panelText().then((x) => {
    const digits = x.match(/(\d+\.\d+) XMR/)?.[1];
    return digits ? parseFloat(digits) : 0;
  });
  if (!(bal > 0)) {
    await mineTo(addr, 1);
  }
  // a short coinbase-only chain can leave too few unlocked decoys in a sample.
  const height = await nodeHeight();
  if (height < 10000) {
    await mineTo(DECOY_ADDR, 10000 - height);
  }
  // unlock spending power, skip when already spendable
  const spendable = await panelText().then((x) => {
    const digits = x.match(/(\d+\.\d+) XMR/)?.[1];
    return !!digits && parseFloat(digits) > 1;
  });
  if (spendable) {
    console.log("already spendable, skipping unlock mining");
    return addr;
  }
  // a coinbase reward unlocks after 60 blocks.
  for (let round = 0; round < 3; round++) {
    await mineTo(DECOY_ADDR, 60);
    const ok = await pollText((x) => {
      const digits = x.match(/(\d+\.\d+) XMR/)?.[1];
      return !!digits && parseFloat(digits) > 1;
    }, 90000, "unlocked funds");
    if (ok) break;
  }
  const final = await panelText().then((x) => x.match(/(\d+\.\d+) XMR/)?.[1]);
  console.log("funded, balance", final);
  return addr;
}
