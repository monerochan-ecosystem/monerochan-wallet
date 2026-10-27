// the tool link page. the bridge opens it for a tool url. same plate and buttons as the sidebar.
import {
  TOOL_IDS_WITHOUT_DIRECT_OPEN,
  checkToolInvocationValidity,
  parseToolInvocation,
  tools,
  type ParsedMoneroToolInvocation,
  type ToolId,
} from "@spirobel/monero-wallet-api/tools";
import { deliverToolUrl } from "@spirobel/monero-wallet-api/tools/content";
import type { InvocationState } from "@spirobel/monero-wallet-api/unpacked";
import { html, renderRoot } from "../../mininext/mininext";
import { shareToolInfo, toolInfo, validityMessage } from "../sidebar/segments/toolInfo";
import { tactileSwitch } from "../sidebar/ui/buttons";
import { rightLower, tactileContentPlate } from "../sidebar/ui/content";

const url = new URLSearchParams(location.search).get("confirmToolUrl") ?? "";

function parsedToolLink(): ParsedMoneroToolInvocation | null {
  try {
    const parsed = new URL(url);
    const invo = parseToolInvocation(parsed.href, "", {
      href: parsed.href,
      hostname: parsed.hostname,
    } as Location);
    return invo ?? null;
  } catch {
    return null;
  }
}

let toolInvocation = parsedToolLink();

// the plates read a flat invocation. the payload keeps no_check, so lift it up.
function plateState(): InvocationState | null {
  if (!toolInvocation) return null;
  return {
    link: toolInvocation.link,
    linkText: toolInvocation.linkText,
    found_in: toolInvocation.found_in,
    context_domain: toolInvocation.context_domain,
    context_href: toolInvocation.context_href,
    destination_domain: toolInvocation.destination_domain,
    timestamp: toolInvocation.timestamp,
    valid: toolInvocation.valid,
    no_check: (toolInvocation.tool.payload as { no_check?: boolean }).no_check,
    wallet_slot: (toolInvocation.tool.payload as { wallet_slot?: number })
      .wallet_slot,
  } as unknown as InvocationState;
}

// ask the destination server on load, like the wallet does after a click.
// the hint below the plate shows the answer.
if (toolInvocation) {
  checkToolInvocationValidity(toolInvocation)
    .then((result) => {
      if (toolInvocation) toolInvocation.valid = result;
    })
    .catch(() => {});
}

// same plate the sidebar uses for this tool call.
function toolPlate() {
  const state = plateState();
  const id = toolInvocation?.tool.tool_id as ToolId | undefined;
  const permissions = id ? tools[id]?.permissions ?? [] : [];
  return permissions.includes("share_view")
    ? shareToolInfo(state)
    : toolInfo(state);
}

// some tool calls cannot start from a link. they need the page that made them.
function cannotOpenDirectly() {
  const id = toolInvocation?.tool.tool_id as ToolId | undefined;
  return id ? TOOL_IDS_WITHOUT_DIRECT_OPEN.includes(id) : false;
}

// after a successful open: close the tab, or blank it when it is the last tab of
// the window. closing the last tab would close the browser window.
async function leavePage() {
  const tab = await chrome.tabs.getCurrent().catch(() => null);
  if (tab?.id == null || tab.windowId == null) {
    location.replace("about:blank");
    return;
  }
  const tabs = await chrome.tabs.query({ windowId: tab.windowId }).catch(() => []);
  if (tabs.length > 1) {
    await chrome.tabs
      .remove(tab.id)
      .catch(() => location.replace("about:blank"));
    return;
  }
  location.replace("about:blank");
}

// the close button follows the same rule as a successful open: close the tab,
// or blank it when it is the last tab of the window.
function closeCallback() {
  void leavePage();
}

// the click is the user gesture. same helper the content script calls.
function openSidebarCallback() {
  if (cannotOpenDirectly()) return;
  if (!deliverToolUrl(url)) return;
  // the delivery is fire and forget. the page must stay until the validity answer
  // is in, or the messages still in flight are dropped with the page.
  let left = false;
  const leave = () => {
    if (left) return;
    left = true;
    setTimeout(() => void leavePage(), 150);
  };
  if (!toolInvocation) return leave();
  checkToolInvocationValidity(toolInvocation)
    .then((result) => {
      toolInvocation!.valid = result;
    })
    .catch(() => {})
    .finally(leave);
  setTimeout(leave, 4000);
}

