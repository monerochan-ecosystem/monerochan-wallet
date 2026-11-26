// ad hoc UI check. use real clicks and typing, but never send a transaction.
import { mkdir, rm } from "node:fs/promises";
import { cdp, targetByUrl } from "./cdp";
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const directory = `testdata/coin-control/${stamp}`;
await rm(directory, { recursive: true, force: true });
await mkdir(directory, { recursive: true });
const c = await cdp();
let sessionId = "";
const results: Record<string, unknown> = {};
try {
  const panel = await targetByUrl("sidebar.html");
  sessionId = (await c.send("Target.attachToTarget", { targetId: panel.id, flatten: true })).sessionId;
  await c.send("Target.activateTarget", { targetId: panel.id });
  async function evaluate(expression: string) {
    const result = await c.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }, sessionId);
    if (result.exceptionDetails) throw Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    return result.result?.value;
  }
  async function wait(check: () => Promise<any>, label: string) {
    for (let i = 0; i < 100; i++) { const result = await check(); if (result) return result; await Bun.sleep(100); }
    throw Error("timeout: " + label);
  }
  async function click(id: string) {
    const point = await evaluate(`(()=>{const e=document.getElementById(${JSON.stringify(id)});if(!e)throw Error("missing ${id}");e.scrollIntoView({block:"nearest"});const r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);
    for (const type of ["mousePressed", "mouseReleased"]) await c.send("Input.dispatchMouseEvent", { type, ...point, button: "left", clickCount: 1 }, sessionId);
    await Bun.sleep(150);
  }
  async function type(id: string, value: string) {
    await click(id);
    await c.send("Input.dispatchKeyEvent", { type: "keyDown", key: "a", code: "KeyA", windowsVirtualKeyCode: 65, modifiers: 2 }, sessionId);
    await c.send("Input.dispatchKeyEvent", { type: "keyUp", key: "a", code: "KeyA", windowsVirtualKeyCode: 65 }, sessionId);
    await c.send("Input.insertText", { text: value }, sessionId);
    await Bun.sleep(150);
  }
  async function shot(name: string) {
    await evaluate('document.querySelector(".send-details").scrollTop=0');
    await Bun.sleep(150);
    const image = await c.send("Page.captureScreenshot", { format: "png" }, sessionId);
    await Bun.write(`${directory}/${name}.png`, Buffer.from(image.data, "base64"));
    if (name === "02-input-selected" || name === "04-two-outputs-after-remove") {
      const clip = await evaluate('(()=>{const r=document.querySelector(".send-details").getBoundingClientRect(),last=document.getElementById("cc-sweep")?.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:Math.min(r.height,(last?.bottom??r.bottom)-r.y+10),scale:1}})()');
      const detail = await c.send("Page.captureScreenshot", { format: "png", clip }, sessionId);
      await Bun.write(`${directory}/${name}-detail.png`, Buffer.from(detail.data, "base64"));
    }
  }
  const rows = () => evaluate(`Array.from(document.querySelectorAll(".cc-output-fields")).map(e=>({key:e.getAttribute("data-output-key"),label:e.querySelector(".cc-output-label")?.innerText,amountId:e.querySelector('[id^="cc-amt-"]')?.id,addressId:e.querySelector('[id^="cc-addr-"]')?.id,amount:e.querySelector('[id^="cc-amt-"]')?.value,address:e.querySelector('[id^="cc-addr-"]')?.value}))`);
  const mode = () => evaluate(`(()=>{const group=document.querySelector(".cc-modes"),r=group.getBoundingClientRect(),active=group.querySelector('[aria-pressed="true"]'),frame=getComputedStyle(active);return {x:r.x,y:r.y,width:r.width,height:r.height,selected:active.id,border:frame.borderTopWidth,color:frame.borderTopColor,shadow:frame.boxShadow,style:frame.borderTopStyle,padding:frame.padding,background:frame.backgroundColor}})()`);
  await wait(() => evaluate('!!window.wallets && typeof document.getElementById("send")?.onclick === "function"'), "wallet ready");
  await evaluate('(async()=>{for(const item of window.wallets.actionLogOpened.getActiveByPermissions(["spend"]))await window.wallets.actionLogOpened.dismiss(item.invocationId)})()');
  const logsBefore = await evaluate('window.wallets.wallets.map(w=>w.tx_logs.length)');
  if (!await evaluate('!!document.getElementById("openCoinControlButton")') && await evaluate('window.activeWalletPlate !== "send"')) await click("send");
  await wait(() => evaluate('typeof document.getElementById("send-mode-standard")?.onclick === "function"'), "mode controls ready");
  await click("send-mode-standard");
  if (await evaluate('window.unlocked === true')) await click("safe");
  const standard = await mode();
  if (await evaluate('document.querySelector(".send-entry-fields").innerText.includes("output 1")')) throw Error("standard mode still has an output label");
  await shot("01-standard-selected");
  await click("openCoinControlButton");
  const coin = await mode();
  results.modes = { standard, coin };
  for (const current of [standard, coin]) if (current.border !== "2px" || current.color !== "rgba(255, 255, 255, 0.7)") throw Error("selected mode has no white surrounding");
  for (const key of ["x", "y", "width", "height"]) if (Math.abs(standard[key] - coin[key]) > 1) throw Error("selection changes group geometry: " + key);
  const toolbar = await evaluate(`(()=>{const group=document.querySelector(".cc-modes").getBoundingClientRect();return ["cc-select-input","cc-add-output"].map(id=>{const e=document.getElementById(id),r=e?.getBoundingClientRect();return {id,inToolbar:!!e?.closest(".cc-toolbar"),x:r?.x,y:r?.y,groupRight:group.right,groupY:group.y}})})()`);
  results.toolbar = toolbar;
  if (toolbar.some((button: any) => !button.inToolbar || button.x < button.groupRight || Math.abs(button.y - button.groupY) > 1)) throw Error("input selection and add output are not beside the group");
  if (await evaluate('document.querySelectorAll("#cc-add-output").length') !== 1) throw Error("expected one add-output control");
  let outputs = await rows();
  if (outputs.length !== 1 || outputs[0].label !== "output 1") throw Error("first output label missing");
  const first = outputs[0];
  if (await evaluate(`!!document.getElementById("cc-rm-${first.key}")`)) throw Error("first output still has remove");
  await click("cc-select-input");
  const checkbox = await evaluate('document.querySelector(".cc-check")?.id');
  if (!checkbox) throw Error("test wallet has no spendable inputs");
  await click(checkbox);
  if (!await evaluate(`document.getElementById(${JSON.stringify(checkbox)}).checked`)) throw Error("input checkbox did not select");
  const selectedBorder = await evaluate('(()=>{const s=getComputedStyle(document.getElementById("cc-select-input"));return{border:s.borderTopWidth,color:s.borderTopColor,style:s.borderTopStyle,shadow:s.boxShadow,padding:s.padding,background:s.backgroundColor}})()');
  for (const key of ["border", "color", "style", "shadow", "padding", "background"]) if (coin[key] !== selectedBorder[key]) throw Error("mode styling does not exactly match select input: " + key);
  results.selectedBorder = selectedBorder;
  await shot("02-input-selected");
  await click("cc-select-input");
  if (await evaluate('!!document.querySelector(".cc-check")')) throw Error("input list did not close");
  await click("cc-select-input");
  if (!await evaluate(`document.getElementById(${JSON.stringify(checkbox)}).checked &&
    document.getElementById("cc-select-input").getAttribute("aria-pressed") === "true" &&
    document.querySelector(".send-details").innerText.includes("1 selected")`)) throw Error("input selection was lost");
  await click("cc-select-input");
  await click("cc-add-output");
  await click("cc-add-output");
  outputs = await rows();
  if (outputs.map((row: any) => row.label).join(",") !== "output 1,output 2,output 3") throw Error("output numbering is not sequential");
  const addresses = [
    "47cYSGSjzWPX3KFEN9PaxT5zpWKgRtx568bazbGzt57ffBbUAQevjMk19sfZCrMB1RWHNJLbz1eKU63B77HpHwUVA6JGudr",
    await evaluate('window.wallets.wallets[0].primary_address'),
    "43WLWqC8MCyi5Q3BhA53aFg9aiV29cqNifAniQvjn8BvNAL8GVsWnrMKwBXsThjLfCLSHTLc2aBb81mcdD7TmNqvBZn8dQV",
  ];
  for (const [index, row] of outputs.entries()) {
    await type(row.amountId, `0.${index + 1}`);
    await type(row.addressId, addresses[index]);
  }
  results.beforeRemove = await rows();
  await shot("03-three-outputs");
  await click(`cc-rm-${outputs[1].key}`);
  const after = await rows();
  results.afterRemove = after;
  if (after.length !== 2 || after[0].key !== first.key || after[1].key !== outputs[2].key || after[1].label !== "output 2" || after[0].amount !== "0.1" || after[1].amount !== "0.3" || after[0].address !== addresses[0] || after[1].address !== addresses[2]) throw Error("remove changed another output's values or labels");
  if (await evaluate(`!!document.getElementById("cc-rm-${first.key}")`)) throw Error("first remove returned after renumbering");
  const labelFit = await evaluate(`Array.from(document.querySelectorAll(".cc-output-fields")).every(e=>{const label=e.querySelector(".cc-output-label").getBoundingClientRect(),address=e.querySelector('[id^="cc-addr-"]').getBoundingClientRect();return label.top>=address.bottom&&Math.abs(label.right-address.right)<=1})`);
  if (!labelFit) throw Error("output labels are not at the lower right of their fields");
  const previews = await evaluate('document.querySelector(".send-details").innerText');
  if (!previews.includes("destination address for output 1 (mainnet)") || !previews.includes("destination address for output 2 (mainnet)")) throw Error("destination previews have no output numbers");
  await shot("04-two-outputs-after-remove");
  await c.send("Emulation.setDeviceMetricsOverride", { width: 375, height: 1050, deviceScaleFactor: 1, mobile: false }, sessionId);
  await shot("05-narrow-two-outputs");
  if (!await evaluate('document.documentElement.scrollWidth<=innerWidth')) throw Error("narrow controls overflow horizontally");
  await c.send("Emulation.clearDeviceMetricsOverride", {}, sessionId);
  await click("cc-sweep");
  const sweep = await evaluate('({add:!!document.getElementById("cc-add-output"),amounts:document.querySelectorAll("[id^=cc-amt-]").length,addresses:document.querySelectorAll("[id^=cc-addr-]").length})');
  results.sweep = sweep;
  await shot("06-external-sweep");
  if (sweep.add || sweep.amounts !== 0 || sweep.addresses !== 1) throw Error("sweep leaves a broken add-output button or amount field");
  if (!await evaluate('document.querySelector(".cc-output-label")?.textContent.trim() === "output 1" && !document.querySelector("[id^=cc-rm-]")')) throw Error("sweep must keep one labelled destination");
  await click("cc-select-input");
  if (!await evaluate('!!document.querySelector(".cc-check")')) throw Error("sweep input selection is broken");
  await click("cc-select-input");
  await Bun.sleep(700);
  if (await evaluate('!!document.getElementById("cc-add-output")')) throw Error("sweep restored a stale add-output button");
  await click("cc-sweep");
  const restored = await rows();
  if (restored.length !== 1 || restored[0].address !== addresses[0] || !restored[0].amountId || !await evaluate('!!document.getElementById("cc-add-output")')) throw Error("leaving sweep did not restore normal fields");
  await type(restored[0].amountId, "0.4");
  await click("cc-add-output");
  if ((await rows()).length !== 2) throw Error("add output did not recover after sweep");
  await shot("07-normal-after-sweep");
  await click("send-mode-standard");
  if (await evaluate('document.getElementById("amountInput")?.value') !== "0.4") throw Error("standard mode lost the first output amount");
  if (!await evaluate('document.querySelector(".send-details").innerText.includes("destination address (mainnet)")')) throw Error("standard mode lost the destination preview");
  await type("amountInput", "0.5");
  await evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve(null))))');
  if (await evaluate('document.getElementById("amountInput")?.value') !== "0.5") throw Error("standard amount did not survive rendering");

  await evaluate(`(() => {
    const instantiate = WebAssembly.instantiate;
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    WebAssembly.instantiate = async (...args) => { await gate; return instantiate(...args); };
    window.resumeAddressCheck = () => { WebAssembly.instantiate = instantiate; release(); delete window.resumeAddressCheck; };
  })()`);
  try {
    await type("addressInput", addresses[1]);
    if (await evaluate('!!document.querySelector(".send-details .parsed-address")')) throw Error("standard send still uses the prior address during validation");
    await click("openCoinControlButton");
    if ((await rows())[0].address !== addresses[1]) throw Error("coin control lost the address being validated");
    if (await evaluate('!!document.querySelector(".send-details .parsed-address")')) throw Error("coin control shows an address before validation");
    await shot("08-address-before-validation");
  } finally {
    await evaluate("window.resumeAddressCheck?.()");
  }
  await wait(() => evaluate(`document.querySelector(".send-details .parsed-address")?.textContent === ${JSON.stringify(addresses[1])}`), "coin control validates the address after switching modes");
  await shot("09-address-validated");
  await click("send-mode-standard");
  if (JSON.stringify(await evaluate('window.wallets.wallets.map(w=>w.tx_logs.length)')) !== JSON.stringify(logsBefore)) throw Error("UI check unexpectedly created a transaction");
  await Bun.write(`${directory}/results.json`, JSON.stringify(results, null, 2));
  console.log("PASS coin control, input selection, sweep, and standard draft", directory);
} catch (error) {
  await Bun.write(`${directory}/failure.json`, JSON.stringify({ error: String(error), results }, null, 2));
  throw error;
} finally {
  if (sessionId) await c.send("Emulation.clearDeviceMetricsOverride", {}, sessionId).catch(() => {});
  c.ws.close();
}
