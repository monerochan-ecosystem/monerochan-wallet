// Fresh install. Empty profile, no seed.
// Generate a seed, finish setup, save a node url.
// The background must already be listening, or save fails and no heights show.
// Usage: bun test/browser-fresh-install.ts
// Brave must be on :9222 with dist/chrome and this empty profile.
import { spawnSync } from "node:child_process";
import { cdp, ensureSidePanel, targetByUrl } from "./cdp.js";

function startFreshBrowser() {
  const r = spawnSync("bash", ["-lc", `
    set -euo pipefail
    ROOT="${process.cwd()}"
    PROFILE="$ROOT/testdata/fresh-install-profile"
    EXT="$ROOT/dist/chrome"
    pid=$(ps -eo pid,args | awk 'index($0, "/opt/brave") && /remote-debugging-port=9222/ && $0 !~ /type=/ {print $1; exit}')
    if [ -n "$pid" ]; then kill "$pid" || true; fi
    for i in $(seq 1 30); do
      curl -sf -m 1 http://127.0.0.1:9222/json/version >/dev/null || break
      sleep 0.3
    done
    rm -rf "$PROFILE"
    mkdir -p "$PROFILE"
    setsid brave-browser \
      --user-data-dir="$PROFILE" \
      --remote-debugging-port=9222 \
      --remote-allow-origins=http://127.0.0.1:9222 \
      --disable-features=DisableLoadExtensionCommandLineSwitch \
      --enable-unsafe-extension-debugging \
      --load-extension="$EXT" \
      --disable-extensions-except="$EXT" \
      --no-first-run \
      --no-default-browser-check \
      --start-maximized \
      --new-window "http://127.0.0.1:18081/get_height" \
      >"$ROOT/testdata/fresh-install-brave.log" 2>&1 < /dev/null &
    for i in $(seq 1 40); do
      curl -sf -m 1 http://127.0.0.1:9222/json/version >/dev/null && exit 0
      sleep 0.4
    done
    echo "Brave did not answer on port 9222" >&2
    exit 1
  `], { stdio: "inherit" });
  if (r.status !== 0) throw new Error("fresh browser did not start");
}

startFreshBrowser();
spawnSync("bash", ["test/start-regtest.sh"], { stdio: "inherit" });

const extWait = Date.now();
while (Date.now() - extWait < 20000) {
  const list = await (await fetch("http://127.0.0.1:9222/json/list")).json() as { url?: string }[];
  if (list.some((x) => (x.url || "").startsWith("chrome-extension://"))) break;
  await new Promise((r) => setTimeout(r, 300));
}

const { ws, send } = await cdp();
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
ws.close();
