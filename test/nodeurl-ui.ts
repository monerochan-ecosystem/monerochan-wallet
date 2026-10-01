// Run test/start-regtest.sh when port 18081 or port 9222 does not answer.
// Drives the connection plate in the side panel. Never opens sidebar.html as a tab.
// TEST CONNECTION fills https or http when that form answers.
// It does not save, so the worker node stays on the stored url.
// Every check senses UI state plus app state first, acts on what it finds,
// verifies the effect, and retries once from a fresh sense before failing.
// Usage: bun test/nodeurl-ui.ts
import { cdp, ensureSidePanel } from "./cdp";
import { needsReorgReset, reloadWalletBackground, resetWallet, reviveSidebar, startNodeAndBrowser } from "./setup";

const LOCAL = "http://127.0.0.1:18081";
const REMOTE = "https://node.monero.fail";

let ws: WebSocket;
let send: (method: string, params?: Record<string, unknown>, sessionId?: string) => Promise<any>;
let sessionId: string;

async function attachRaw(): Promise<void> {
  const list: any[] = await (await fetch("http://127.0.0.1:9222/json/list")).json();
  const cands = list.filter((x) => (x.url || "").includes("sidebar.html"));
  if (!cands.length) {
    await ensureSidePanel(send);
    const again: any[] = await (await fetch("http://127.0.0.1:9222/json/list")).json();
    const found = again.filter((x) => (x.url || "").includes("sidebar.html"));
    if (!found.length) throw new Error("no sidebar target");
    cands.push(...found);
  }
  const attached = await send("Target.attachToTarget", { targetId: cands[0].id, flatten: true });
  sessionId = attached.sessionId;
  await send("Runtime.enable", {}, sessionId);
}

async function bringUpPanel(): Promise<void> {
  // the panel can be blank with a dead frame loop. sense it, restart the
  // browser for a live renderer, and only then continue.
  for (let i = 0; i < 3; i++) {
    try {
      await reviveSidebar();
    } catch {}
    try {
      await connect();
      return;
    } catch {}
    try {
      await attachRaw();
      const raf = await ev(
        `new Promise((res) => { requestAnimationFrame(() => res("live")); setTimeout(() => res("dead"), 2500); })`,
      );
      if (raf === "dead") {
        await reloadWalletBackground();
        await reconnect();
        continue;
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 2000));
  }
  await connect();
}

async function attach(): Promise<void> {
  // sidebar.html can be the real side panel or a tab. skip a blank body.
  // a reload changes the target id. attach again.
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
        const body = await send("Runtime.evaluate", {
          expression: `(async () => {
            if (document.body && document.body.innerText.length > 50) return document.body.innerText.length;
            const src = [...document.scripts].map((s) => s.src).find(Boolean);
            if (src) await import(src).catch(() => {});
            return document.body ? document.body.innerText.length : 0;
          })()`,
          awaitPromise: true,
          returnByValue: true,
        }, s);
        len = body.result?.value ?? -1;
        if (len > 50) break;
        await new Promise((r) => setTimeout(r, 200));
      }
      if (len > 50) {
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

async function connect(): Promise<void> {
  try { ws.close(); } catch { /* first run or already gone */ }
  const c = await cdp();
  ws = c.ws;
  send = c.send;
  await attach();
}

async function reconnect(): Promise<void> {
  try { ws.close(); } catch { /* already gone */ }
  await connect();
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

async function senseUi(): Promise<{ plate: string | null; balance: number }> {
  const raw = await ev(`(() => {
    const body = document.body ? document.body.innerText : "";
    const m = body.match(/(\\d+(?:\\.\\d+)?) XMR/);
    return JSON.stringify({ plate: window.activeWalletPlate ?? null, balance: m ? parseFloat(m[1]) : 0 });
  })()`);
  if (!raw) return { plate: null, balance: 0 };
  return JSON.parse(raw);
}

async function nodeHeight(): Promise<number> {
  try {
    return (await fetch("http://127.0.0.1:18081/get_height").then((x) => x.json())).height;
  } catch {
    return -1;
  }
}

async function poll<T>(fn: () => Promise<T>, want: (v: T) => boolean, timeoutMs: number, label: string): Promise<T | null> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const v = await fn();
      if (want(v)) return v;
    } catch { /* target hiccup, retry */ }
    await new Promise((r) => setTimeout(r, 300));
  }
  console.log(" timeout waiting " + label);
  return null;
}

