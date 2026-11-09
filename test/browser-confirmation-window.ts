import { mkdirSync } from "node:fs";
import { cdp, ensureSidePanel, targetByUrl } from "./cdp";
import { reviveSidebar, startNodeAndBrowser } from "./setup";

// Check confirmation limits against a stored mined payment in the test profile.
// Simulated heights affect only this tab. Wallet files and the node are not changed.
// Usage: bun test/browser-confirmation-window.ts
startNodeAndBrowser();
await ensureSidePanel();
await reviveSidebar();
const { ws, send } = await cdp();
const checks: { name: string; detail: unknown }[] = [];
let logSession: string | undefined;

async function evaluate(sessionId: string, expression: string): Promise<any> {
  const result = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }, sessionId);
  if (result.exceptionDetails)
    throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  return result.result?.value;
}
async function wait<T>(label: string, read: () => Promise<T>, accept: (value: T) => boolean): Promise<T> {
  const start = Date.now();
  let last: T | undefined;
  while (Date.now() - start < 15000) {
    last = await read();
    if (accept(last)) return last;
    await Bun.sleep(100);
  }
  throw new Error(`timeout: ${label}; last=${JSON.stringify(last)}`);
}
function check(name: string, ok: boolean, detail: unknown) {
  if (!ok) throw new Error(`${name}: ${JSON.stringify(detail)}`);
  checks.push({ name, detail });
  console.log("PASS", name, JSON.stringify(detail));
}
async function click(selector: string) {
  await wait("button ready", () => evaluate(logSession!, `typeof document.querySelector(${JSON.stringify(selector)})?.onclick === "function"`), Boolean);
  const box = await evaluate(logSession!, `(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    element.scrollIntoView({block: "center", behavior: "instant"});
    const box = element.getBoundingClientRect();
    return {x: box.x + box.width / 2, y: box.y + box.height / 2};
  })()`);
  for (const type of ["mousePressed", "mouseReleased"])
    await send("Input.dispatchMouseEvent", { type, ...box, button: "left", clickCount: 1 }, logSession);
}

try {
  const panel = await targetByUrl("sidebar.html");
  const panelSession = (await send("Target.attachToTarget", { targetId: panel.id, flatten: true })).sessionId;
  const fixture = await evaluate(panelSession, `(async () => {
    for (const wallet of window.wallets.wallets) {
      const cache = JSON.parse(await Bun.file(wallet.primary_address + "_cache.json").text());
      for (const log of wallet.tx_logs.toReversed()) {
        if (!log.invocationId || log.error || log.sendResult?.status !== "OK") continue;
        const heights = log.inputs_index.map(id => cache.outputs[id]?.spent_block_height).filter(Number.isSafeInteger);
        if (heights.length) return {
          wallet: wallet.primary_address, invocationId: log.invocationId,
          minedHeight: Math.max(...heights), expectedHeight: Math.max(...heights) + 10,
        };
      }
    }
    return null;
  })()`);
  if (!fixture) throw new Error("test profile needs a mined tool 001 payment; run test/browser-actionlog-eta.ts first");
  const url = new URL("actionlog.html", panel.url);
  url.searchParams.set("wallet", fixture.wallet);
  url.hash = "/invo/" + fixture.invocationId;
  const targetId = (await send("Target.createTarget", { url: url.href })).targetId;
  logSession = (await send("Target.attachToTarget", { targetId, flatten: true })).sessionId;
  await send("Target.activateTarget", { targetId });
  const read = (expression: string) => evaluate(logSession!, expression);
  await wait("linked transaction loaded", () => read(`!!document.getElementById("open-txlog")`), Boolean);
  const actualHeight = (await fetch("http://127.0.0.1:18081/get_height").then((response) => response.json())).height;
  const actualText: string = await read("document.querySelector('.log-page').innerText");
  const actualBlocks = [...actualText.matchAll(/\((\d+) blocks? left;/g)].map((match) => Number(match[1]));
  check("actual chain view has no oversized confirmation estimate", actualBlocks.every((blocks) => blocks <= 10), {
    nodeHeight: actualHeight, minedHeight: fixture.minedHeight, displayedBlocks: actualBlocks,
  });

  await read(`(async () => {
    const originalFile = Bun.file;
    const status = JSON.parse(await originalFile("ConnectionStatus-ScanSettings.json").text());
    const state = window.__confirmationWindowTest = {
      polls: 0, height: ${actualHeight},
      restore: () => { Bun.file = originalFile; delete window.__confirmationWindowTest; },
    };
    Bun.file = (path, ...args) => path !== "ConnectionStatus-ScanSettings.json"
      ? originalFile(path, ...args)
      : {text: async () => {
          state.polls++;
          const timestamp = new Date().toISOString();
          return JSON.stringify({
            ...status,
            sync: {...status.sync, daemon_height: state.height, timestamp},
            last_packet: {...status.last_packet, daemon_height: state.height, timestamp},
          });
        }};
  })()`);

  const cases = [
    { name: "old chain data", height: 1, blocks: null },
    { name: "eleven-block gap", height: fixture.expectedHeight - 11, blocks: null },
    { name: "ten-block limit", height: fixture.expectedHeight - 10, blocks: 10 },
    { name: "nine blocks left", height: fixture.expectedHeight - 9, blocks: 9 },
    { name: "confirmation target reached", height: fixture.expectedHeight, blocks: null },
    { name: "confirmation target passed", height: fixture.expectedHeight + 1, blocks: null },
  ];
  for (const item of cases) {
    const nextPoll = await read(`(() => {
      const state = window.__confirmationWindowTest;
      state.height = ${item.height};
      return state.polls + 1;
    })()`);
    await wait("height read", () => read("window.__confirmationWindowTest.polls"), (polls) => polls >= nextPoll);
    await Bun.sleep(200);
    for (const view of ["tool 001", "txlog"]) {
      if (view === "txlog") await click("#open-txlog");
      const title = view === "txlog" ? "txlog" : "payment link";
      await wait("detail page", () => read("document.querySelector('.log-title')?.innerText"), (text) => text === title);
      const expected = item.blocks === null ? null
        : `~${item.blocks * 2} min (${item.blocks} blocks left; height ${item.height} to ${fixture.expectedHeight})`;
      const text: string = await wait(view + " " + item.name, () => read("document.querySelector('.log-page').innerText"),
        (text) => expected ? text.includes(expected) : !text.includes("confirmation ETA:"));
      check(view + " " + item.name, expected ? text.includes(expected) : !text.includes("confirmation ETA:"), expected ?? "no ETA");
    }
    await click("#open-tool-call");
    await wait("tool call page", () => read("document.querySelector('.log-title')?.innerText"), (text) => text === "payment link");
  }
  mkdirSync("testdata", { recursive: true });
  await Bun.write("testdata/browser-confirmation-window-result.json", JSON.stringify({ passed: true, fixture, checks }, null, 2));
  console.log(`PASS confirmation window: ${checks.length} browser checks`);
} finally {
  if (logSession)
    await evaluate(logSession, "window.__confirmationWindowTest?.restore()").catch(() => {});
  ws.close();
}