const container = document.getElementById("container");
if (!container) throw new Error("Could not find container element");
renderRoot({
  component: () => {
    const openButton = document.getElementById("openSidebarFromToolconfirm");
    if (openButton) openButton.onclick = openSidebarCallback;
    const closeButton = document.getElementById("closeToolconfirm");
    if (closeButton) closeButton.onclick = closeCallback;
    return html`<div class="toolconfirm-page">
      <style>
        .toolconfirm-page {
          height: 100%;
          display: flex;
          flex-direction: column;
          align-items: center;
          padding-top: 30px;
          padding-bottom: 48px;
          box-sizing: border-box;
          color: rgba(255, 255, 255, 0.85);
          font-family: sans-serif;
        }
        .toolconfirm-plate {
          /* 387px plate + 7px margins each side: same plate width as the sidebar. */
          width: 401px;
        }
        .toolconfirm-hint {
          /* same label style as "payment link". it is defined here because the tool info
             is not rendered for a call that cannot be opened directly. */
          display: block;
          width: 401px;
          padding-left: 19px;
          box-sizing: border-box;
          margin-bottom: 18px;
          color: rgba(255, 255, 255, 0.5);
          font-size: 11px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }
        .toolconfirm-plate .tool-info {
          /* the sidebar plate is tighter. here the info box gets room on every side. */
          margin: 10px 20px 28px 20px;
        }
        .toolconfirm-plate .toolconfirm-hint-slot {
          /* reserve the space: the plate keeps its size with and without a hint. */
          min-height: 52px;
          margin: 0px 20px 4px 20px;
          font-size: 12px;
          color: rgba(255, 255, 255, 0.7);
        }
        .toolconfirm-buttons {
          display: flex;
          justify-content: flex-end;
          gap: 18px;
          width: 401px;
          box-sizing: border-box;
          padding-right: 23px;
          margin-top: 18px;
        }
        .toolconfirm-buttons-blocked {
          /* 6px right of the plate edge for the call that cannot open */
          padding-right: 1px;
        }
        .toolconfirm-buttons .tactile-switch {
          width: 135px;
          margin-right: 0px;
        }
        .toolconfirm-blocked {
          padding: 20px 24px 24px 20px;
          text-align: right;
        }
        .toolconfirm-blocked-title {
          color: #e74c3c;
          font-size: 12px;
          font-weight: bold;
        }
        .toolconfirm-blocked-text {
          margin-top: 6px;
          font-size: 12px;
          line-height: 1.4;
          color: rgba(255, 255, 255, 0.7);
        }
      </style>
      <span class="tool-label toolconfirm-hint">tool link detected</span>
      <div class="toolconfirm-plate">
        ${tactileContentPlate(
          html`<div class="toolconfirm-plate-content">
            ${cannotOpenDirectly()
              ? html`<div class="toolconfirm-blocked">
                  <span class="toolconfirm-blocked-title"
                    >this tool link cannot be opened directly</span
                  >
                  <div class="toolconfirm-blocked-text">
                    open it from the page that made it
                  </div>
                </div>`
              : html`<div style="display: contents;">
                  ${toolPlate()}
                  <div class="toolconfirm-hint-slot">
                    ${validityMessage(plateState())}
                  </div>
                </div>`}
          </div>`,
          rightLower,
          undefined,
          "fit-content",
        )}
      </div>
      <div
        class="toolconfirm-buttons${cannotOpenDirectly()
          ? " toolconfirm-buttons-blocked"
          : ""}"
        id="toolconfirm-buttons"
      >
        ${tactileSwitch("closeToolconfirm", "CLOSE")}
        ${cannotOpenDirectly()
          ? ""
          : tactileSwitch("openSidebarFromToolconfirm", "OPEN")}
      </div>
    </div>`;
  },
  container,
});
