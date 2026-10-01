// Run test/start-regtest.sh when port 18081 or port 9222 does not answer.
// The script does not start a second node or a second browser.
// setup.ts calls the same script. main() calls it too.
// monerod: testdata/moneronode/monerod from test/download-monerod.ts
// data dir: testdata/regtest
// log: testdata/monerod.log
// Brave profile: testdata/brave-profile
// Extension: dist/chrome
// Brave log: testdata/brave.log
// Shop: ../monero-payment-links via bun run production. Clone only when that folder is absent.
import { cdp, ensureSidePanel } from "./cdp";
import { needsReorgReset, reloadWalletBackground, resetWallet, reviveSidebar, startNodeAndBrowser } from "./setup";
// resetWallet restarts Brave so the background loads the new wallet.
// Full wallet pass on the real side panel. Never opens sidebar.html as a tab.
// Every check senses UI state (plate, slider, open calls) plus app state
// (balance, pool) first, acts on what it finds, verifies the effect, and
// retries once from a fresh sense before failing. No fixed positions,
// no baked-in UI assumptions.
// Usage: bun test/wallettest.ts

const NODE = "http://127.0.0.1:18081";
const SEND_ADDR = "47cYSGSjzWPX3KFEN9PaxT5zpWKgRtx568bazbGzt57ffBbUAQevjMk19sfZCrMB1RWHNJLbz1eKU63B77HpHwUVA6JGudr";
const DECOY_ADDR = SEND_ADDR;
const FUND_MIN = 0.3;

let ws: WebSocket;
let send: (method: string, params?: Record<string, unknown>, sessionId?: string) => Promise<any>;
let sessionId: string;
let panelId: string;

async function attach(): Promise<void> {
  // sidebar.html can be the real side panel or a tab. the real panel has no window id.
  // a reload closes the panel and changes the target id. attach again. skip a blank body.
  let list: any[] = await (await fetch("http://127.0.0.1:9222/json/list")).json();
  let cands = list.filter((x) => (x.url || "").includes("sidebar.html"));
  if (!cands.length) {
    await ensureSidePanel(send);
    list = await (await fetch("http://127.0.0.1:9222/json/list")).json();
    cands = list.filter((x) => (x.url || "").includes("sidebar.html"));
  }
  if (!cands.length) throw new Error("no sidebar target");
  let lastErr = "";
  for (const t of cands) {
    try {
      const attached = await send("Target.attachToTarget", { targetId: t.id, flatten: true });
      const s = attached.sessionId;
      await send("Runtime.enable", {}, s);
      let len = -1;
      const bodyStart = Date.now();
      while (Date.now() - bodyStart < 8000) {
        const body = await send("Runtime.evaluate", { expression: `document.body ? document.body.innerText.length : -1`, returnByValue: true }, s);
        len = body.result?.value ?? -1;
        if (len > 50) break;
        await new Promise((r) => setTimeout(r, 200));
      }
      if (len > 50) {
        panelId = t.id;
        sessionId = s;
        return;
      }
      lastErr = "blank body on " + t.id.slice(0, 8);
    } catch (e) {
      lastErr = String((e as Error)?.message || e).slice(0, 80);
    }
  }
  throw new Error("no live panel: " + lastErr);
}

async function init(): Promise<void> {
  const c = await cdp();
  ws = c.ws;
  send = c.send;
  await attach();
}

async function ev(expr: string): Promise<any> {
  const run = async () => {
    const res = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true }, sessionId);
    if (res.exceptionDetails) {
      const d = res.exceptionDetails;
      throw new Error(d.exception?.description || d.text || "eval failed");
    }
    return res.result?.value;
  };
  try {
    return await run();
  } catch {
    await attach();
    return await run();
  }
}

async function text(): Promise<string> {
  return (await ev(`document.body.innerText`)) ?? "";
}

type UiState = {
  plate: string | null;
  unlocked: boolean;
  balance: number;
};

