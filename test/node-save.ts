// Save tests for the connection plate.
// Starts from a wiped wallet, so the first save is not mid-scan.
// Then waits until a scan is running and saves again.
// Usage: bun test/node-save.ts
import { cdp, debugHttp, ensureSidePanel } from "./cdp";
import { reloadWalletBackground, resetWallet, reviveSidebar, startNodeAndBrowser, useRegtestNodeBeforeRestart } from "./setup";

const LOCAL = "http://127.0.0.1:18081";
const SAME_NODE = "http://localhost:18081";

let ws: WebSocket;
let send: (method: string, params?: Record<string, unknown>, sessionId?: string) => Promise<any>;
let sessionId: string;

async function attach(): Promise<void> {
  let list: any[] = await (await fetch(debugHttp() + "/json/list")).json();
  let cands = list.filter((x) => (x.url || "").includes("sidebar.html"));
  if (!cands.length) {
    await ensureSidePanel(send);
    list = await (await fetch(debugHttp() + "/json/list")).json();
    cands = list.filter((x) => (x.url || "").includes("sidebar.html"));
  }
  if (!cands.length) throw new Error("no sidebar target");
  for (const t of cands) {
    try {
      const attached = await send("Target.attachToTarget", { targetId: t.id, flatten: true });
      const s = attached.sessionId;
      await send("Runtime.enable", {}, s);
      const body = await send("Runtime.evaluate", {
        expression: `(async () => {
          if (document.body && document.body.innerText.length > 50) return document.body.innerText.length;
          const src = [...document.scripts].map((el) => el.src).find(Boolean);
          if (src) await import(src).catch(() => {});
          return document.body ? document.body.innerText.length : 0;
        })()`,
        awaitPromise: true,
        returnByValue: true,
      }, s);
      if ((body.result?.value ?? 0) > 50) {
        sessionId = s;
        return;
      }
    } catch {}
  }
  throw new Error("no live panel");
}

async function connect(): Promise<void> {
  try { ws.close(); } catch {}
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

async function poll<T>(fn: () => Promise<T>, want: (v: T) => boolean, timeoutMs: number, label: string): Promise<T | null> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const v = await fn();
      if (want(v)) return v;
    } catch {}
    await new Promise((r) => setTimeout(r, 300));
  }
  console.log(" timeout waiting " + label);
  return null;
}

async function clickId(elId: string): Promise<void> {
  const raw = await ev(`(() => { const el = document.getElementById(${JSON.stringify(elId)}); if (!el) return null; el.scrollIntoView({block:"center"}); const b = el.getBoundingClientRect(); if (!b.width || !b.height) return null; return JSON.stringify({x: b.x+b.width/2, y: b.y+b.height/2}); })()`);
  if (!raw) throw new Error("missing element " + elId);
  const p = JSON.parse(raw);
  await send("Input.dispatchMouseEvent", { type: "mousePressed", x: p.x, y: p.y, button: "left", clickCount: 1 }, sessionId);
  await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: p.x, y: p.y, button: "left", clickCount: 1 }, sessionId);
}

async function ensurePlate(id: string): Promise<void> {
  const cur = await ev(`window.activeWalletPlate`);
  if (cur === id) return;
  await clickId(id);
  const opened = await poll(async () => ev(`window.activeWalletPlate`), (x) => x === id, 15000, "plate " + id);
  if (!opened) throw new Error("plate " + id + " did not open");
}

async function setInput(elId: string, value: string): Promise<void> {
  await ev(`(() => { const el = document.getElementById(${JSON.stringify(elId)}); el.value = ${JSON.stringify(value)}; el.dispatchEvent(new Event("input", {bubbles:true})); if (typeof el.oninput === "function") el.oninput(); return 1; })()`);
}

async function settings(): Promise<{ node_url: string; start_height: number | null }> {
  const raw = await ev(`(async () => {
    const db = await new Promise((resolve, reject) => { const req = indexedDB.open("files"); req.onerror = () => reject(req.error); req.onsuccess = () => resolve(req.result); });
    const text = await new Promise((resolve, reject) => { const req = db.transaction("files").objectStore("files").get("ScanSettings.json"); req.onerror = () => reject(req.error); req.onsuccess = () => resolve(req.result || ""); });
    if (!text) return "";
    const s = JSON.parse(text);
    return JSON.stringify({ node_url: s.node_url || "", start_height: s.start_height ?? null });
  })()`);
  return raw ? JSON.parse(raw) : { node_url: "", start_height: null };
}

async function scanLive(): Promise<boolean> {
  const raw = await ev(`(async () => {
    const db = await new Promise((resolve, reject) => { const req = indexedDB.open("files"); req.onerror = () => reject(req.error); req.onsuccess = () => resolve(req.result); });
    const text = await new Promise((resolve, reject) => { const req = db.transaction("files").objectStore("files").get("ConnectionStatus-ScanSettings.json"); req.onerror = () => reject(req.error); req.onsuccess = () => resolve(req.result || ""); });
    if (!text) return false;
    const c = JSON.parse(text);
    const status = c.last_packet && c.last_packet.status;
    const daemon = (c.sync && c.sync.daemon_height) || (c.last_packet && c.last_packet.daemon_height) || 0;
    return status === "OK" || status === "blocks_buffer_full" || daemon > 0;
  })()`);
  return !!raw;
}

const results: { name: string; ok: boolean; detail: string }[] = [];
function check(name: string, ok: boolean, detail = ""): void {
  results.push({ name, ok: !!ok, detail });
  console.log((ok ? "PASS " : "FAIL ") + name + (detail ? " | " + detail : ""));
}

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

