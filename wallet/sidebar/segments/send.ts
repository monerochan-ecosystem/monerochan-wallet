import {
  convertAmountBigInt,
  convertBigIntAmount,
  parseAddress,
  type ParseAddressError,
  type ParsedAddress,
} from "@spirobel/monero-wallet-api/unpacked";
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
} from "@spirobel/monero-wallet-api/unpacked";
import { getToolUiByPermissions } from "@spirobel/monero-wallet-api/unpacked";
import { openActionLogPage, toggleActionLogPage } from "../../actionlog/open";
import { formatTime, toolInfo, validityMessage } from "./toolInfo";

// the send plate is per wallet route. keep its state per route too.
type SendDraft = {
  amount: string;
  address: string;
  amountAtomic: bigint | null;
  parsed: ParseAddressError | ParsedAddress | null;
};
const drafts = new Map<string, SendDraft>();
const sentUntil = new Map<string, number>();
const dismissedStatus = new Map<string, number>();
const executedHint = new Map<string, string>();
let ignoredSpendId: string | null = null;
let lastSpendId: string | null = null;
function routeKey(): string {
  return currentlySelectedWallet()?.primary_address ?? "";
}
function draft(key = routeKey()): SendDraft {
  let row = drafts.get(key);
  if (!row) drafts.set(key, (row = { amount: "", address: "", amountAtomic: null, parsed: null }));
  return row;
}
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
  draft().amountAtomic = convertAmountBigInt(amountInput.value);
  draft().amount = amountInput.value;
}

export function walletUnlocked(): boolean {
  if (window.unlocked === undefined) return false;
  return window.unlocked;
}
function spendOpen(): InvocationState | null {
  return (
    window.wallets?.actionLogOpened?.getActiveByPermissions(["spend"])[0] ?? null
  );
}
function sendButtonActive() {
  if (coinControlIsOn())
    return coinControlSendReady((sentUntil.get(routeKey()) ?? 0) >= Date.now());
  const open = spendOpen();
  const parsedAddress = draft().parsed;
  const parsedAmount = draft().amountAtomic;
  const parsedAmountBiggerThanAvailable =
    (parsedAmount || 0n) > (currentlySelectedWallet()?.amount || 1n);
  return !!(
    !parsedAmountBiggerThanAvailable &&
    connectedToNode() &&
    walletUnlocked() &&
    parsedAddress &&
    "address" in parsedAddress &&
    parsedAmount &&
    (sentUntil.get(routeKey()) ?? 0) < Date.now() &&
    open?.valid !== "invalid"
  );
}
function markJustSent() {
  sentUntil.set(routeKey(), Date.now() + 2000);
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
  const parsedAddress = draft().parsed;
  const parsedAmount = draft().amountAtomic;
  if (
    sendButtonActive() &&
    parsedAddress &&
    "address" in parsedAddress &&
    parsedAmount
  ) {
    const wallet_to_send_from_pa = currentlySelectedWallet()?.primary_address;
    if (!wallet_to_send_from_pa)
      throw new Error("wallet_to_send_from_pa is undefined");

    sentUntil.set(wallet_to_send_from_pa, Date.now() + 2000);

    const open = spendOpen();
    const address = parsedAddress.address;
    const amount = parsedAmount;
    const amountDisplay = convertBigIntAmount(amount);
    // clear the plate before the wallet waits on the node.
    clearSendForm(open?.invocationId ?? null, wallet_to_send_from_pa);
    if (open) {
      executedHint.set(wallet_to_send_from_pa, open.invocationId);
      await window.wallets?.actionLogOpened?.execute(open.invocationId, {
        address,
        amount: amountDisplay,
        wallet_to_send_from_pa,
      });
    } else {
      await window.wallets?.makeSignSend({
        primary_address: wallet_to_send_from_pa,
        payments: [
          {
            address,
            amount: amount.toString(),
          },
        ],
        input_indexes: [],
      });
    }
  }
}
async function resetCallback() {
  const pa = currentlySelectedWallet()?.primary_address;
  await resetSendInputs(pa);
  if (pa) {
    sentUntil.delete(pa);
    const latest = latestLog(pa);
    if (latest) dismissedStatus.set(pa, latest.timestamp);
    await window.wallets?.dismissSendPlate({ primary_address: pa });
  }
  readLastTxLog();
}

