import {
  get_info,
  readNodeUrlFromScanSettings,
} from "@spirobel/monero-wallet-api";
import { html, type MiniHtmlString } from "../../../mininext/mininext";
import { leftLower, tactileContentPlate } from "../ui/content";
import { integerInput, textInput } from "../ui/input";

import { developerSettings } from "./developerSettings";
import {
  connectedToNode,
  currentScanHeight,
  currentStartingHeight,
  daemonHeight,
  eta,
  setCurrentStartingHeight,
} from "./walletRoute";

async function readNodeUrl() {
  nodeUrlInputValue = (await readNodeUrlFromScanSettings()) || null;
  const nodeUrlInput = document.getElementById(
    "nodeUrl",
  ) as HTMLInputElement | null;
  if (nodeUrlInput) {
    nodeUrlInput.value = nodeUrlInputValue || "";
  }
}
function startheightToString(startHeight: number | null) {
  if (startHeight === null) return "";
  return String(startHeight);
}
function readStartHeight() {
  startHeightInputValue = currentStartingHeight() || null;
  const startHeightInput = document.getElementById(
    "startHeight",
  ) as HTMLInputElement | null;
  if (startHeightInput) {
    startHeightInput.value = startheightToString(startHeightInputValue);
  }
}
const empty_status_message = html`<div></div>`;
function positiveStatusMessage(message: string) {
  return html`<div class="status-message-positive">${message}</div>`;
}
function negativeStatusMessage(message: string) {
  return html`<div class="status-message-negative">${message}</div>`;
}
function neutralStatusMessage(message: string) {
  return html`<div class="status-message-neutral">${message}</div>`;
}
let nodeUrlInputValue: string | null = null;
let startHeightInputValue: number | null | false = false; // null is a valid value so we use false as a placeholder
let test_result = "";
let status_message: MiniHtmlString = empty_status_message;
let openDevSettings = false;
function updateNodeUrlCallback() {
  const nodeUrl = document.getElementById("nodeUrl") as HTMLInputElement | null;
  if (!nodeUrl) return;
  nodeUrlInputValue = nodeUrl.value;
  test_result = "";
  status_message = empty_status_message;
}
function updateStartHeightCallback() {
  const startHeight = document.getElementById(
    "startHeight",
  ) as HTMLInputElement | null;
  if (!startHeight) return;

  const parsed = parseInt(startHeight.value);
  if (isNaN(parsed)) {
  } else {
    startHeightInputValue = parsed;
    startHeight.value = String(parsed);
  }
  if (startHeight.value.length === 0) {
    startHeightInputValue = null;
  }
}
function openDevSettingsHandler() {
  openDevSettings = !openDevSettings;
}
async function resetNodeUrlHandler() {
  await readNodeUrl();
  await readStartHeight();
  status_message = neutralStatusMessage("Node URL, start height reset");
  test_result = "";
}
async function saveNodeUrlHandler() {
  if (!nodeUrlInputValue) return;
  status_message = positiveStatusMessage("Node URL saved");
  test_result = "";

  if (startHeightInputValue !== false) {
    await setCurrentStartingHeight(startHeightInputValue);
    status_message = positiveStatusMessage("Node URL, start height saved");
  }
  void window.wallets?.changeNodeUrl(nodeUrlInputValue);
}

