import { cdp, targetByUrl } from "./cdp.js";
import { ensureHealthyWallet } from "./setup.js";
// Browser test for tool 002: full share through accept.
// Clicks Add Wallet on the dashboard, accepts in the wallet, then verifies
// a new wallet route exists in the wallets list. Shares a real view key
// with the local regtest dashboard only.
// Needs Brave on :9222 with the wallet extension.
// The shop is ../monero-payment-links. start-regtest.sh runs bun run production there.
// Usage: bun test/browser-002.ts
await ensureHealthyWallet();
console.log("wallet healthy, opening dashboard");

const { ws, send } = await cdp();

async function panel(expr: string): Promise<any> {
  const t = await targetByUrl("sidebar.html");
  const s = await send("Target.attachToTarget", { targetId: t.id, flatten: true });
  await send("Runtime.enable", {}, s.sessionId);
  const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true }, s.sessionId);
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

const before: string[] = (await panel(`(window.wallets?.wallets ?? []).map(w => w.wallet_route)`)) ?? [];
console.log("routes before:", JSON.stringify(before));
await panel(`(() => { const al = window.wallets.actionLogOpened; for (const x of al.getActiveByPermissions(["share_view"])) al.dismiss(x.invocationId); return 1; })()`);

async function pageHasAddWallet(targetId: string): Promise<boolean> {
  const s = await send("Target.attachToTarget", { targetId, flatten: true });
  await send("Runtime.enable", {}, s.sessionId);
  const r = await send("Runtime.evaluate", { expression: `document.querySelectorAll(".add-wallet-btn").length`, returnByValue: true }, s.sessionId);
  return (r.result?.value ?? 0) > 0;
}

async function findDashboard(): Promise<{ id: string }> {
  const list: any[] = await (await fetch("http://127.0.0.1:9222/json/list")).json();
  const cands = list.filter((x) => (x.url || "").includes("127.0.0.1:3003"));
  for (const c of cands) {
    if (await pageHasAddWallet(c.id)) return c;
  }
  const shop = cands[0];
  const targetId = shop ? shop.id : (await send("Target.createTarget", { url: "http://127.0.0.1:3003/login" })).targetId;
  const s = await send("Target.attachToTarget", { targetId, flatten: true });
  await send("Page.enable", {}, s.sessionId);
  await send("Runtime.enable", {}, s.sessionId);
  await send("Page.navigate", { url: "http://127.0.0.1:3003/dashboard#/wallets" }, s.sessionId);
  const secret = (await Bun.file(new URL("../../monero-payment-links/.env", import.meta.url)).text())
    .split("\n")
    .find((line) => line.startsWith("ADMIN_SECRET="))
    ?.slice("ADMIN_SECRET=".length)
    .trim() ?? "";
  const start = Date.now();
  while (Date.now() - start < 15000) {
    if (await pageHasAddWallet(targetId)) return { id: targetId };
    await send("Runtime.evaluate", {
      expression: `(() => {
        const el = document.querySelector("input[name=password]");
        if (!el || !el.form) return "no";
        el.value = ${JSON.stringify(secret)};
        el.form.submit();
        return "submitted";
      })()`,
      returnByValue: true,
    }, s.sessionId);
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error("no dashboard with wallets open");
}
const dash = await findDashboard();
await send("Target.activateTarget", { targetId: dash.id });
await new Promise((r) => setTimeout(r, 500));
{
  const s = await send("Target.attachToTarget", { targetId: dash.id, flatten: true });
  await send("Runtime.enable", {}, s.sessionId);
  const r = await send("Runtime.evaluate", { expression: `(() => { const els = [...document.querySelectorAll(".add-wallet-btn")].filter(e => e.getBoundingClientRect().width > 0); if (!els.length) return "missing"; const b = els[els.length-1].getBoundingClientRect(); return JSON.stringify({x: b.x+b.width/2, y: b.y+b.height/2}); })()`, returnByValue: true }, s.sessionId);
  if (r.result?.value === "missing") throw new Error("add wallet button missing");
  const { x, y } = JSON.parse(r.result.value);
  await send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 }, s.sessionId);
  await send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 }, s.sessionId);
}

let open = "";
{
  const start = Date.now();
  while (Date.now() - start < 10000) {
    open = String(await panel(`(() => { const al = window.wallets.actionLogOpened; const o = al.getActiveByPermissions(["share_view"]); return o.length + ":slot" + (o[0]?.wallet_slot ?? "?"); })()`) ?? "");
    if (open.startsWith("1:")) break;
    await new Promise((r) => setTimeout(r, 200));
  }
}
console.log("open share calls:", open);
if (!open.startsWith("1:")) throw new Error("no share call opened");

{
  const shown = async () => (await panel(`!!document.getElementById("acceptShareWallet")`)) === true;
  if (!(await shown())) {
    if ((await panel(`window.activeWalletPlate`)) === "wallets") await panelClick("wallets");
    await panelClick("wallets");
    const start = Date.now();
    while (Date.now() - start < 8000 && !(await shown())) await new Promise((r) => setTimeout(r, 200));
  }
  if (!(await shown())) throw new Error("accept button did not open");
}
await panelClick("acceptShareWallet");
let after: string[] = [];
{
  const start = Date.now();
  while (Date.now() - start < 90000) {
    after = (await panel(`(window.wallets?.wallets ?? []).map(w => w.wallet_route)`)) ?? [];
    if (after.length > before.length) break;
    await new Promise((r) => setTimeout(r, 5000));
  }
}
const added = after.filter((r) => !before.includes(r));
console.log("routes after:", JSON.stringify(after));
if (!added.length) throw new Error("no new route, still " + JSON.stringify(after));
console.log("PASS tool 002 shared, new route " + added[0]);
ws.close();
process.exit(0);