function latestLog(pa: string): TxLog | null {
  const wallet = window.wallets?.wallets?.find(
    (row) => row.primary_address === pa,
  );
  const logs = wallet?.tx_logs ?? [];
  for (let i = logs.length - 1; i >= 0; i--) {
    const row = logs[i];
    if (!row || row.hidden_on_send_plate) continue;
    return row.timestamp === dismissedStatus.get(pa) ? null : row;
  }
  return null;
}
let last_tx_log: TxLog | null = null;
function readLastTxLog() {
  last_tx_log = latestLog(currentlySelectedWallet()?.primary_address ?? "");
  setTXlogStatusMsg();
}
let lastTxLogMessage = "";
let lastTxLogMessageClass = "";
function setTXlogStatusMsg() {
  lastTxLogMessage = "";
  lastTxLogMessageClass = "";
  if (!last_tx_log) return;
  // the first tx log write has no node answer yet. that is not a failure.
  if (!last_tx_log.sendResult && !last_tx_log.error) {
    lastTxLogMessage =
      "sent tx to node " + formatTime(last_tx_log.timestamp);
    lastTxLogMessageClass = "txlog-neutral";
    return;
  }
  if (last_tx_log.sendResult?.status === "OK") {
    lastTxLogMessage =
      "successfully sent transaction " + formatTime(last_tx_log.timestamp);
    lastTxLogMessageClass = "txlog-success";
    return;
  }
  if (last_tx_log.error && last_tx_log.error.includes("not enough funds")) {
    lastTxLogMessage = "not enough funds " + formatTime(last_tx_log.timestamp);
    lastTxLogMessageClass = "txlog-error";
    return;
  }
  lastTxLogMessage =
    "failed to send transaction " + formatTime(last_tx_log.timestamp);
  lastTxLogMessageClass = "txlog-error";
}
function clearSendForm(invocationId?: string | null, key = routeKey()) {
  if (invocationId) ignoredSpendId = invocationId;
  resetCoinControl();
  const row = draft(key);
  row.amount = "";
  row.amountAtomic = null;
  row.address = "";
  row.parsed = null;
  const amountInput = document.getElementById(
    "amountInput",
  ) as HTMLInputElement | null;
  if (amountInput) {
    amountInput.value = "";
    amountInput.disabled = false;
  }
  const addressInput = document.getElementById(
    "addressInput",
  ) as HTMLInputElement | null;
  if (addressInput) {
    addressInput.value = "";
    addressInput.disabled = false;
  }
}
async function resetSendInputs(key = routeKey()) {
  const open = spendOpen();
  if (open) {
    ignoredSpendId = open.invocationId;
    await window.wallets?.actionLogOpened?.dismiss(open.invocationId);
  }
  clearSendForm(undefined, key);
}
export async function parseAddressCallback() {
  const addressInput = document.getElementById(
    "addressInput",
  ) as HTMLInputElement | null;
  if (!addressInput) return;
  draft().parsed = await parseAddress(addressInput.value.trim());
  draft().address = addressInput.value;
}
function executedHintMarkup() {
  const wallet = currentlySelectedWallet()?.primary_address ?? "";
  const executedSpendId = executedHint.get(wallet);
  if (!executedSpendId) return "";
  const dismissExecuted = document.getElementById("dismissExecuted");
  if (dismissExecuted) {
    dismissExecuted.onclick = () => {
      executedHint.delete(wallet);
    };
  }
  const visitExecuted = document.getElementById("visitExecuted");
  if (visitExecuted) {
    const visitId = executedSpendId;
    visitExecuted.onclick = () => {
      void openActionLogPage(visitId);
    };
  }
  return html`<div class="executed-hint">
    tool call executed
    <span class="tool-action" id="visitExecuted">visit</span>
    <span class="tool-action" id="dismissExecuted">dismiss</span>
  </div>`;
}
export function sendPlateContent() {
  const row = draft();
  const released = takeReleasedDraft();
  if (released) {
    row.amount = released.amount;
    row.address = released.address;
    row.amountAtomic = released.amountAtomic;
    row.parsed = released.parsed;
  }
  noteStandardDraft({
    amount: row.amount,
    address: row.address,
    amountAtomic: row.amountAtomic,
    parsed: row.parsed,
  });
  const raw = spendOpen();
  if (raw && raw.invocationId !== ignoredSpendId) ignoredSpendId = null;
  const open =
    raw && raw.invocationId === ignoredSpendId ? null : raw;
  // a spend tool call arrived. switch to standard tx so the tool plate is visible
  if (open && coinControlIsOn()) forceStandardMode();
  const toolAmount = open?.amount
    ? convertAmountBigInt(open.amount) || null
    : null;

  const toolInfoSnippet = toolInfo(open);
  const validitySnippet = validityMessage(open);
  const amountInput = document.getElementById(
    "amountInput",
  ) as HTMLInputElement | null;

  if (amountInput) {
    const newSpend = !!open && open.invocationId !== lastSpendId;
    lastSpendId = open?.invocationId ?? null;
    amountInput.oninput = parseAmountCallback;
    if (amountInput.value.length === 0 && row.amount.length > 0) {
      amountInput.value = row.amount;
      parseAmountCallback();
    }
    if (toolAmount != null) {
      row.amount = convertBigIntAmount(toolAmount);
      amountInput.value = row.amount;
      parseAmountCallback();
      amountInput.disabled = true;
    } else if (open && (amountInput.disabled || newSpend)) {
      amountInput.value = "";
      amountInput.disabled = false;
      parseAmountCallback();
    }
  }
  const addressInput = document.getElementById(
    "addressInput",
  ) as HTMLInputElement | null;

  if (addressInput) {
    addressInput.oninput = parseAddressCallback;
    if (addressInput.value.length === 0 && row.address.length > 0) {
      addressInput.value = row.address;
    }
    if (open?.address) {
      row.address = open.address;
      addressInput.value = row.address;
      parseAddressCallback();
      addressInput.disabled = true;
    }
  }
  const parsedAmountBiggerThanAvailable =
    (row.amountAtomic || 0n) > (currentlySelectedWallet()?.amount || 1n)
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
        ${selectedAmountLine(row.amountAtomic, parsedAmountBiggerThanAvailable)}
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
          row.address,
          row.parsed,
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
          flex-direction: column;
          align-items: flex-end;
          gap: 6px;
        }
        .tool-action-row {
          display: flex;
          gap: 6px;
        }
        .tool-action {
          box-shadow:
            inset 0 4px 12px rgba(0, 0, 0, 0.45),
            0 5px 8px rgba(0, 0, 0, 0.4);
          font-size: 14px;
          font-weight: normal;
          line-height: normal;
          color: rgba(255, 255, 255, 0.75);
          background: transparent;
          cursor: pointer;
          border: 2px solid rgba(255, 255, 255, 0.3);
          border-radius: 4px;
          padding: 2px 4px;
          user-select: none;
          width: fit-content;
          flex: none;
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
        ${executedHintMarkup()}
        <div class="tool-action-row">
          <span class="tool-action" id="openActionLog">actionlog</span>
          <span class="tool-action" id="openHistoryPlate">history</span>
        </div>
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
export function sendPlate() {
  readLastTxLog();
  const sendButtonClass = walletUnlocked() ? "red-dot" : "grey-dot";
  const dismissStatus = document.getElementById("dismissStatus");
  if (dismissStatus && last_tx_log) {
    const stamp = last_tx_log.timestamp;
    dismissStatus.onclick = () => {
      dismissedStatus.set(currentlySelectedWallet()?.primary_address ?? "", stamp);
      const pa = currentlySelectedWallet()?.primary_address;
      if (pa) void window.wallets?.dismissSendPlate({ primary_address: pa });
    };
  }

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
        margin-left: 39px;
        color: #00ff00;
      }
      .txlog-error {
        margin-left: 39px;
        color: #ff0000;
      }
      .txlog-neutral {
        margin-left: 39px;
        color: rgba(255, 255, 255, 0.75);
      }
      .result-lines {
        grid-area: result;
      }
      .executed-hint {
        color: rgba(255, 255, 255, 0.75);
        display: flex;
        align-items: center;
        gap: 6px;
        margin-bottom: 3px;
      }
      .status-line {
        display: flex;
        align-items: center;
        gap: 6px;
      }
      .status-line .tool-action {
        box-shadow:
          inset 0 4px 12px rgba(0, 0, 0, 0.45),
          0 5px 8px rgba(0, 0, 0, 0.4);
        font-size: 14px;
        font-weight: normal;
        line-height: normal;
        color: rgba(255, 255, 255, 0.75);
        background: transparent;
        cursor: pointer;
        border: 2px solid rgba(255, 255, 255, 0.3);
        border-radius: 4px;
        padding: 2px 4px;
        user-select: none;
        width: fit-content;
        flex: none;
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
      <div class="result-lines">
        ${lastTxLogMessage
          ? html`<div class="status-line">
              <div class="${lastTxLogMessageClass}">${lastTxLogMessage}</div>
              <span class="tool-action" id="dismissStatus">dismiss</span>
            </div>`
          : ""}
      </div>
    </div>
  </div>`;
}