async function sendTestRequestHandler() {
  const nodeUrlInput = document.getElementById(
    "nodeUrl",
  ) as HTMLInputElement | null;
  if (!nodeUrlInput) return;
  try {
    nodeUrlInputValue = nodeUrlInput.value.trim();
    if (nodeUrlInputValue.endsWith("/")) {
      nodeUrlInputValue = nodeUrlInputValue.slice(0, -1);
    }
    nodeUrlInput.value = nodeUrlInputValue;
    const test = await get_info(nodeUrlInputValue);
    status_message = positiveStatusMessage(`get_info response success`);
    test_result = JSON.stringify(test, null, 2);
    const new_height = test.height - 1;
    if (!startHeightInputValue) {
      startHeightInputValue = new_height;
      const startHeightInput = document.getElementById(
        "startHeight",
      ) as HTMLInputElement | null;
      if (startHeightInput) {
        startHeightInput.value = startheightToString(startHeightInputValue);
      }
    }
  } catch (err) {
    status_message = negativeStatusMessage(`get_info response failed`);
    test_result = "";
  }
}
export function connectionPlate() {
  const openDevSettingsButton = document.getElementById(
    "openDevSettingsButton",
  ) as HTMLInputElement | null;
  if (openDevSettingsButton) {
    openDevSettingsButton.onclick = openDevSettingsHandler;
  }
  const sendTestRequest = document.getElementById(
    "sendTestRequest",
  ) as HTMLInputElement | null;
  if (sendTestRequest) {
    sendTestRequest.onclick = sendTestRequestHandler;
  }
  const resetNodeUrl = document.getElementById(
    "resetNodeUrl",
  ) as HTMLInputElement | null;
  if (resetNodeUrl) {
    resetNodeUrl.onclick = resetNodeUrlHandler;
  }
  const saveNodeUrl = document.getElementById(
    "saveNodeUrl",
  ) as HTMLInputElement | null;
  if (saveNodeUrl) {
    saveNodeUrl.onclick = saveNodeUrlHandler;
  }
  const nodeUrlInput = document.getElementById(
    "nodeUrl",
  ) as HTMLInputElement | null;
  if (nodeUrlInput) {
    nodeUrlInput.oninput = updateNodeUrlCallback;
    if (
      nodeUrlInput.value.length === 0 &&
      nodeUrlInputValue &&
      nodeUrlInputValue.length > 0
    ) {
      nodeUrlInput.value = nodeUrlInputValue;
    }
    if (nodeUrlInputValue === null) readNodeUrl();
  }
  const startHeightInput = document.getElementById(
    "startHeight",
  ) as HTMLInputElement | null;
  if (startHeightInput) {
    startHeightInput.oninput = updateStartHeightCallback;
    if (
      startHeightInput.value.length === 0 &&
      startHeightInputValue !== false
    ) {
      startHeightInput.value = startheightToString(startHeightInputValue);
    }
    if (startHeightInputValue === false) readStartHeight();
  }
  return tactileContentPlate(
    html`<div>
      <style>
        .link-closed {
          margin-top: 5px;
          color: #0000ff;
          text-decoration: underline;
          font-family: serif;
          font-size: 16px;
          margin-bottom: 12px;
          cursor: pointer;
        }
        .link-open {
          color: #551a8b;
          text-decoration: underline;
          font-family: serif;
          font-size: 16px;
          margin-bottom: 12px;
          cursor: pointer;
        }
        .no-side-effect-action {
          box-shadow:
            inset 0 4px 12px rgba(0, 0, 0, 0.45),
            0 5px 8px rgba(0, 0, 0, 0.4);
          margin-top: 4px;
          font-size: 14px;
          margin-bottom: 12px;
          cursor: pointer;
          border: 2px solid rgba(255, 255, 255, 0.3);
          border-radius: 4px;
          padding: 2px 4px;
        }
        .no-side-effect-action:hover {
          color: white;
        }
        .side-effect-action {
          box-shadow:
            inset 0 4px 12px rgba(0, 0, 0, 0.45),
            0 5px 8px rgba(0, 0, 0, 0.4);
          margin-left: 12px;
          margin-top: 4px;
          font-size: 14px;
          margin-bottom: 12px;
          cursor: pointer;
          border: 2px solid rgba(255, 255, 255, 0.3);
          border-radius: 4px;
          padding: 2px 4px;
        }
        .side-effect-action:hover {
          color: white;
        }
        .send-test {
          display: flex;
          gap: 5px;
          margin-top: 4px;
          margin-bottom: 4px;
          user-select: none;
        }
        .test-result {
          margin-top: 4px;
          margin-bottom: 12px;
          height: 210px;
          width: 250px;
          background-color: #333;
          overflow-y: auto;
          text-wrap: auto;
        }
        #openDevSettingsButton {
          margin-top: 5px;
          text-decoration: underline;
          font-family: serif;
          font-size: 16px;
          margin-bottom: 12px;
          cursor: pointer;
          ${openDevSettings ? "color: #551a8b;" : ""}
        }
        #openDevSettingsButton:hover {
          ${openDevSettings
          ? "color: rgba(255, 255, 255, 0.3)"
          : "color: white;"}

        }
        .status-message-positive {
          color: #00ff00;
        }
        .status-message-negative {
          color: #ff0000;
        }
      </style>
      ${integerInput("startHeight", "Enter scan start height")}
      <span>start height (set to chain tip if left empty) </span>
      ${textInput("nodeUrl", "Enter node URL")}
      <span>node url</span>
      <div class="send-test">
        <span class="no-side-effect-action" id="sendTestRequest">
          TEST CONNECTION</span
        >
        <span class="no-side-effect-action" id="resetNodeUrl"> RESET</span>
        <span></span>
        <span class="side-effect-action" id="saveNodeUrl"> SAVE</span>
      </div>
      <div style="margin-left: 14px;">
        <div style="height: 14px;">
          <span style="user-select: none;"> ${status_message}</span>
        </div>
        <pre class="test-result">        ${test_result}</pre>
      </div>
      <div style="margin-top: 15px; user-select: none;">
        ${detailedConnectionProgress()}
        <span id="openDevSettingsButton">developer settings </span>
      </div>
      <div id="devSettings">${openDevSettings ? developerSettings() : ""}</div>
    </div>`,
    leftLower,
    "top",
    // floor 468 so tiny sidebars dont collapse. (like on handhelds like gpd win mini) grow with window when taller.
    "max(468px, calc(100vh - 400px))",
  );
}

export function detailedConnectionProgress() {
  if (!connectedToNode()) return html`<div></div>`;
  return html`<div class="connection-progress-description">
    <div>
      <div class="detailed-heights">wallet sync height:</div>
      <div class="detailed-mini-divider" style="width: 77px;"></div>
      <div class="detailed-heights">daemon height:</div>
    </div>
    <div class="detailed-connection-progress">
      <style>
        .connection-progress-description {
          display: grid;
          grid-template-columns: 129px 58px 1fr;
          margin-bottom: 10px;
        }
        .detailed-connection-progress {
          place-items: center;
        }
        .detailed-mini-divider {
          width: 50px;
          height: 4px;
          background: #666;
          border-radius: 12px;
          box-shadow: 0 0 12px rgba(0, 0, 0, 0.6);
        }
        .detailed-heights {
          color: #888;
        }
        .detailed-eta {
          padding: 9px;
          margin-left: 14px;
          color: #aaa;
        }
      </style>
      <div class="detailed-heights">
        ${currentScanHeight()}
      </div>
      <div class="detailed-mini-divider"></div>
      <div class="detailed-heights">
        ${daemonHeight()}
      </div>
    </div>
    <div class="detailed-eta">${eta() ? eta() + " ETA" : ""}</div>
  </div>`;
}
