import {
  convertAmountBigInt,
  convertBigIntAmount,
  parseAddress,
  type ParseAddressError,
  type ParsedAddress,
} from "@spirobel/monero-wallet-api";
import { html, type MiniHtmlString } from "../../../mininext/mininext";
import { actionButton, removeActive } from "../ui/buttons";
import { leftUpper, tactileContentPlate } from "../ui/content";
import {
  addressPreviewLine,
  coinControlIsOn,
  coinControlSendReady,
  coinControlView,
  forceStandardMode,
  noteStandardDraft,
  resetCoinControl,
  selectedAmountLine,
  setSpendDismissHandler,
  submitCoinControl,
  takeReleasedDraft,
} from "./coincontrol";
import { lowerButtonIds, sendButtonDotStyles } from "./walletLower";
import {
  connectedToNode,
  currentlySelectedWallet,
} from "./walletRoute";
import type {
  InvocationState,
  TxLog,
} from "@spirobel/monero-wallet-api";
import { getToolUiByPermissions } from "@spirobel/monero-wallet-api";
import { toggleActionLogPage } from "../../actionlog/open";

let parsedAmount: bigint | null = null;
let amountInputValue = "";
let addressInputValue = "";
let justSentTx = false;
let ignoredSpendId: string | null = null;
// opening coin control retires the tool call through this handler
setSpendDismissHandler(async (invocationId) => {
  ignoredSpendId = invocationId;
  await window.wallets?.actionLogOpened?.dismiss(invocationId);
});
export function parseAmountCallback() {
  const amountInput = document.getElementById(
    "amountInput",
  ) as HTMLInputElement | null;
  if (!amountInput) return;
  parsedAmount = convertAmountBigInt(amountInput.value);
  amountInputValue = amountInput.value;
}

export function walletUnlocked(): boolean {
  if (window.unlocked === undefined) return false;
  return window.unlocked;
}
let parsedAddress: ParseAddressError | ParsedAddress | null = null;
function spendOpen(): InvocationState | null {
  return (
    window.wallets?.actionLogOpened?.getActiveByPermissions(["spend"])[0] ?? null
  );
}
function sendButtonActive() {
  if (coinControlIsOn()) return coinControlSendReady(justSentTx);
  const open = spendOpen();
  const parsedAmountBiggerThanAvailable =
    (parsedAmount || 0n) > (currentlySelectedWallet()?.amount || 1n);
  return !!(
    !parsedAmountBiggerThanAvailable &&
    connectedToNode() &&
    walletUnlocked() &&
    parsedAddress &&
    "address" in parsedAddress &&
    parsedAmount &&
    !justSentTx &&
    open?.valid !== "invalid"
  );
}
function markJustSent() {
  justSentTx = true;
  setTimeout(() => {
    justSentTx = false;
  }, 2000);
}
async function sendCallback() {
  // safe side of the top slider. fire is the only side that may send.
  if (!walletUnlocked()) return;
  if (coinControlIsOn()) {
    const open = spendOpen();
    await submitCoinControl(
      markJustSent,
      async (invocationId) => {
        ignoredSpendId = invocationId;
        await window.wallets?.actionLogOpened?.dismiss(invocationId);
      },
      open?.invocationId ?? null,
    );
    return;
  }
  if (
    sendButtonActive() &&
    parsedAddress &&
    "address" in parsedAddress &&
    parsedAmount
  ) {
    const wallet_to_send_from_pa = currentlySelectedWallet()?.primary_address;
    if (!wallet_to_send_from_pa)
      throw new Error("wallet_to_send_from_pa is undefined");

    justSentTx = true;
    setTimeout(() => {
      justSentTx = false;
    }, 2000);

    const open = spendOpen();
    const amountDisplay = convertBigIntAmount(parsedAmount);
    if (open) {
      await window.wallets?.actionLogOpened?.execute(open.invocationId, {
        address: parsedAddress.address,
        amount: amountDisplay,
        wallet_to_send_from_pa,
      });
    } else {
      await window.wallets?.makeSignSend({
        primary_address: wallet_to_send_from_pa,
        payments: [
          {
            address: parsedAddress.address,
            amount: parsedAmount.toString(),
          },
        ],
        input_indexes: [],
      });
    }
    await resetSendInputs();
  }
}
async function resetCallback() {
  await resetSendInputs();
  justSentTx = false;
  const pa = currentlySelectedWallet()?.primary_address;
  if (pa) await window.wallets?.dismissSendPlate({ primary_address: pa });
  readLastTxLog();
}

