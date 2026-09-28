// Adapt the paths below to your local dev environment.
// Start the regtest node only when port 18081 does not answer. Leave it up if it already answers.
// The monerod binary is in the monero-wallet-api repo:
// /path/to/monero-wallet-api/typescript/tests/moneronode/monerod
// mkdir -p /tmp/monero-regtest-coincontrol
// /path/to/monero-wallet-api/typescript/tests/moneronode/monerod \
//   --regtest --offline --fixed-difficulty 1 \
//   --rpc-bind-ip 127.0.0.1 --rpc-bind-port 18081 \
//   --data-dir /tmp/monero-regtest-coincontrol \
//   --non-interactive \
//   --log-file /tmp/monerod-coincontrol.log
// Start Brave only when port 9222 does not answer. Do not start a second one.
// brave-browser \
//   --user-data-dir="$HOME/.local/share/monerochan wallet dev" \
//   --remote-debugging-port=9222 \
//   --remote-allow-origins=http://127.0.0.1:9222 \
//   --load-extension="/path/to/monerochan wallet dev/dist/chrome" \
//   --disable-extensions-except="/path/to/monerochan wallet dev/dist/chrome"
import { cdp } from "./cdp";
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
  const list: any[] = await (await fetch("http://127.0.0.1:9222/json/list")).json();
  const cands = list.filter((x) => (x.url || "").includes("sidebar.html"));
  if (!cands.length) throw new Error("no sidebar target");
  let lastErr = "";
  for (const t of cands) {
    try {
      const attached = await send("Target.attachToTarget", { targetId: t.id, flatten: true });
      const s = attached.sessionId;
      await send("Runtime.enable", {}, s);
      const body = await send("Runtime.evaluate", { expression: `document.body ? document.body.innerText.length : -1`, returnByValue: true }, s);
      if ((body.result?.value ?? -1) > 50) {
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
  await ev(`(() => { const el = document.getElementById(${JSON.stringify(elId)}); el.value = ${JSON.stringify(value)}; el.dispatchEvent(new Event("input", {bubbles:true})); return 1; })()`);
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
    if (!ui.plate && ui.balance === 0) {
      const t = await text();
      if (!t.includes("0 XMR") && !t.includes("catastrophic reorg")) {
        return { ok: false, detail: "blank panel" };
      }
    }
    return { ok: true, detail: `plate=${ui.plate} bal=${ui.balance}` };
  });

  // do not send from a reorg cache. wipe with DELETE ALL FILES.
  // then generate words and finish setup.
  // the panel reloads onto onboarding, then to main/no_domain/single/0.
  // a new wallet shows 0 XMR.
  await attempt("no reorg or reset done", async () => {
    const t = await text();
    if (!t.includes("catastrophic reorg")) return;
    await ensurePlate("connection");
    await clickId("openDevSettingsButton");
    await ev(`(() => { const el = document.getElementById("wipeWallet"); el.value = "DELETE ALL FILES"; el.dispatchEvent(new Event("input", {bubbles:true})); return 1; })()`);
    const wiped = await poll(async () => text(), (x) => x.includes("GENERATE SEEDPHRASE"), 60000, "wipe");
    if (!wiped) throw new Error("wipe did not finish");
    await clickId("generate");
    await clickId("finish-setup");
    await poll(async () => text(), (x) => x.includes("0 XMR"), 60000, "new wallet");
  }, async () => {
    const t = await text();
    return !t.includes("catastrophic reorg") ? { ok: true, detail: "" } : { ok: false, detail: "still reorged" };
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
  }, async () => {
    const t = await poll(async () => text(), (x) => x.includes("saved"), 20000, "save confirm");
    const url = await ev(`document.getElementById("nodeUrl") && document.getElementById("nodeUrl").value`);
    return t && url === NODE ? { ok: true, detail: "" } : { ok: false, detail: "no confirm" };
  });

  // a coinbase reward unlocks after 60 blocks.
  // change from a send stays pending until it unlocks.
  // a short chain fails the send. the wallet samples decoys once. it does not retry.
  // mine past about 1000 blocks first.
  await attempt("funded with decoy depth", async () => {
    const h = await nodeHeight();
    if ((await spendable()) <= 0) {
      const addr = await ev(`window.wallets.wallets[0].primary_address`);
      if (!addr) throw new Error("no wallet address");
      await mineTo(addr, 1);
    }
    if (h < 1500) await mineTo(DECOY_ADDR, 1000);
    for (let round = 0; round < 3; round++) {
      if ((await spendable()) > FUND_MIN && (await poolSize()) === 0) return;
      await mineTo(DECOY_ADDR, round === 0 ? 12 : 60);
      await poll(poolSize, (x) => x === 0, 60000, "pool drain");
      const done = await poll(spendable, (x) => x > FUND_MIN, 90000, "unlocked funds");
      if (done !== null && (await poolSize()) === 0) return;
    }
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
