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
async function click(sessionId: string, selector: string) {
  const box = await evaluate(sessionId, `(() => { const el = document.querySelector(${JSON.stringify(selector)}); el.scrollIntoView({block: "center"}); const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
  await c.send("Input.dispatchMouseEvent", { type: "mousePressed", ...box, button: "left", clickCount: 1 }, sessionId);
  await c.send("Input.dispatchMouseEvent", { type: "mouseReleased", ...box, button: "left", clickCount: 1 }, sessionId);
}
async function check(name: string, fn: () => Promise<void>) {
  try { await fn(); results.push({ name, ok: true }); console.log("PASS " + name); }
  catch (e) { const detail = (e as Error).message; results.push({ name, ok: false, detail }); console.log("FAIL " + name + " | " + detail); }
}

// local page for real content-script clicks. no shop or node is needed.
const fixture = Bun.serve({
  hostname: "127.0.0.1", port: 0,
  fetch: () => new Response('<!doctype html><a id="pay">pay</a>', { headers: { "Content-Type": "text/html" } }),
});
let panel = "";
try {
  // the unpacked reload returns before its extension contexts start.
  for (let i = 0; i < 80; i++) {
    if ((await list()).some((x) => x.url.startsWith("chrome-extension://"))) break;
    await sleep(100);
  }
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
      view = JSON.parse(await evaluate(page, `JSON.stringify({ hint: document.querySelector(".toolconfirm-hint")?.textContent ?? "", rows: [...document.querySelectorAll(".tool-row")].map(r => r.innerText).join(" | "), button: typeof document.getElementById("openSidebarFromToolconfirm")?.onclick === "function" })`));
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

  // the omnibox can turn a pasted monero: uri into a query on a known search engine.
  const LEGACY_URI = `monero:${ADDRESS}?tx_amount=0.2&tx_description=order%2042&recipient_name=shop`;
  const LEGACY_RUN = crypto.randomUUID();
  const PASTED_URL = `https://search.brave.com/search?q=${encodeURIComponent(LEGACY_URI)}&source=desktop&run=${LEGACY_RUN}`;
  const beforeLegacy = new Set((await list()).map((x) => x.id));
  const pasted = await c.send("Target.createTarget", { url: PASTED_URL });
  created.push(pasted.targetId);
  let legacyTab: any = null;
  for (let i = 0; i < 50; i++) { legacyTab = (await list()).find((x) => !beforeLegacy.has(x.id) && x.url.includes("toolconfirm")); if (legacyTab) break; await sleep(100); }
  assert(legacyTab, "the bridge must open the toolconfirm page for a pasted legacy uri");
  created.push(legacyTab.id);
  const legacyPage = (await c.send("Target.attachToTarget", { targetId: legacyTab.id, flatten: true })).sessionId;
  await c.send("Runtime.enable", {}, legacyPage);

  await check("pasted legacy uri shows a blue destination link and the context", async () => {
    let view: any = null;
    for (let i = 0; i < 40; i++) {
      view = JSON.parse(await evaluate(legacyPage, `JSON.stringify({ label: document.querySelector(".tool-info .tool-label")?.textContent ?? "", uri: [...document.querySelectorAll(".tool-info a")].some((a) => a.getAttribute("href") === ${JSON.stringify(LEGACY_URI)}), rows: [...document.querySelectorAll(".tool-row")].map(r => r.innerText).join(" | "), hint: !!document.body?.innerText.includes("skips destination checks"), button: typeof document.getElementById("openSidebarFromToolconfirm")?.onclick === "function" })`));
      if (view.button && view.hint) break;
      await sleep(150);
    }
    assert.equal(view.label, "legacy monero payment uri");
    assert.equal(view.uri, true, "the plate must link the monero: uri for other wallets");
    assert(view.rows.includes("context:"), "plate must show the context row");
    assert(view.rows.includes("destination (legacy):"), "the legacy uri must have the legacy destination label");
    const style = await evaluate(legacyPage, '(() => { const a = document.querySelector(\'.tool-info a[href^="monero:"]\'); const s = getComputedStyle(a); const p = a.closest(".tool-info"); const ps = getComputedStyle(p); return { color: s.color, underline: s.textDecorationLine, size: s.fontSize, fillsWidth: Math.abs(a.getBoundingClientRect().width - (p.clientWidth - parseFloat(ps.paddingLeft) - parseFloat(ps.paddingRight))) < 1 }; })()');
    assert.deepEqual(style, { color: "rgb(0, 123, 255)", underline: "underline", size: "14px", fillsWidth: true });
    assert.equal(view.hint, true, "the unverified hint must show");
    assert.equal(view.button, true, "open sidebar button must be there");
    const live = await evaluate(panel, `window.wallets.actionLogOpened.invocations().filter(x => (x.link || "").includes(${JSON.stringify(LEGACY_RUN)})).length`);
    assert.equal(live, 0, "page load must not deliver the call");
  });

  await check("open click delivers the legacy uri as an unverified call", async () => {
    await click(legacyPage, "#openSidebarFromToolconfirm");
    let call: any[] = [];
    for (let i = 0; i < 60; i++) {
      call = await evaluate(panel, `window.wallets.actionLogOpened.getActiveByPermissions(["spend"]).filter(x => (x.link || "").includes(${JSON.stringify(LEGACY_RUN)})).map(x => ({ amount: x.amount, address: x.address, no_check: x.no_check, valid: x.valid }))`);
      if (call.length) break;
      await sleep(150);
    }
    assert.equal(call.length, 1, "exactly one open spend call");
    assert.equal(call[0].amount, "0.2");
    assert.equal(call[0].address, ADDRESS);
    assert.equal(call[0].no_check, true);
    assert.notEqual(call[0].valid, "valid", "nothing can verify a legacy uri");
  });

  const fixtureUrl = `http://127.0.0.1:${fixture.port}/${RUN}`;
  const fixtureTab = await c.send("Target.createTarget", { url: fixtureUrl });
  created.push(fixtureTab.targetId);
  const content = (await c.send("Target.attachToTarget", { targetId: fixtureTab.targetId, flatten: true })).sessionId;
  await c.send("Runtime.enable", {}, content);
  for (let i = 0; i < 40; i++) { if (await evaluate(content, '!!document.getElementById("pay")')) break; await sleep(100); }
  if (await evaluate(panel, 'window.activeWalletPlate !== "send"')) await click(panel, "#send");

  // accepted trade: any page whose q holds a monero uri is treated as a pasted uri.
  // there is no provider list. the confirm page and the send slider still gate it.
  await check("a page q carrying a monero uri opens the confirmation", async () => {
    const url = `${fixtureUrl}?q=${encodeURIComponent(`monero:${ADDRESS}`)}`;
    const before = new Set((await list()).map((x) => x.id));
    const tab = await c.send("Target.createTarget", { url });
    created.push(tab.targetId);
    let confirm: any = null;
    for (let i = 0; i < 40; i++) { confirm = (await list()).find((x) => !before.has(x.id) && x.url.includes("toolconfirm")); if (confirm) break; await sleep(100); }
    assert(confirm, "the wrapped uri must open the confirmation page");
    created.push(confirm.id);
    const page = (await c.send("Target.attachToTarget", { targetId: confirm.id, flatten: true })).sessionId;
    await c.send("Runtime.enable", {}, page);
    let label = "";
    for (let i = 0; i < 40; i++) { label = await evaluate(page, `document.querySelector(".tool-info .tool-label")?.textContent ?? ""`); if (label) break; await sleep(100); }
    assert.equal(label, "legacy monero payment uri");
  });

  await c.send("Target.activateTarget", { targetId: fixtureTab.targetId });
  for (const [index, amount] of ["0.3", "", "", "0"].entries()) {
    const expectedAmount = amount === "0" ? "" : amount;
    await check(`legacy content-script ${index}: ${amount === "0" ? "zero leaves amount editable" : amount ? "address and amount" : "address only clears draft"}`, async () => {
      const uri = `monero:${ADDRESS}${amount ? `?tx_amount=${amount}&tx_description=monerochan001_merch%20order` : ""}`;
      await evaluate(content, `document.getElementById("pay").href = ${JSON.stringify(uri)}`);
      await click(content, "#pay");
      let view: any;
      for (let i = 0; i < 60; i++) {
        view = await evaluate(panel, `({ address: document.getElementById("addressInput")?.value, amount: document.getElementById("amountInput")?.value, disabled: document.getElementById("amountInput")?.disabled, label: document.querySelector(".tool-info .tool-label")?.textContent, uri: [...document.querySelectorAll(".tool-info a")].some(a => a.getAttribute("href") === ${JSON.stringify(uri)}), context: [...document.querySelectorAll(".tool-info a")].some(a => a.getAttribute("href") === ${JSON.stringify(fixtureUrl)}), destination: document.querySelector(".tool-info")?.innerText.includes("destination (legacy):"), hint: !!document.querySelector(".unverified-message") })`);
        if (view.uri && view.amount === expectedAmount && view.disabled === !!expectedAmount) break;
        await sleep(100);
      }
      assert.equal(view.address, ADDRESS);
      assert.equal(view.amount, expectedAmount);
      assert.equal(view.disabled, !!expectedAmount, "address-only and zero-amount calls must leave the amount editable");
      assert.equal(view.label, "legacy monero payment uri");
      assert.equal(view.uri, true, "the original uri must stay clickable");
      assert.equal(view.context, true, "the clicked page must stay clickable");
      assert.equal(view.destination, true);
      const style = await evaluate(panel, '(() => { const a = document.querySelector(\'.tool-info a[href^="monero:"]\'); const s = getComputedStyle(a); const p = a.closest(".tool-info"); const ps = getComputedStyle(p); return { color: s.color, underline: s.textDecorationLine, size: s.fontSize, fillsWidth: Math.abs(a.getBoundingClientRect().width - (p.clientWidth - parseFloat(ps.paddingLeft) - parseFloat(ps.paddingRight))) < 1 }; })()');
      assert.deepEqual(style, { color: "rgb(0, 123, 255)", underline: "underline", size: "14px", fillsWidth: true });
      const layout = await evaluate(panel, '(() => { const a = document.querySelector(\'.tool-info a[href^="monero:"]\').getBoundingClientRect(); return { viewport: document.documentElement.clientWidth, page: document.documentElement.scrollWidth, right: a.right, height: a.height }; })()');
      assert(layout.page <= layout.viewport, `the uri must not stretch the sidebar: ${JSON.stringify(layout)}`);
      assert(layout.right <= layout.viewport, "the uri must stay inside the sidebar");
      assert(layout.height >= 28, "the uri must wrap onto multiple lines");
      assert.equal(view.hint, true);
      assert.equal(await evaluate(content, "location.href"), fixtureUrl, "the click must not navigate the page");
      if (!expectedAmount) {
        let ready = false;
        for (let i = 0; i < 40; i++) {
          ready = await evaluate(panel, 'typeof document.getElementById("amountInput")?.oninput === "function"');
          if (ready) break;
          await sleep(25);
        }
        assert(ready, "the editable amount input must be ready");
        await click(panel, "#amountInput");
        assert(await evaluate(panel, 'document.activeElement === document.getElementById("amountInput")'), "the amount input must have focus after a real click");
        for (const key of "0.4") {
          const code = key === "." ? "Period" : `Digit${key}`;
          const windowsVirtualKeyCode = key === "." ? 190 : key.charCodeAt(0);
          await c.send("Input.dispatchKeyEvent", { type: "keyDown", key, code, windowsVirtualKeyCode, text: key }, panel);
          await c.send("Input.dispatchKeyEvent", { type: "keyUp", key, code, windowsVirtualKeyCode }, panel);
        }
        await sleep(100);
        assert.equal(await evaluate(panel, 'document.getElementById("amountInput").value'), "0.4", "the user amount must survive a render");
      }
    });
  }
} finally {
  fixture.stop();
  await evaluate(panel, `(async () => { const al = window.wallets.actionLogOpened; for (const x of al.getActiveByPermissions(["spend"])) await al.dismiss(x.invocationId); return 1; })()`).catch(() => {});
  for (const id of created) await c.send("Target.closeTarget", { targetId: id }).catch(() => {});
  c.ws.close();
  console.log(`${results.filter((r) => r.ok).length}/${results.length} direct link checks passed`);
}
process.exit(results.some((r) => !r.ok) ? 1 : 0);