const results: { name: string; ok: boolean; detail: string }[] = [];
function check(name: string, ok: boolean, detail = ""): void {
  results.push({ name, ok: !!ok, detail });
  console.log((ok ? "PASS " : "FAIL ") + name + (detail ? " | " + detail : ""));
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

async function rectOf(elId: string): Promise<{ x: number; y: number } | null> {
  const r = await ev(`(() => { const el = document.getElementById(${JSON.stringify(elId)}); if (!el) return null; el.scrollIntoView({block:"center"}); const b = el.getBoundingClientRect(); if (!b.width || !b.height) return null; return JSON.stringify({x: b.x+b.width/2, y: b.y+b.height/2}); })()`);
  if (!r) return null;
  return JSON.parse(r);
}

async function clickId(elId: string): Promise<void> {
  const p = await rectOf(elId);
  if (!p) throw new Error("missing element " + elId);
  await send("Input.dispatchMouseEvent", { type: "mousePressed", x: p.x, y: p.y, button: "left", clickCount: 1 }, sessionId);
  await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: p.x, y: p.y, button: "left", clickCount: 1 }, sessionId);
}

async function ensurePlate(id: string): Promise<void> {
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
  return (await ev(`(() => { const el = document.getElementById(${JSON.stringify(elId)}); return el ? el.value : ""; })()`)) ?? "";
}

async function storedNode(): Promise<string> {
  const raw = await ev(`(async () => {
    const db = await new Promise((resolve, reject) => { const req = indexedDB.open("files"); req.onerror = () => reject(req.error); req.onsuccess = () => resolve(req.result); });
    const text = await new Promise((resolve, reject) => { const req = db.transaction("files").objectStore("files").get("ScanSettings.json"); req.onerror = () => reject(req.error); req.onsuccess = () => resolve(req.result || ""); });
    return text ? JSON.parse(text).node_url || "" : "";
  })()`);
  return raw || "";
}

async function ensureWalletReady(): Promise<void> {
  // onboarding, a reorg, or a blank panel can appear at any time.
  // sense first, recover, then let the caller act. at most a few rounds.
  for (let i = 0; i < 3; i++) {
    const t = await text().catch(() => "");
    if (t.includes("catastrophic reorg")) {
      await resetWallet();
      await reconnect();
      continue;
    }
    if (t.includes("GENERATE SEEDPHRASE")) {
      await clickId("generate").catch(() => {});
      await clickId("finish-setup").catch(() => {});
      const made = await poll(async () => text(), (x) => x.includes("0 XMR"), 60000, "new wallet");
      if (!made) continue;
      await reloadWalletBackground();
      await reconnect();
      continue;
    }
    if (t.length > 50) return;
    await bringUpPanel().catch(() => {});
  }
  const t = await text().catch(() => "");
  if (t.length <= 50) throw new Error("panel stayed blank");
}

async function bundleHasTestFill(): Promise<boolean> {
  const expr = "(async () => {" +
    "const scripts = Array.from(document.scripts).map(function (s) { return s.src; });" +
    "const src = scripts.filter(function (s) { return s && s.indexOf('sidebar-') >= 0; })[0];" +
    "if (!src) return false;" +
    "const text = await fetch(src).then(function (r) { return r.text(); });" +
    "return text.indexOf('findNodeInfo') >= 0;" +
    "})()";
  return !!(await ev(expr));
}

async function statusLines(): Promise<string[]> {
  const body = await text();
  return body.split("\n").map((x) => x.trim()).filter((x) => /get_info|saved|failed|success|node url/i.test(x)).slice(0, 4);
}