let last_tx_log: TxLog | null = null;
function readLastTxLog() {
  const logs = currentlySelectedWallet()?.tx_logs ?? [];
  last_tx_log = null;
  for (let i = logs.length - 1; i >= 0; i--) {
    const row = logs[i];
    if (row && !row.hidden_on_send_plate) {
      last_tx_log = row;
      break;
    }
  }
  setTXlogStatusMsg();
}
let lastTxLogMessage = "";
let lastTxLogMessageClass = "";
function setTXlogStatusMsg() {
  lastTxLogMessage = "";
  lastTxLogMessageClass = "";
  if (last_tx_log && last_tx_log.sendResult?.status !== "OK") {
    lastTxLogMessage =
      "failed to send transaction " + formatTime(last_tx_log.timestamp);
    lastTxLogMessageClass = "txlog-error";
  }
  if (last_tx_log && last_tx_log.sendResult?.status === "OK") {
    lastTxLogMessage =
      "successfully sent transaction " + formatTime(last_tx_log.timestamp);
    lastTxLogMessageClass = "txlog-success";
  }
}
async function resetSendInputs() {
  resetCoinControl();
  const open = spendOpen();
  if (open) {
    ignoredSpendId = open.invocationId;
    await window.wallets?.actionLogOpened?.dismiss(open.invocationId);
  }
  const amountInput = document.getElementById(
    "amountInput",
  ) as HTMLInputElement | null;

  if (amountInput) {
    amountInput.value = "";
    amountInputValue = "";
    parsedAmount = null;
    amountInput.disabled = false;
  }
  const addressInput = document.getElementById(
    "addressInput",
  ) as HTMLInputElement | null;

  if (addressInput) {
    addressInput.value = "";
    addressInputValue = "";
    parsedAddress = null;
    addressInput.disabled = false;
  }
}
export async function parseAddressCallback() {
  const addressInput = document.getElementById(
    "addressInput",
  ) as HTMLInputElement | null;
  if (!addressInput) return;
  parsedAddress = await parseAddress(addressInput.value.trim());
  addressInputValue = addressInput.value;
}
export function validityMessage(
  t?: { valid?: string; no_check?: boolean } | null,
) {
  if (!t) return "";

  if (t.valid === "invalid")
    return html`<div class="invalidity-message">
      <style>
        .invalidity-warning {
          color: #e74c3c;
          margin-top: 8px;
          margin-bottom: 8px;
          user-select: none;
        }
      </style>
      <span class="invalidity-warning ">the payment link is invalid</span><br />
      <span class="invalidity-hint">
        the payment destination server responded that it does not recognize this
        address <br />
      </span>
    </div>`;
  if (t.no_check)
    return html`<div class="unverified-message">
      <span
        >this payment link skips destination checks, make sure you
        got it from a trusted source & the address matches.</span
      >
    </div>`;
  return "";
}
export function toolInfo(t?: InvocationState | null) {
  if (!t) return "";
  const destinationLink =
    t.found_in === "linkText" ? (t.linkText ?? t.link ?? "") : (t.link ?? "");
  const contextDomain = t.context_domain ?? "";
  const contextHref = t.context_href ?? "";
  const destinationDomain = t.destination_domain ?? "";
  const validClass = t.valid ?? "";
  const clickedAt =
    typeof t.timestamp === "string"
      ? Date.parse(t.timestamp) || Date.now()
      : (t.timestamp ?? Date.now());
  const openTitle =
    getToolUiByPermissions(["spend"])?.openTitle ?? "";

  return html`<div class="tool-info">
    <style>
      .tool-info {
        display: flex;
        flex-direction: column;
        box-shadow:
          inset 0 4px 12px rgba(0, 0, 0, 0.45),
          0 5px 8px rgba(0, 0, 0, 0.4);
        margin-top: 4px;
        font-size: 14px;
        margin-bottom: 12px;
        cursor: pointer;
        border: 2px solid rgba(255, 255, 255, 0.3);
        border-radius: 4px;
        padding: 8px 7px;
        margin-right: 12px;
        margin-left: 17px;
        margin-top: -5px;
      }
      .context-href {
        width: 236px;
        word-wrap: break-word;
      }
      .destination-link {
        width: 236px;
        word-wrap: break-word;
      }
      .grey-link {
        margin-top: 3px;
        text-decoration: underline;
        font-size: 10px;
        margin-bottom: 12px;
        cursor: pointer;
        color: rgba(255, 255, 255, 0.3);
      }
      .grey-link:hover {
        color: white;
      }
      .valid {
        color: greenyellow !important;
      }
      .invalid {
        color: #e74c3c !important;
      }
      .unverified {
        color: rgba(255, 255, 255, 0.3);
      }
      .tool-context {
        color: rgba(255, 255, 255, 0.7);
      }
      .tool-label {
        color: rgba(255, 255, 255, 0.5);
        font-size: 11px;
        text-transform: uppercase;
        letter-spacing: 0.5px;
      }
      .tool-value {
        color: white;
        font-weight: 600;
      }
      .tool-row {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 4px;
      }
    </style>
    <span class="tool-label">${openTitle}</span>
    <div class="tool-row">
      <span class="tool-context">context:</span>
      <span class="tool-value">${contextDomain}</span>
    </div>
    <a class="context-href grey-link" href=${contextHref} target="_blank">
      ${contextHref}
    </a>
    <div class="tool-row">
      <span class="tool-context">destination:</span>
      <span class="tool-value ${validClass}">${destinationDomain}</span>
    </div>
    <a
      class="destination-link grey-link"
      href=${destinationLink}
      target="_blank"
      rel="noopener noreferrer"
    >
      ${destinationLink}
    </a>
    <div class="tool-row">
      <span class="tool-context">clicked:</span>
      <span class="tool-value">${formatTime(clickedAt)}</span>
    </div>
  </div> `;
}