async function senseUi(): Promise<UiState> {
  const raw = await ev(`(() => {
    const body = document.body ? document.body.innerText : "";
    const m = body.match(/(\\d+(?:\\.\\d+)?) XMR/);
    return JSON.stringify({
      plate: window.activeWalletPlate ?? null,
      unlocked: window.unlocked === true,
      balance: m ? parseFloat(m[1]) : 0,
    });
  })()`);
  if (!raw) return { plate: null, unlocked: false, balance: 0 };
  return JSON.parse(raw);
}

async function spendable(): Promise<number> {
  // the fire label shows the unlocked amount. it is truncated.
  // pending funds are a second line. they cannot be spent.
  const n = await ev(`(() => { const w = window.wallets && window.wallets.wallets && window.wallets.wallets[0]; if (!w || w.amount == null) return -1; return Number(w.amount) / 1e12; })()`);
  return typeof n === "number" ? n : -1;
}

async function rectOf(elId: string): Promise<{ x: number; y: number } | null> {
  const r = await ev(`(() => { const el = document.getElementById(${JSON.stringify(elId)}); if (!el) return null; el.scrollIntoView({block:"center"}); const b = el.getBoundingClientRect(); if (!b.width || !b.height) return null; return JSON.stringify({x: b.x+b.width/2, y: b.y+b.height/2}); })()`);
  if (!r) return null;
  return JSON.parse(r);
}

async function dispatchClick(p: { x: number; y: number }): Promise<void> {
  await send("Input.dispatchMouseEvent", { type: "mousePressed", x: p.x, y: p.y, button: "left", clickCount: 1 }, sessionId);
  await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: p.x, y: p.y, button: "left", clickCount: 1 }, sessionId);
}

async function clickId(elId: string): Promise<void> {
  const p = await rectOf(elId);
  if (!p) throw new Error("missing element " + elId);
  await dispatchClick(p);
}

async function ensurePlate(id: string): Promise<void> {
  // plate ids are send, receive, history, connection, and wallets.
  // a second click closes the open plate.
  const cur = await ev(`window.activeWalletPlate`);
  if (cur !== id) {
    await clickId(id);
    const flagged = await poll(async () => ev(`window.activeWalletPlate`), (x) => x === id, 15000, "plate " + id);
    if (!flagged) throw new Error("plate " + id + " did not open");
  }
}

async function waitFor(elId: string): Promise<void> {
  const ok = await poll(async () => ev(`(() => { const el = document.getElementById(${JSON.stringify(elId)}); if (!el) return false; const b = el.getBoundingClientRect(); return b.width > 0 && b.height > 0; })()`), (x) => x === true, 8000, elId);
  if (!ok) throw new Error("missing element " + elId);
}

async function setInput(elId: string, value: string): Promise<void> {
  await ev(`(() => { const el = document.getElementById(${JSON.stringify(elId)}); el.value = ${JSON.stringify(value)}; el.dispatchEvent(new Event("input", {bubbles:true})); if (typeof el.oninput === "function") el.oninput(); return 1; })()`);
}

async function fieldValue(elId: string): Promise<string> {
  const v = await ev(`(() => { const el = document.getElementById(${JSON.stringify(elId)}); return el ? el.value : ""; })()`);
  return v ?? "";
}

async function idbGet(key: string): Promise<string> {
  const raw = await ev(`(async () => {
    const db = await new Promise((resolve, reject) => { const req = indexedDB.open("files"); req.onerror = () => reject(req.error); req.onsuccess = () => resolve(req.result); });
    const text = await new Promise((resolve, reject) => { const req = db.transaction("files").objectStore("files").get(${JSON.stringify(key)}); req.onerror = () => reject(req.error); req.onsuccess = () => resolve(req.result || ""); });
    return typeof text === "string" ? text : "";
  })()`);
  return raw || "";
}

async function scanSettings(): Promise<{ node_url?: string; start_height?: number | null }> {
  const raw = await idbGet("ScanSettings.json");
  return raw ? JSON.parse(raw) : {};
}