async function main(): Promise<void> {
  startNodeAndBrowser();
  await bringUpPanel();

  // use only the local regtest node. read /get_height.
  // do not trust a mine button alone.
  await attempt("node answers", async () => {}, async () => {
    const h = await nodeHeight();
    return h >= 0 ? { ok: true, detail: "height " + h } : { ok: false, detail: "node down" };
  });

  // a blank panel, onboarding, or a reorg all change what the plate shows.
  // sense first, then recover to a wallet before touching the node fields.
  await attempt("panel renders with wallet", async () => {}, async () => {
    const ui = await senseUi();
    const t = await text();
    const live = !!ui.plate || ui.balance > 0 || t.includes("0 XMR") || t.includes("GENERATE SEEDPHRASE") || t.includes("catastrophic reorg");
    return live ? { ok: true, detail: `plate=${ui.plate} bal=${ui.balance}` } : { ok: false, detail: "blank panel" };
  });

  // do not test from a reorg cache. wipe it and make a fresh wallet.
  // a fresh wallet points at the local node, so the stored url is known after this.
  await attempt("no reorg or reset done", async () => {
    if (await needsReorgReset()) {
      await resetWallet();
      await reconnect();
    }
    await ensureWalletReady();
  }, async () => {
    const t = await text();
    const ok = !t.includes("catastrophic reorg") && !t.includes("GENERATE SEEDPHRASE");
    return ok ? { ok: true, detail: "" } : { ok: false, detail: "still onboarding or reorg" };
  });

  // the side panel keeps the loaded bundle until the extension reloads.
  // an old bundle has no scheme fill on TEST CONNECTION.
  await attempt("bundle fills schemes", async () => {
    if (await bundleHasTestFill()) return;
    await ev(`chrome.runtime.reload()`).catch(() => {});
    await new Promise((r) => setTimeout(r, 4000));
    await reviveSidebar();
    await reconnect();
  }, async () => {
    return (await bundleHasTestFill())
      ? { ok: true, detail: "" }
      : { ok: false, detail: "sidebar bundle has no findNodeInfo" };
  });

  const cases: { name: string; typed: string; want: string; success: boolean; timeout: number }[] = [
    { name: "local without scheme", typed: "127.0.0.1:18081", want: LOCAL, success: true, timeout: 25000 },
    { name: "local https falls back", typed: "https://127.0.0.1:18081", want: LOCAL, success: true, timeout: 25000 },
    { name: "local http stays", typed: LOCAL, want: LOCAL, success: true, timeout: 25000 },
    { name: "remote without scheme", typed: "node.monero.fail", want: REMOTE, success: true, timeout: 25000 },
    { name: "remote https stays", typed: REMOTE, want: REMOTE, success: true, timeout: 25000 },
    { name: "remote http becomes https", typed: "http://node.monero.fail", want: REMOTE, success: true, timeout: 25000 },
    { name: "invalid host is not rewritten", typed: "not-a-real-node.invalid", want: "not-a-real-node.invalid", success: false, timeout: 45000 },
  ];

  for (const c of cases) {
    // TEST CONNECTION never saves. sense the stored url first so the
    // verify can tell a fill from a stuck field.
    let storedBefore = "";
    await attempt(c.name, async () => {
      await ensureWalletReady();
      storedBefore = await storedNode();
      await ensurePlate("connection");
      await waitFor("sendTestRequest");
      await setInput("nodeUrl", c.typed);
      const typedIn = await poll(async () => fieldValue("nodeUrl"), (v) => v === c.typed, 8000, c.name + " typed");
      if (!typedIn) throw new Error("input did not take " + c.typed);
      await clickId("sendTestRequest");
      const done = await poll(async () => {
        const node = await fieldValue("nodeUrl");
        const lines = await statusLines();
        const body = lines.join(" ");
        return { node, body };
      }, (s) => {
        if (c.success) return s.node === c.want && s.body.includes("get_info response success");
        return s.node === c.typed && s.body.includes("get_info response failed");
      }, c.timeout, c.name);
      if (!done) throw new Error("no terminal state");
    }, async () => {
      // fresh sense. a stuck field still shows the previous case value.
      const node = await fieldValue("nodeUrl");
      const full = await text();
      const lines = full.split("\n").map((x) => x.trim()).filter((x) => /get_info|saved|failed|success|node url/i.test(x)).slice(0, 4);
      const body = lines.join(" ");
      const stored = await storedNode();
      if (stored !== storedBefore) return { ok: false, detail: `stored moved ${storedBefore} -> ${stored}` };
      if (c.success) {
        const ok = node === c.want && body.includes("get_info response success") && full.includes("height");
        return ok ? { ok: true, detail: `field=${node}` } : { ok: false, detail: `field=${node} status=[${body}]` };
      }
      const ok = node === c.typed && body.includes("get_info response failed");
      return ok ? { ok: true, detail: `field=${node}` } : { ok: false, detail: `field=${node} status=[${body}]` };
    });
  }

  // reset puts the stored values back in the fields. it does not write the file.
  await attempt("test button does not save", async () => {
    await ensureWalletReady();
    await ensurePlate("connection");
    await waitFor("resetNodeUrl");
    await clickId("resetNodeUrl");
    const restored = await poll(async () => fieldValue("nodeUrl"), (v) => v.length > 0, 8000, "reset field");
    if (!restored) throw new Error("reset did not fill the field");
  }, async () => {
    const node = await fieldValue("nodeUrl");
    const stored = await storedNode();
    const ok = node === stored && stored.length > 0;
    return ok ? { ok: true, detail: `stored=${stored}` } : { ok: false, detail: `stored=${stored} field=${node}` };
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