async function save(node: string, height: string): Promise<void> {
  await ensurePlate("connection");
  const ready = await poll(
    async () => ev(`!!document.getElementById("nodeUrl") && !!document.getElementById("saveNodeUrl")`),
    (x) => x === true,
    10000,
    "save fields",
  );
  if (!ready) throw new Error("save fields missing");
  await setInput("nodeUrl", node);
  await setInput("startHeight", height);
  await ev(`(async () => {
    const el = document.getElementById("saveNodeUrl");
    if (!el || typeof el.onclick !== "function") throw new Error("no save handler");
    const out = el.onclick(new MouseEvent("click"));
    if (out && typeof out.then === "function") await out;
    return 1;
  })()`);
}

async function freshWallet(): Promise<void> {
  let last = "";
  for (let i = 0; i < 2; i++) {
    try {
      const t = await text();
      if (!t.includes("GENERATE SEEDPHRASE")) {
        await resetWallet();
      } else {
        await clickId("generate");
        await clickId("finish-setup");
        const made = await poll(async () => text(), (x) => x.includes("0 XMR"), 60000, "new wallet");
        if (!made) throw new Error("new wallet did not finish");
        await useRegtestNodeBeforeRestart();
        await reloadWalletBackground();
      }
      await reviveSidebar();
      await connect();
      return;
    } catch (e) {
      last = String((e as Error)?.message || e);
      await reviveSidebar().catch(() => {});
      await connect().catch(() => {});
    }
  }
  throw new Error("fresh wallet failed: " + last);
}

async function main(): Promise<void> {
  startNodeAndBrowser();
  await reviveSidebar();
  await connect();
  await freshWallet();

  let before = await settings();

  await attempt("invalid url shows an error and does not write", async () => {
    before = await settings();
    await save("not-a-real-node.invalid", "0");
    const shown = await poll(async () => text(), (t) => t.includes("Node URL is not valid"), 50000, "invalid message");
    if (!shown) throw new Error("invalid message missing: " + (await text()).replaceAll("\n", " | ").slice(0, 300));
  }, async () => {
    const body = await text();
    const file = await settings();
    const ok = body.includes("Node URL is not valid") && file.node_url === before.node_url && file.start_height === before.start_height;
    return ok ? { ok: true, detail: file.node_url } : { ok: false, detail: `file=${file.node_url} start=${file.start_height} text=${body.replaceAll("\n", " | ").slice(0, 220)}` };
  });

  await attempt("failed save shows not saved and does not write", async () => {
    before = await settings();
    await ensurePlate("connection");
    await ev(`window.__realChange = window.wallets.changeNodeUrlAndStartHeight.bind(window.wallets); window.wallets.changeNodeUrlAndStartHeight = async () => { throw new Error("forced"); };`);
    await setInput("nodeUrl", LOCAL);
    await setInput("startHeight", "0");
    await clickId("saveNodeUrl");
    const shown = await poll(async () => text(), (t) => t.includes("Node URL, start height not saved"), 20000, "not saved");
    await ev(`window.wallets.changeNodeUrlAndStartHeight = window.__realChange;`);
    if (!shown) throw new Error("not saved message missing");
  }, async () => {
    const file = await settings();
    const body = await text();
    const ok = body.includes("Node URL, start height not saved") && file.node_url === before.node_url;
    return ok ? { ok: true, detail: "" } : { ok: false, detail: `file=${file.node_url} body has saved=${body.includes("start height saved")}` };
  });

  await attempt("fresh wallet save with no scan yet", async () => {
    await ev(`(async () => { await window.wallets.stopWorker(); return 1; })()`);
    await save(LOCAL, "0");
    const shown = await poll(async () => text(), (t) => t.includes("Node URL, start height saved"), 20000, "fresh saved");
    if (!shown) throw new Error("saved message missing");
  }, async () => {
    const file = await settings();
    const ok = file.node_url === LOCAL && file.start_height === 0 && (await text()).includes("Node URL, start height saved");
    return ok ? { ok: true, detail: "" } : { ok: false, detail: `file=${file.node_url} start=${file.start_height}` };
  });

  await attempt("switch node during a running scan", async () => {
    const live = await poll(scanLive, (x) => x === true, 60000, "scan running");
    if (!live) throw new Error("scan did not start");
    await save(SAME_NODE, "0");
    const shown = await poll(async () => text(), (t) => t.includes("Node URL, start height saved"), 30000, "scan saved");
    if (!shown) throw new Error("saved message missing during scan");
  }, async () => {
    const file = await settings();
    const ok = file.node_url === SAME_NODE && file.start_height === 0;
    return ok ? { ok: true, detail: file.node_url } : { ok: false, detail: `file=${file.node_url} start=${file.start_height}` };
  });

  // put 127.0.0.1 back so later tests stay on the regtest node.
  await attempt("restore local node after the scan switch", async () => {
    await reviveSidebar();
    await connect();
    await save(LOCAL, "0");
    const shown = await poll(async () => text(), (t) => t.includes("Node URL, start height saved"), 30000, "restore saved");
    if (!shown) throw new Error("restore message missing");
  }, async () => {
    const file = await settings();
    const ok = file.node_url === LOCAL && file.start_height === 0;
    return ok ? { ok: true, detail: "" } : { ok: false, detail: `file=${file.node_url} start=${file.start_height}` };
  });

  try { ws.close(); } catch {}
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length} pass, ${failed.length} fail`);
  if (failed.length) process.exit(1);
}

main().catch((e) => {
  console.error("FAIL", e);
  process.exit(1);
});