async function connectionStatus(): Promise<{ status: string; scan: number; daemon: number } | null> {
  const raw = await idbGet("ConnectionStatus-ScanSettings.json");
  if (!raw) return null;
  const c = JSON.parse(raw);
  return {
    status: c.last_packet?.status || "",
    scan: c.sync?.current_scan_height || 0,
    daemon: c.sync?.daemon_height || c.last_packet?.daemon_height || 0,
  };
}

async function poll<T>(fn: () => Promise<T>, want: (v: T) => boolean, timeoutMs: number, label: string): Promise<T | null> {
  const start = Date.now();
  let ticks = 0;
  while (Date.now() - start < timeoutMs) {
    try {
      const v = await fn();
      if (want(v)) return v;
    } catch { /* target hiccup, retry */ }
    ticks++;
    if (ticks % 5 === 0) console.log(`..still waiting ${label} (${Math.round((Date.now() - start) / 1000)}s)`);
    await new Promise((r) => setTimeout(r, 2000));
  }
  console.log(" timeout waiting " + label);
  return null;
}

const results: { name: string; ok: boolean; detail: string }[] = [];
function check(name: string, ok: boolean, detail = ""): void {
  results.push({ name, ok: !!ok, detail });
  console.log((ok ? "PASS " : "FAIL ") + name + (detail ? " | " + detail : ""));
}

async function nodeHeight(): Promise<number> {
  try {
    return (await fetch(NODE + "/get_height").then((x) => x.json())).height;
  } catch {
    return -1;
  }
}

async function poolSize(): Promise<number> {
  try {
    const r = await fetch(NODE + "/get_transaction_pool").then((x) => x.json());
    return (r.transactions || []).length;
  } catch {
    return -1;
  }
}

async function mineChunk(addr: string, n: number): Promise<number> {
  const r = await fetch(NODE + "/json_rpc", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: "0", method: "generateblocks", params: { amount_of_blocks: n, wallet_address: addr } }),
  }).then((x) => x.json());
  if (r.error) throw new Error("mine failed: " + JSON.stringify(r.error).slice(0, 120));
  return r.result.height;
}

async function mineTo(addr: string, n: number): Promise<void> {
  let left = n;
  while (left > 0) {
    const chunk = Math.min(left, 100);
    const h = await mineChunk(addr, chunk);
    left -= chunk;
    console.log(`mined ${n - left}/${n} height=${h}`);
  }
}

// Run fn, verify with checkFn, else re-sense and retry once, then fail.
async function attempt(name: string, fn: () => Promise<void>, verify: () => Promise<{ ok: boolean; detail: string }>): Promise<void> {
  console.log("-- " + name);
  for (let round = 0; round < 2; round++) {
    try {
      await fn();
    } catch (e) {
      if (round === 1) {
        check(name, false, String((e as Error)?.message || e));
        return;
      }
      continue;
    }
    const v = await verify().catch(() => ({ ok: false, detail: "verify crashed" }));
    if (v.ok) {
      check(name, true, v.detail);
      return;
    }
    if (round === 1) check(name, false, v.detail);
  }
}

async function dismissStrayCalls(): Promise<void> {
  // an open spend tool call makes SEND post execute.
  // dismiss it so this send lets the worker pick the inputs.
  const ids: string[] = (await ev(`window.wallets.actionLogOpened.getActiveByPermissions(["spend"]).map(x => x.invocationId)`)) ?? [];
  for (const id of ids) {
    await ev(`window.wallets.actionLogOpened.dismiss(${JSON.stringify(id)})`);
  }
}

