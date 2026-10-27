// direct tool link. the bridge opens the toolconfirm page, the page shows the plate,
// and only the "open sidebar" click delivers the call. never clicks SEND.
// run browser-fresh-install.ts first: that profile must have a wallet.
// usage: bun test/browser-direct-tool.ts
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { cdp, ensureSidePanel, setDebugPort, targetByUrl } from "./cdp.js";

const PORT = Number(process.env.FRESH_BRAVE_PORT) || 9334;
setDebugPort(PORT);
const root = process.cwd();
const started = spawnSync("bash", [
  resolve(root, "test/brave.sh"), "ensure",
  "--profile", resolve(root, "testdata/fresh-install-profile"),
  "--port", String(PORT),
  "--log", resolve(root, "testdata/direct-tool-brave.log"),
], { stdio: "inherit" });
if (started.status !== 0) throw new Error("browser did not start");

const ADDRESS = "47cYSGSjzWPX3KFEN9PaxT5zpWKgRtx568bazbGzt57ffBbUAQevjMk19sfZCrMB1RWHNJLbz1eKU63B77HpHwUVA6JGudr";
const RUN = crypto.randomUUID();
// run unique path: old runs left calls with the same amount and address in the action log.
const TOOL_URL = `https://example.com/${RUN}#monerochan001_amount_0.1_address_${ADDRESS}_no_check`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const results: { name: string; ok: boolean; detail?: string }[] = [];
const created: string[] = [];

const c = await cdp();
const list = async (): Promise<any[]> => await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
async function evaluate(sessionId: string, expression: string) {
  const r = await c.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }, sessionId);
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result?.value;
}
async function check(name: string, fn: () => Promise<void>) {
  try { await fn(); results.push({ name, ok: true }); console.log("PASS " + name); }
  catch (e) { const detail = (e as Error).message; results.push({ name, ok: false, detail }); console.log("FAIL " + name + " | " + detail); }
}

let panel = "";
try {
  await ensureSidePanel(c.send);
  const panelTarget = await targetByUrl("sidebar.html");
  panel = (await c.send("Target.attachToTarget", { targetId: panelTarget.id, flatten: true })).sessionId;
  await c.send("Runtime.enable", {}, panel);
  let ready = false;
  for (let i = 0; i < 80; i++) { ready = await evaluate(panel, `!!window.wallets?.actionLogOpened`); if (ready) break; await sleep(250); }
  assert(ready, "wallet must be set up first: run browser-fresh-install.ts");
  await evaluate(panel, `(async () => { const al = window.wallets.actionLogOpened; for (const x of al.getActiveByPermissions(["spend"])) await al.dismiss(x.invocationId); return 1; })()`);

  // the bridge closes the tool link tab and opens the toolconfirm page in a new tab.
  const before = new Set((await list()).map((x) => x.id));
  const tab = await c.send("Target.createTarget", { url: TOOL_URL });
  created.push(tab.targetId);
  let confirmTab: any = null;
  for (let i = 0; i < 50; i++) { confirmTab = (await list()).find((x) => !before.has(x.id) && x.url.includes("toolconfirm")); if (confirmTab) break; await sleep(100); }
  assert(confirmTab, "the bridge must open the toolconfirm page for a tool url");
  created.push(confirmTab.id);
  const page = (await c.send("Target.attachToTarget", { targetId: confirmTab.id, flatten: true })).sessionId;
  await c.send("Runtime.enable", {}, page);

  await check("page load shows the plate and delivers nothing", async () => {
    let view: any = null;
    for (let i = 0; i < 40; i++) {
      view = JSON.parse(await evaluate(page, `JSON.stringify({ hint: document.querySelector(".toolconfirm-hint")?.textContent ?? "", rows: [...document.querySelectorAll(".tool-row")].map(r => r.innerText).join(" | "), button: !!document.getElementById("openSidebarFromToolconfirm") })`));
      if (view.button) break;
      await sleep(150);
    }
    assert.equal(view.hint, "tool link detected");
    assert(view.rows.includes("context:"), "plate must show the context row");
    assert(view.rows.includes("destination:"), "plate must show the destination row");
    assert.equal(view.button, true, "open sidebar button must be there");
    const live = await evaluate(panel, `window.wallets.actionLogOpened.invocations().filter(x => (x.link || "").includes(${JSON.stringify(RUN)})).length`);
    assert.equal(live, 0, "page load must not deliver the call");
  });

  await check("open sidebar click delivers the call and closes the page", async () => {
    const box = JSON.parse(await evaluate(page, `(() => { const b = document.getElementById("openSidebarFromToolconfirm"); const r = b.getBoundingClientRect(); return JSON.stringify({ x: r.x + r.width / 2, y: r.y + r.height / 2 }); })()`));
    await c.send("Input.dispatchMouseEvent", { type: "mousePressed", x: box.x, y: box.y, button: "left", clickCount: 1 }, page);
    await c.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: box.x, y: box.y, button: "left", clickCount: 1 }, page);
    let call: any[] = [];
    for (let i = 0; i < 60; i++) {
      call = await evaluate(panel, `window.wallets.actionLogOpened.getActiveByPermissions(["spend"]).filter(x => (x.link || "").includes(${JSON.stringify(RUN)})).map(x => ({ amount: x.amount, address: x.address, dest: x.destination_domain }))`);
      if (call.length) break;
      await sleep(150);
    }
    assert.equal(call.length, 1, "exactly one open spend call");
    assert.equal(call[0].amount, "0.1");
    assert.equal(call[0].address, ADDRESS);
    assert.equal(call[0].dest, "example.com");
    // the page closes the tab, or blanks it when it is the last tab of the window.
    let url = "";
    for (let i = 0; i < 40; i++) { url = (await list()).find((x) => x.id === confirmTab.id)?.url ?? "closed"; if (url === "about:blank" || url === "closed") break; await sleep(150); }
    assert(
      url === "about:blank" || url === "closed",
      "the toolconfirm page must close or become about:blank, got " + url,
    );
  });
} finally {
  await evaluate(panel, `(async () => { const al = window.wallets.actionLogOpened; for (const x of al.getActiveByPermissions(["spend"])) await al.dismiss(x.invocationId); return 1; })()`).catch(() => {});
  for (const id of created) await c.send("Target.closeTarget", { targetId: id }).catch(() => {});
  c.ws.close();
  console.log(`${results.filter((r) => r.ok).length}/${results.length} direct link checks passed`);
}
process.exit(results.some((r) => !r.ok) ? 1 : 0);
