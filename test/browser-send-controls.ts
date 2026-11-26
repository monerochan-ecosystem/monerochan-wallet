// ad hoc CDP check. no transaction is created or broadcast.
import { cdp, targetByUrl } from "./cdp";
import { mkdir } from "node:fs/promises";
const directory = "testdata/send-controls";
await mkdir(directory, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const c = await cdp();
try {
  const panel = await targetByUrl("sidebar.html");
  const { sessionId } = await c.send("Target.attachToTarget", { targetId: panel.id, flatten: true });
  await c.send("Target.activateTarget", { targetId: panel.id });
  async function evaluate(expression: string, session = sessionId) {
    const result = await c.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }, session);
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    return result.result?.value;
  }
  async function click(id: string, session = sessionId) {
    const point = await evaluate(`(()=>{const e=document.getElementById(${JSON.stringify(id)});if(!e)throw Error("missing ${id}");const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`, session);
    for (const type of ["mousePressed", "mouseReleased"]) await c.send("Input.dispatchMouseEvent", { type, ...point, button: "left", clickCount: 1 }, session);
    await Bun.sleep(350);
  }
  for (let i = 0; i < 100 && !await evaluate('!!window.wallets && !!document.getElementById("send")'); i++) await Bun.sleep(100);
  if (!await evaluate('!!document.getElementById("openCoinControlButton")')) await click("send");
  const measure = () => evaluate(`(()=>{const read=e=>{const s=getComputedStyle(e),r=e.getBoundingClientRect();return {x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height,color:s.color,background:s.backgroundColor,shadow:s.boxShadow,border:s.border,padding:s.padding,font:s.fontSize,pressed:e.getAttribute("aria-pressed")}};const result=Object.fromEntries(["send-mode-standard","openCoinControlButton","openActionLog"].map(id=>[id,read(document.getElementById(id))]));return {...result,group:read(document.querySelector(".cc-modes")),fieldsBottom:document.querySelector(".send-entry-fields")?.getBoundingClientRect().bottom}})()`);
  await click("send-mode-standard");
  const standard = await measure();
  const a = await c.send("Page.captureScreenshot", { format: "png" }, sessionId);
  await Bun.write(`${directory}/${stamp}-standard.png`, Buffer.from(a.data, "base64"));
  await click("openCoinControlButton");
  const coin = await measure();
  const b = await c.send("Page.captureScreenshot", { format: "png" }, sessionId);
  await Bun.write(`${directory}/${stamp}-coin-control.png`, Buffer.from(b.data, "base64"));
  await Bun.write(`${directory}/${stamp}-geometry.json`, JSON.stringify({ standard, coin }, null, 2));
  for (const id of ["send-mode-standard", "openCoinControlButton"]) {
    for (const key of ["x", "y", "width", "height"]) {
      if (Math.abs(standard[id][key] - coin[id][key]) > 1) throw Error(`${id} moves on mode change: ${key}`);
    }
    for (const key of ["font"]) {
      if (standard[id][key] !== standard.openActionLog[key]) throw Error(`${id} does not match actionlog: ${key}`);
    }
  }
  for (const state of [standard, coin]) {
    if (state.fieldsBottom === undefined || state.group.y < state.fieldsBottom) throw Error("mode group is not below the inputs");
    if (Math.abs(state["send-mode-standard"].right - state.openCoinControlButton.x - 2) > 1) throw Error("mode buttons are not merged");
    for (const key of ["background", "shadow", "padding", "font"]) if (state["send-mode-standard"][key] !== state.openActionLog[key]) throw Error("mode button does not match actionlog: " + key);
  }
  if (standard["send-mode-standard"].color !== "rgb(255, 255, 255)" || coin.openCoinControlButton.color !== "rgb(255, 255, 255)") throw Error("selected mode must use the actionlog hover color");
  const layout = await evaluate(`(()=>{const body=document.querySelector(".send-details")?.getBoundingClientRect(),actions=document.querySelector(".tool-actions")?.getBoundingClientRect();return {bodyBottom:body?.bottom,actionsTop:actions?.top}})()`);
  if (layout.bodyBottom === undefined || layout.bodyBottom > layout.actionsTop) throw Error("recovery content overlaps fixed action buttons");
  await click("send-mode-standard");
  if (process.env.CHECK_TOOL_PLATE === "1") {
    const { targetId } = await c.send("Target.createTarget", { url: "http://127.0.0.1:3006/newsession" });
    try {
      const pageSession = (await c.send("Target.attachToTarget", { targetId, flatten: true })).sessionId;
      let ready = false;
      for (let i = 0; i < 80; i++) {
        if (await evaluate('!!document.querySelector(".pay-button")', pageSession)) { ready = true; break; }
        await Bun.sleep(100);
      }
      if (!ready) throw Error("checkout link missing");
      await c.send("Target.activateTarget", { targetId });
      await evaluate('document.querySelector(".pay-button").id="test-pay"', pageSession);
      await click("test-pay", pageSession);
      await c.send("Target.activateTarget", { targetId: panel.id });
      for (let i = 0; i < 80 && !await evaluate('!!document.querySelector(".tool-info")'); i++) await Bun.sleep(100);
      const withTool = await evaluate(`(()=>{const fields=document.querySelector(".send-entry-fields").getBoundingClientRect(),info=document.querySelector(".tool-info")?.getBoundingClientRect(),actions=document.querySelector(".tool-actions").getBoundingClientRect();return {hasModeSwitch:!!document.querySelector(".cc-modes"),hasOutputLabel:document.querySelector(".send-entry-fields").innerText.includes("output 1"),fields:fields.toJSON(),info:info?.toJSON(),actions:actions.toJSON(),addressDisabled:document.getElementById("addressInput")?.disabled}})()`);
      await Bun.write(`${directory}/${stamp}-tool-info.json`, JSON.stringify(withTool, null, 2));
      const image = await c.send("Page.captureScreenshot", { format: "png" }, sessionId);
      await Bun.write(`${directory}/${stamp}-tool-info.png`, Buffer.from(image.data, "base64"));
      if (!withTool.info || withTool.hasModeSwitch || withTool.hasOutputLabel || withTool.info.y < withTool.fields.bottom || withTool.info.bottom > withTool.actions.y || !withTool.addressDisabled) throw Error("active tool shows a mode switch/output label or overlaps its fields/actions");
      await evaluate('(async()=>{for(const item of window.wallets.actionLogOpened.getActiveByPermissions(["spend"]))await window.wallets.actionLogOpened.dismiss(item.invocationId)})()');
    } finally { await c.send("Target.closeTarget", { targetId }).catch(() => {}); }
  }
  console.log("PASS merged mode group below the inputs, stable positions, and no overlap", stamp);
} finally { c.ws.close(); }