export function sendPlateContent() {
  const released = takeReleasedDraft();
  if (released) {
    amountInputValue = released.amount;
    addressInputValue = released.address;
    parsedAmount = released.amountAtomic;
    parsedAddress = released.parsed;
  }
  noteStandardDraft({
    amount: amountInputValue,
    address: addressInputValue,
    amountAtomic: parsedAmount,
    parsed: parsedAddress,
  });
  const raw = spendOpen();
  if (raw && raw.invocationId !== ignoredSpendId) ignoredSpendId = null;
  const open =
    raw && raw.invocationId === ignoredSpendId ? null : raw;
  // a spend tool call arrived. switch to standard tx so the tool plate is visible
  if (open && coinControlIsOn()) forceStandardMode();
  const toolAmount = open?.amount
    ? convertAmountBigInt(open.amount)
    : null;

  const toolInfoSnippet = toolInfo(open);
  const validitySnippet = validityMessage(open);
  const amountInput = document.getElementById(
    "amountInput",
  ) as HTMLInputElement | null;

  if (amountInput) {
    amountInput.oninput = parseAmountCallback;
    if (amountInput.value.length === 0 && amountInputValue.length > 0) {
      amountInput.value = amountInputValue;
      parseAmountCallback();
    }
    if (toolAmount != null) {
      amountInputValue = convertBigIntAmount(toolAmount);
      amountInput.value = amountInputValue;
      parseAmountCallback();
      amountInput.disabled = true;
    }
  }
  const addressInput = document.getElementById(
    "addressInput",
  ) as HTMLInputElement | null;

  if (addressInput) {
    addressInput.oninput = parseAddressCallback;
    if (addressInput.value.length === 0 && addressInputValue.length > 0) {
      addressInput.value = addressInputValue;
    }
    if (open?.address) {
      addressInputValue = open.address;
      addressInput.value = addressInputValue;
      parseAddressCallback();
      addressInput.disabled = true;
    }
  }
  const parsedAmountBiggerThanAvailable =
    (parsedAmount || 0n) > (currentlySelectedWallet()?.amount || 1n)
      ? "exceeds unlocked funds"
      : "";
  const sendBtn = document.getElementById("send-action") as HTMLButtonElement;
  if (sendBtn) {
    sendBtn.onclick = sendCallback;
  }
  const resetBtn = document.getElementById("reset-send") as HTMLButtonElement;
  if (resetBtn) {
    resetBtn.onclick = resetCallback;
  }
  const logBtn = document.getElementById("openActionLog");
  if (logBtn) {
    logBtn.onclick = () => toggleActionLogPage();
  }
  const historyBtn = document.getElementById("openHistoryPlate");
  if (historyBtn) {
    historyBtn.onclick = () => {
      removeActive(lowerButtonIds);
      window.activeWalletPlate = lowerButtonIds.history;
      const tab = document.getElementById(lowerButtonIds.history);
      if (tab) tab.classList.add("active-switch");
    };
  }

  const standardAmount = coinControlIsOn()
    ? ""
    : html`<div class="input-block">
        <input
          type="text"
          id="amountInput"
          class="send-input-element"
          placeholder="Enter amount"
        />
        ${selectedAmountLine(parsedAmount, parsedAmountBiggerThanAvailable)}
      </div>`;
  const standardAddress = coinControlIsOn()
    ? ""
    : html`<div style="display: contents;">
        <input
          type="text"
          id="addressInput"
          class="send-input-element"
          placeholder="Enter address"
        />
        ${addressPreviewLine(
          addressInputValue,
          parsedAddress,
          toolInfoSnippet !== "",
        )}
      </div>`;
  return html`<div class="send-plate-container">
    ${standardAmount}
    <div class="input-block">
      <style>
        .send-plate-container {
          height: 100%;
          min-height: 0;
          overflow: hidden;
          display: flex;
          flex-direction: column;
          justify-content: flex-start;
          align-items: stretch;
          position: relative;
        }
        .connection-slot {
          margin-top: auto;
        }
        .input-block {
          display: flex;
          flex-direction: column;
          align-items: stretch;
          justify-content: flex-start;
          gap: 8px;
        }
        .send-input-element {
          color: white;
          background: #333;
          margin-right: 12px;
          margin-top: 12px;
          font-size: 16px;
          padding: 2px;
        }
        .send-input-element:focus {
          outline: none;
          border: 2px solid #007bff;
          box-shadow: 0 0 5px rgba(0, 123, 255, 0.5);
        }
        .send-input-element::selection {
          background: #007bff;
        }
        .parsed-address {
          width: 245px;
          word-wrap: break-word;
          display: inline-block;
          margin-top: 8px;
          color: white;
        }
        .tool-actions {
          position: absolute;
          right: 8px;
          bottom: 46px;
          display: flex;
          gap: 6px;
        }
        .tool-action {
          box-shadow:
            inset 0 4px 12px rgba(0, 0, 0, 0.45),
            0 5px 8px rgba(0, 0, 0, 0.4);
          font-size: 14px;
          cursor: pointer;
          border: 2px solid rgba(255, 255, 255, 0.3);
          border-radius: 4px;
          padding: 2px 4px;
          user-select: none;
          width: fit-content;
        }
        .tool-action:hover {
          color: white;
        }
      </style>

      ${standardAddress}
      ${coinControlIsOn() ? "" : toolInfoSnippet}
      ${coinControlIsOn() ? "" : validitySnippet}
      ${coinControlView()}
      <div class="tool-actions">
        <span class="tool-action" id="openActionLog">actionlog</span>
        <span class="tool-action" id="openHistoryPlate">history</span>
      </div>
    </div>
    ${!connectedToNode()
      ? html`
          <div class="connection-slot">
            <style>
              .connection-warning {
                color: #e74c3c;
                margin-top: 0;
                margin-bottom: 0;
                user-select: none;
              }
            </style>
            <span class="connection-warning">no connection to node</span><br />
            <span class="connection-hint">
              select a different node in connection menu <br />
            </span>
          </div>
        `
      : ""}
  </div>`;
}
export function formatTime(timestamp: number, block_timestamp = false) {
  const date = block_timestamp
    ? new Date(timestamp * 1000)
    : new Date(timestamp);
  return date.toLocaleString(undefined, {
    year: "2-digit",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}
export function sendPlate() {
  readLastTxLog();
  const sendButtonClass = walletUnlocked() ? "red-dot" : "grey-dot";

  return html`<div class="plate">
    <style>
      .plate {
        display: grid;
        grid-template-rows: 1fr 80px;
        height: 100%;
      }
      .actions {
        display: grid;
        grid-template-columns: 140px 1fr 140px;
        grid-template-areas:
          "action action action"
          "result result result";
        margin-left: 8px;
      }
      .send-button-content {
        margin-left: 14px;
      }
      .txlog-success {
        grid-area: result;
        margin-left: 39px;
        color: #00ff00;
      }
      .txlog-error {
        grid-area: result;
        margin-left: 39px;
        color: #ff0000;
      }
    </style>
    ${tactileContentPlate(
      sendPlateContent(),
      leftUpper,
      undefined,
      // floor 425. +80 for action row under the plate on top of the 400 surroundings.
      "max(425px, calc(100vh - 480px))",
    )}
    <div class="actions">
      ${actionButton(
        "send-action",
        html`<span class="send-button-content">
          ${sendButtonDotStyles}<span class="${sendButtonClass}"></span> SEND
        </span>`,
        sendButtonActive(),
      )}
      <div></div>
      ${actionButton("reset-send", "RESET")}
      <div class="${lastTxLogMessageClass}">${lastTxLogMessage}</div>
    </div>
  </div>`;
}
