import { Database } from "bun:sqlite";
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
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
  const dbPath = join(dirname(fileURLToPath(import.meta.url)), "../../monero-payment-links/monero_payments.db");
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

function restartBrave(): void {
  const killed = spawnSync("bash", ["-lc", `
    pid=$(ps -eo pid,args | awk '/opt\\/brave.com\\/brave\\/brave / && /testdata\\/brave-profile/ && /remote-debugging-port=9222/ && $0 !~ /type=/ {print $1; exit}')
    if [ -n "$pid" ]; then kill "$pid"; fi
    for i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15; do
      curl -sf -m 1 http://127.0.0.1:9222/json/version >/dev/null || exit 0
      sleep 0.4
    done
    exit 1
  `], { stdio: "inherit" });
  if (killed.status !== 0) throw new Error("Brave did not stop");
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
  await reloadWalletBackground();
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

async function pointShopAtRegtest(root: string, port: number, startCmd: string) {
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
  spawnSync("bash", ["-lc", `fuser -k ${port}/tcp >/dev/null 2>&1 || true`]);
  spawnSync("bash", ["-lc", startCmd]);
  const start = Date.now();
  while (Date.now() - start < 90000) {
    const probe = spawnSync("curl", ["-s", "-m", "2", "-o", "/dev/null", "-w", "%{http_code}", `http://127.0.0.1:${port}/`], { encoding: "utf8" });
    const code = (probe.stdout || "").trim();
    if (/^[1-5][0-9][0-9]$/.test(code)) {
      console.log("shop up", port, code);
      return;
    }
    if (Date.now() - start > 2000 && ((Date.now() - start) % 5000) < 600) console.log("waiting for shop", port);
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("shop did not come back on port " + port);
}

export async function pointShopsAtRegtest(origin?: string) {
  const projects = join(dirname(fileURLToPath(import.meta.url)), "../..");
  const want3004 = origin?.includes(":3004");
  if (!want3004) {
    await pointShopAtRegtest(
      join(projects, "monero-payment-links"),
      3003,
      "cd " + join(projects, "monero-payment-links") + " && setsid bun run production >/tmp/payment-links.log 2>&1 </dev/null &",
    );
    return;
  }
  await pointShopAtRegtest(
    join(projects, "monero-wallet-api/standard-checkout"),
    3004,
    "cd " + join(projects, "monero-wallet-api/standard-checkout") + " && setsid bun checkout.ts >/tmp/standard-checkout.log 2>&1 </dev/null &",
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
  if ((await nodeHeight()) < 1000) {
    await mineTo(DECOY_ADDR, 1000);
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
  for (let round = 0; round < 3; round++) {
    await mineTo(DECOY_ADDR, 12);
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