async function main(): Promise<void> {
  startNodeAndBrowser();
  await reviveSidebar();
  await init();

  // use only the local regtest node. read /get_height.
  // do not trust a mine button alone.
  await attempt("node answers", async () => {}, async () => {
    const h = await nodeHeight();
    return h >= 0 ? { ok: true, detail: "height " + h } : { ok: false, detail: "node down" };
  });

  // a chain that does not match the cache replaces the top area.
  // the text is "catastrophic reorg occured".
  await attempt("panel renders with wallet", async () => {}, async () => {
    const ui = await senseUi();
    const t = await text();
    const live = !!ui.plate || ui.balance > 0 || t.includes("0 XMR") || t.includes("GENERATE SEEDPHRASE") || t.includes("catastrophic reorg");
    return live ? { ok: true, detail: `plate=${ui.plate} bal=${ui.balance}` } : { ok: false, detail: "blank panel" };
  });

  // do not send from a reorg cache. wipe with DELETE ALL FILES.
  // then generate words and finish setup.
  // the panel reloads onto onboarding, then to main/no_domain/single/0.
  // a new wallet shows 0 XMR.
  await attempt("no reorg or reset done", async () => {
    if (await needsReorgReset()) await resetWallet();
    const t = await text();
    if (!t.includes("GENERATE SEEDPHRASE")) return;
    await clickId("generate");
    await clickId("finish-setup");
    const made = await poll(async () => text(), (x) => x.includes("0 XMR"), 60000, "new wallet");
    if (!made) throw new Error("new wallet did not finish");
    await reloadWalletBackground();
  }, async () => {
    const t = await text();
    const ok = !t.includes("catastrophic reorg") && !t.includes("GENERATE SEEDPHRASE");
    return ok ? { ok: true, detail: "" } : { ok: false, detail: "still onboarding or reorg" };
  });

  // reset puts the fields back. it does not change the worker.
  // start height 0 scans from the start. an empty start height means the chain tip.
  // save points the worker at this node.
  await attempt("node url saved", async () => {
    await ensurePlate("connection");
    await waitFor("resetNodeUrl");
    await clickId("resetNodeUrl");
    const reset = await poll(async () => text(), (x) => x.includes("reset"), 10000, "node reset");
    if (!reset) throw new Error("reset did not show");
    await setInput("nodeUrl", NODE);
    await setInput("startHeight", "0");
    await clickId("saveNodeUrl");
    const stored = await poll(scanSettings, (f) => f.node_url === NODE && f.start_height === 0, 20000, "scan settings");
    if (!stored) throw new Error("start height is empty or node url was not stored");
    const cs = await poll(connectionStatus, (c) => !!c && (c.status === "OK" || c.status === "blocks_buffer_full") && c.daemon > 0, 40000, "connection status");
    if (!cs) throw new Error("connection status did not show the daemon");
  }, async () => {
    const file = await scanSettings();
    const cs = await connectionStatus();
    const ok = file.node_url === NODE && file.start_height === 0 && !!cs && cs.daemon > 0 && (cs.status === "OK" || cs.status === "blocks_buffer_full");
    return ok ? { ok: true, detail: `scan=${cs?.scan} daemon=${cs?.daemon} ${cs?.status}` } : { ok: false, detail: `node=${file.node_url} start=${file.start_height} status=${cs?.status || "none"}` };
  });

  // reset reads the settings file. it does not write it.
  // start height 3 is not the open-time value, so a stale memory read fails.
  // a typed url must not stick. put start height back to 0 for the scan tests.
  await attempt("node fields reset", async () => {
    await ensurePlate("connection");
    await waitFor("saveNodeUrl");
    await setInput("nodeUrl", NODE);
    await setInput("startHeight", "3");
    await clickId("saveNodeUrl");
    const stored = await poll(scanSettings, (f) => f.node_url === NODE && f.start_height === 3, 20000, "start height 3");
    if (!stored) throw new Error("start height 3 was not stored");
    await setInput("nodeUrl", "http://127.0.0.1:19999");
    await setInput("startHeight", "77");
    await clickId("resetNodeUrl");
    const fields = await poll(async () => ({ node: await fieldValue("nodeUrl"), height: await fieldValue("startHeight") }), (f) => f.node === NODE && f.height === "3", 10000, "reset fields");
    if (!fields) throw new Error("reset did not put the stored node url and start height back");
    const file = await scanSettings();
    if (file.node_url !== NODE || file.start_height !== 3) throw new Error("reset wrote the settings file");
    await setInput("nodeUrl", NODE);
    await setInput("startHeight", "0");
    await clickId("saveNodeUrl");
    const back = await poll(scanSettings, (f) => f.node_url === NODE && f.start_height === 0, 20000, "start height 0");
    if (!back) throw new Error("start height 0 was not stored");
  }, async () => {
    const file = await scanSettings();
    const node = await fieldValue("nodeUrl");
    const height = await fieldValue("startHeight");
    const ok = file.node_url === NODE && file.start_height === 0 && node === NODE && height === "0";
    return ok ? { ok: true, detail: "" } : { ok: false, detail: `file=${file.node_url} start=${file.start_height} node=${node} height=${height}` };
  });

  // a coinbase reward unlocks after 60 blocks.
  // change from a send stays pending until it unlocks.
  // a short chain fails the send. the wallet samples decoys once. it does not retry.
  // mine past about 1000 blocks first.
  await attempt("funded with decoy depth", async () => {
    const h = await nodeHeight();
    if (h < 1000) await mineTo(DECOY_ADDR, 1000 - h);
    const cs = await connectionStatus();
    if (!cs || cs.daemon < 1) throw new Error("not connected, daemon " + (cs?.daemon ?? "none"));
    const addr = await ev(`window.wallets.wallets[0].primary_address`);
    if (!addr) throw new Error("no wallet address");
    for (let round = 0; round < 3 && (await spendable()) <= FUND_MIN; round++) {
      if (round === 0) await mineTo(addr, 1);
      await mineTo(DECOY_ADDR, 60);
      const caught = await poll(async () => {
        const now = await connectionStatus();
        const bal = await spendable();
        if (now) console.log(`..scan=${now.scan} daemon=${now.daemon} ${now.status} bal=${bal}`);
        return { now, bal };
      }, (s) => s.bal > FUND_MIN && !!s.now && s.now.scan + 2 >= s.now.daemon, 90000, "scan to unlocked funds");
      if (caught) break;
    }
    if ((await spendable()) <= FUND_MIN) throw new Error("scan did not unlock funds");
    if ((await poolSize()) > 0) await mineTo(DECOY_ADDR, 1);
    const drained = await poll(poolSize, (x) => x === 0, 15000, "pool drain");
    if (drained === null) throw new Error("pool did not empty after mining");
  }, async () => {
    const bal = await spendable();
    const pool = await poolSize();
    return bal > FUND_MIN && pool === 0 ? { ok: true, detail: String(bal) } : { ok: false, detail: "bal=" + bal + " pool=" + pool };
  });

  // safe keeps send locked. fire sets window.unlocked.
  // SEND returns at once when the slider is not on fire.
  await attempt("slider on fire", async () => {
    const ui = await senseUi();
    if (!ui.unlocked) await clickId("fire");
  }, async () => {
    const ui = await senseUi();
    return ui.unlocked ? { ok: true, detail: "" } : { ok: false, detail: "still safe" };
  });

  // coin control must be off. the link then says "coin control", not "standard transaction".
  // the panel does not build or sign. it posts the worker message.
  // the pool grows by one. the status line says "successfully sent transaction".
  let sendConfirmed = false;
  let sendBefore = -1;
  await attempt("standard send reaches pool", async () => {
    if (sendConfirmed) return;
    if (sendBefore >= 0 && (await poolSize()) === sendBefore + 1) {
      sendConfirmed = true;
      return;
    }
    await dismissStrayCalls();
    const ui = await senseUi();
    if (!ui.unlocked) await clickId("fire");
    await ensurePlate("send");
    await waitFor("openCoinControlButton");
    const ccLabel = await ev(`document.getElementById("openCoinControlButton").textContent || ""`);
    if (String(ccLabel).includes("standard")) {
      await clickId("openCoinControlButton");
    }
    await waitFor("amountInput");
    await setInput("amountInput", "0.2");
    await setInput("addressInput", SEND_ADDR);
    const parsed = await poll(async () => text(), (x) => !x.includes("invalid address") && x.includes("selected amount"), 20000, "parse");
    if (!parsed) throw new Error("address never parsed");
    sendBefore = await poolSize();
    if (sendBefore < 0) throw new Error("pool unreadable");
    const beforeText = await text();
    const hadStatus = beforeText.includes("successfully sent transaction");
    const hadFail = beforeText.includes("failed to send transaction");
    await clickId("send-action");
    const hit = await poll(async () => {
      const p = await poolSize();
      if (p === sendBefore + 1) return "pool";
      const t = await text();
      if (t.includes("exceeds unlocked funds") && (await spendable()) <= FUND_MIN) return "locked";
      if (!hadStatus && t.includes("successfully sent transaction")) return "status";
      if (!hadFail && t.includes("failed to send transaction")) return "failed";
      return "";
    }, (x) => x !== "", 180000, "send confirm");
    if (hit === "pool" || hit === "status") {
      sendConfirmed = true;
      return;
    }
    throw new Error(`send not confirmed, pool at ${sendBefore}`);
  }, async () => {
    return sendConfirmed ? { ok: true, detail: "confirmed" } : { ok: false, detail: "send not confirmed" };
  });

  // the receive plate shows the address a payer uses.
  // that row can be a subaddress, not the primary address.
  await attempt("receive shows address", async () => {
    await ensurePlate("receive");
  }, async () => {
    const addr = await ev(`(() => { const w = window.wallets.wallets[0]; const sub = w.subaddresses && w.subaddresses[0] && w.subaddresses[0].address; return sub || w.primary_address; })()`);
    const t = await poll(async () => text(), (x) => typeof addr === "string" && addr.length > 10 && x.includes(addr), 8000, "receive address");
    return t ? { ok: true, detail: "" } : { ok: false, detail: "address not on plate" };
  });

  // history keeps each transaction. "show details" opens inputs, outputs, and change.
  // connection shows daemon height only while the node answers.
  // a wallet route is identity/domain/wallet_type/wallet_slot. the default starts with main/.
  for (const [name, plate, want] of [
    ["history lists tx", "history", "show details"],
    ["connection shows heights", "connection", "daemon height"],
    ["wallets lists routes", "wallets", "main/"],
  ] as [string, string, string][]) {
    await attempt(name, async () => {
      await ensurePlate(plate);
    }, async () => {
      const t = await poll(async () => text(), (x) => x.includes(want), 8000, name);
      return t ? { ok: true, detail: "" } : { ok: false, detail: (await text()).slice(0, 60) };
    });
  }

  // open coin control and the link becomes "standard transaction".
  // the plate shows add output and select input.
  // that mode spends the inputs you tick. this check opens it and closes it. it does not send.
  await attempt("coin control toggles", async () => {
    await ensurePlate("send");
    await waitFor("openCoinControlButton");
    const openNow = await text();
    if (!openNow.includes("select input") && !openNow.includes("add output")) {
      await clickId("openCoinControlButton");
      const opened = await poll(async () => text(), (x) => x.includes("select input") || x.includes("add output"), 10000, "coin control open");
      if (!opened) throw new Error("coin control did not open");
    }
    await clickId("openCoinControlButton");
    const closed = await poll(async () => text(), (x) => x.includes("coin control") && !x.includes("select input"), 10000, "coin control close");
    if (!closed) throw new Error("coin control did not close");
  }, async () => {
    const t = await text();
    const ok = t.includes("coin control") && !t.includes("select input");
    return ok ? { ok: true, detail: "" } : { ok: false, detail: t.slice(0, 60) };
  });

  // put the slider back on safe so a later click cannot spend.
  await attempt("slider back on safe", async () => {
    const ui = await senseUi();
    if (ui.unlocked) await clickId("safe");
  }, async () => {
    const ui = await senseUi();
    return !ui.unlocked ? { ok: true, detail: "" } : { ok: false, detail: "still fire" };
  });

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  try { ws.close(); } catch { /* already gone */ }
  process.exit(failed.length ? 1 : 0);
}

await main().catch(async (e) => {
  console.log("FATAL " + ((e as Error)?.message || e));
  try { ws.close(); } catch { /* already gone */ }
  process.exit(2);
});
