import {
  convertBigIntAmount,
  convertAmountBigInt,
  parseAddress,
  type ParseAddressError,
  type ParsedAddress,
} from "@spirobel/monero-wallet-api";
import { flatten, html, type MiniHtmlString } from "../../../mininext/mininext";
import {
  connectedToNode,
  currentlySelectedWallet,
} from "./walletRoute";

type CoinOutputRow = {
  key: string;
  address: string;
  amount: string;
  amountAtomic: bigint | null;
  parsed: ParseAddressError | ParsedAddress | null;
};

export type StandardDraft = {
  amount: string;
  address: string;
  amountAtomic: bigint | null;
  parsed: ParseAddressError | ParsedAddress | null;
};

let coinControlMode = false;
let sweepMode = false;
let selectInputOpen = false;
let sweepFee: bigint | null = null;
let coinOutputSeq = 1;
let coinOutputRows: CoinOutputRow[] = [];
const checkedInputIds = new Set<string>();
let notedDraft: StandardDraft = {
  amount: "",
  address: "",
  amountAtomic: null,
  parsed: null,
};
let releasedDraft: StandardDraft | null = null;

function freshOutputRow(): CoinOutputRow {
  coinOutputSeq += 1;
  return {
    key: String(coinOutputSeq),
    address: "",
    amount: "",
    amountAtomic: null,
    parsed: null,
  };
}

export function coinControlIsOn() {
  return coinControlMode;
}

export function noteStandardDraft(draft: StandardDraft) {
  notedDraft = draft;
}

export function takeReleasedDraft(): StandardDraft | null {
  const draft = releasedDraft;
  releasedDraft = null;
  return draft;
}

export function resetCoinControl() {
  checkedInputIds.clear();
  sweepMode = false;
  sweepFee = null;
  selectInputOpen = false;
  coinOutputRows = [];
}

let onSpendDismiss: ((invocationId: string) => Promise<void>) | null = null;
/** send.ts registers this so opening coin control can retire the tool call. */
export function setSpendDismissHandler(
  fn: (invocationId: string) => Promise<void>,
) {
  onSpendDismiss = fn;
}

// a spend tool call arrived. the tool plate lives on standard tx, so coin control steps aside
export function forceStandardMode() {
  coinControlMode = false;
  resetCoinControl();
}

function toggleCoinControlMode() {
  coinControlMode = !coinControlMode;
  if (coinControlMode) {
    // coin control replaces the tool plate. an open spend call is retired with it
    const open =
      window.wallets?.actionLogOpened?.getActiveByPermissions(["spend"])[0];
    if (open && onSpendDismiss) void onSpendDismiss(open.invocationId);
    if (coinOutputRows.length === 0) {
      const row = freshOutputRow();
      row.amount = notedDraft.amount;
      row.address = notedDraft.address;
      row.amountAtomic = notedDraft.amountAtomic;
      row.parsed = notedDraft.parsed;
      coinOutputRows = [row];
    }
    return;
  }
  const first = coinOutputRows[0];
  if (first) {
    releasedDraft = {
      amount: first.amount,
      address: first.address,
      amountAtomic: first.amountAtomic,
      parsed: first.parsed,
    };
  }
  resetCoinControl();
}

function sweepBaseSum() {
  if (checkedInputIds.size > 0) return selectedInputSum();
  return (currentlySelectedWallet()?.spendableInputs() ?? []).reduce(
    (sum, input) => sum + input.amount,
    0n,
  );
}

async function toggleSweep() {
  sweepMode = !sweepMode;
  if (!sweepMode) {
    sweepFee = null;
    return;
  }
  const kept = coinOutputRows[0] ?? freshOutputRow();
  kept.amount = "";
  kept.amountAtomic = null;
  coinOutputRows = [kept];
  const wallet = currentlySelectedWallet();
  if (!wallet) return;
  try {
    const estimate = await wallet.getFeeEstimate();
    sweepFee = BigInt(estimate.fees?.[0] ?? 0) * 10000n;
  } catch {
    sweepFee = null;
  }
}

function toggleSelectInput() {
  selectInputOpen = !selectInputOpen;
}

function selectedInputSum() {
  const inputs = currentlySelectedWallet()?.spendableInputs() ?? [];
  let sum = 0n;
  for (const input of inputs) {
    if (checkedInputIds.has(String(input.index_on_blockchain)))
      sum += input.amount;
  }
  return sum;
}

function extraOutputSum() {
  return coinOutputRows.reduce(
    (sum, row) => sum + (row.amountAtomic ?? 0n),
    0n,
  );
}

function rowAddressOk(row: CoinOutputRow) {
  return !!row.parsed && "address" in row.parsed;
}

function coinOutputsValid() {
  const first = coinOutputRows[0];
  if (!first) return false;
  if (sweepMode) return coinOutputRows.length === 1 && rowAddressOk(first);
  return coinOutputRows.every(
    (row) => rowAddressOk(row) && (row.amountAtomic ?? 0n) > 0n,
  );
}

export function coinControlSendReady(sendLocked: boolean) {
  if (!connectedToNode() || !window.unlocked || sendLocked) return false;
  if (!coinOutputsValid()) return false;
  if (sweepMode) {
    const all = currentlySelectedWallet()?.spendableInputs() ?? [];
    if (checkedInputIds.size === 0) return all.length > 0;
    return selectedInputSum() > 0n;
  }
  if (checkedInputIds.size === 0) return false;
  const outSum = extraOutputSum();
  return outSum > 0n && selectedInputSum() >= outSum;
}

function pruneCheckedInputs() {
  const live = new Set(
    (currentlySelectedWallet()?.spendableInputs() ?? []).map((input) =>
      String(input.index_on_blockchain),
    ),
  );
  for (const id of [...checkedInputIds]) {
    if (!live.has(id)) checkedInputIds.delete(id);
  }
}

export async function submitCoinControl(
  markSent: () => void,
  dismissSpend: (invocationId: string) => Promise<void>,
  openSpendId: string | null,
) {
  if (!coinControlSendReady(false)) return;
  const wallet_to_send_from_pa = currentlySelectedWallet()?.primary_address;
  if (!wallet_to_send_from_pa) return;
  markSent();
  if (openSpendId) await dismissSpend(openSpendId);
  pruneCheckedInputs();
  const input_indexes = [...checkedInputIds];
  if (sweepMode) {
    await window.wallets?.sweepSignSend({
      primary_address: wallet_to_send_from_pa,
      address: (coinOutputRows[0]?.address ?? "").trim(),
      input_indexes,
    });
    return;
  }
  const payments = coinOutputRows.map((row) => ({
    address: row.address.trim(),
    amount: (row.amountAtomic ?? 0n).toString(),
  }));
  await window.wallets?.makeSignSend({
    primary_address: wallet_to_send_from_pa,
    payments,
    input_indexes,
  });
}

function formatStamp(timestamp: number) {
  return new Date(timestamp).toLocaleString(undefined, {
    year: "2-digit",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function previewLine(label: string, value: string) {
  return html`<div>
    <span style="user-select: none;">${label}</span>
    <span style="color:white">${value}</span>
  </div>`;
}

export function selectedAmountLine(atomic: bigint | null, warning: string) {
  const text = atomic && atomic > 0n ? convertBigIntAmount(atomic) : "0.00";
  return html`<div>
    ${previewLine("selected amount:", text)}
    <span style="user-select: none; color: #e74c3c;">${warning}</span>
  </div>`;
}

export function addressPreviewLine(
  raw: string,
  parsed: ParseAddressError | ParsedAddress | null,
  hidden: boolean,
) {
  if (hidden) return html`<div style="display: none;"></div>`;
  if (!raw.length) return html`<div></div>`;
  if (!parsed || !("address" in parsed))
    return html`<div style="user-select: none;">invalid address</div>`;
  return html`<div>
    <div style="user-select: none;">
      destination address (${parsed.network}):
    </div>
    <div class="parsed-address">${parsed.address}</div>
  </div>`;
}

function ccStyle() {
  return html`<style>
    .cc-link {
      text-decoration: underline;
      font-family: serif;
      font-size: 16px;
      cursor: pointer;
      user-select: none;
      display: inline-block;
      margin-top: 8px;
      margin-right: 12px;
    }
    .cc-link-on {
      color: #551a8b;
    }
    .cc-btn {
      box-shadow:
        inset 0 4px 12px rgba(0, 0, 0, 0.45),
        0 5px 8px rgba(0, 0, 0, 0.4);
      display: inline-block;
      font-size: 14px;
      cursor: pointer;
      border: 2px solid rgba(255, 255, 255, 0.3);
      border-radius: 4px;
      padding: 2px 4px;
      user-select: none;
      width: fit-content;
      margin-top: 8px;
      margin-right: 8px;
    }
    .cc-btn:hover {
      color: white;
    }
    .cc-btn-on {
      color: white;
      border-color: rgba(255, 255, 255, 0.7);
    }
    .cc-link:hover {
      color: white;
    }
    .cc-link-on:hover {
      color: rgba(255, 255, 255, 0.3);
    }
    .cc-list {
      overflow: auto;
      max-height: 140px;
      margin-top: 8px;
      margin-right: 12px;
    }
    .cc-line {
      display: grid;
      grid-template-columns: 22px 110px 1fr;
      gap: 8px;
      align-items: center;
      font-size: 14px;
      font-weight: 700;
      margin-top: 6px;
    }
    .cc-check {
      appearance: none;
      width: 18px;
      height: 18px;
      margin: 0;
      background: #333;
      border: 2px solid rgba(255, 255, 255, 0.35);
      box-sizing: border-box;
    }
    .cc-check:checked {
      background: #333;
      box-shadow: inset 0 0 0 4px #007bff;
    }
    .cc-amt {
      color: white;
    }
    .cc-extra {
      display: flex;
      flex-direction: column;
      align-items: stretch;
    }
  </style>`;
}

function bindCoinControl() {
  pruneCheckedInputs();
  const inputs = currentlySelectedWallet()?.spendableInputs() ?? [];
  for (const input of inputs) {
    const id = String(input.index_on_blockchain);
    const box = document.getElementById(`cc-in-${id}`) as HTMLInputElement | null;
    if (!box) continue;
    box.checked = checkedInputIds.has(id);
    box.onchange = () => {
      if (box.checked) checkedInputIds.add(id);
      else checkedInputIds.delete(id);
    };
  }
  for (const row of coinOutputRows) {
    const addressEl = document.getElementById(
      `cc-addr-${row.key}`,
    ) as HTMLInputElement | null;
    const amountEl = document.getElementById(
      `cc-amt-${row.key}`,
    ) as HTMLInputElement | null;
    if (addressEl) {
      if (addressEl.value.length === 0 && row.address.length > 0)
        addressEl.value = row.address;
      addressEl.oninput = async () => {
        row.address = addressEl.value;
        row.parsed = await parseAddress(addressEl.value.trim());
      };
    }
    if (amountEl) {
      if (amountEl.value.length === 0 && row.amount.length > 0)
        amountEl.value = row.amount;
      amountEl.oninput = () => {
        row.amount = amountEl.value;
        const atomic = convertAmountBigInt(amountEl.value);
        row.amountAtomic = atomic > 0n ? atomic : null;
      };
    }
    const removeEl = document.getElementById(`cc-rm-${row.key}`);
    if (removeEl)
      removeEl.onclick = () => {
        coinOutputRows = coinOutputRows.filter((item) => item.key !== row.key);
      };
  }
  const addEl = document.getElementById("cc-add-output");
  if (addEl)
    addEl.onclick = () => {
      coinOutputRows = [...coinOutputRows, freshOutputRow()];
    };
  const modeEl = document.getElementById("openCoinControlButton");
  if (modeEl) modeEl.onclick = toggleCoinControlMode;
  const sweepEl = document.getElementById("cc-sweep");
  if (sweepEl) sweepEl.onclick = toggleSweep;
  const selectEl = document.getElementById("cc-select-input");
  if (selectEl) selectEl.onclick = toggleSelectInput;
  const failed = currentlySelectedWallet()?.failed_txs ?? [];
  for (const row of failed) {
    const btn = document.getElementById(`cc-re-${row.index}`);
    if (!btn) continue;
    btn.onclick = () => {
      const pa = currentlySelectedWallet()?.primary_address;
      if (!pa || !row.txlog.signed_tx) return;
      void window.wallets?.rebroadcastTx({
        primary_address: pa,
        tx_log_index: row.index,
      });
    };
  }
}

export function coinControlView(): MiniHtmlString {
  bindCoinControl();
  const inputs = currentlySelectedWallet()?.spendableInputs() ?? [];
  const inputRows = inputs.map((input) => {
    const id = String(input.index_on_blockchain);
    return html`<label class="cc-line">
      <input class="cc-check" type="checkbox" id="cc-in-${id}" />
      <span class="cc-amt">${convertBigIntAmount(input.amount)}</span>
      <span>${id}</span>
    </label>`;
  });
  const outSum = extraOutputSum();
  const inSum = selectedInputSum();
  const short =
    !sweepMode && checkedInputIds.size > 0 && inSum < outSum
      ? "exceeds selected inputs"
      : "";
  const visibleRows = sweepMode ? coinOutputRows.slice(0, 1) : coinOutputRows;
  const outputBlocks = visibleRows.map((row) => {
    if (sweepMode) {
      const feeText = sweepFee == null ? "..." : convertBigIntAmount(sweepFee);
      return html`<div class="cc-extra">
        <input
          type="text"
          id="cc-addr-${row.key}"
          class="send-input-element"
          placeholder="Enter address"
        />
        ${addressPreviewLine(row.address, row.parsed, false)}
        ${previewLine("selected inputs:", convertBigIntAmount(sweepBaseSum()))}
        ${previewLine("fee estimate:", feeText)}
      </div>`;
    }
    return html`<div class="cc-extra">
      <input
        type="text"
        id="cc-amt-${row.key}"
        class="send-input-element"
        placeholder="Enter amount"
      />
      ${selectedAmountLine(row.amountAtomic, "")}
      <input
        type="text"
        id="cc-addr-${row.key}"
        class="send-input-element"
        placeholder="Enter address"
      />
      ${addressPreviewLine(row.address, row.parsed, false)}
      <span class="cc-btn" id="cc-rm-${row.key}">remove</span>
    </div>`;
  });
  const failed = currentlySelectedWallet()?.failed_txs ?? [];
  const failedBlocks = failed.map((row) => {
    const inputLines = row.inputs.map(
      (input) =>
        html`<div>
          idx ${input.index_on_blockchain}
          ${convertBigIntAmount(input.amount)}
        </div>`,
    );
    return html`<div>
      <div>${formatStamp(row.txlog.timestamp)}</div>
      <div>${row.txlog.error || row.txlog.sendResult?.reason || "failed"}</div>
      ${flatten(inputLines)}
      ${row.txlog.signed_tx
        ? html`<span class="cc-btn" id="cc-re-${row.index}">rebroadcast</span>`
        : ""}
    </div>`;
  });
  const list = selectInputOpen
    ? html`<div class="cc-list">
        ${inputs.length
          ? flatten(inputRows)
          : html`<div>no spendable inputs</div>`}
        <div>
          ${checkedInputIds.size} selected
          ${convertBigIntAmount(inSum)}
        </div>
        <div style="color: #e74c3c;">${short}</div>
        ${sweepMode && checkedInputIds.size === 0
          ? html`<div>no selection sweeps all spendable inputs</div>`
          : ""}
      </div>`
    : "";
  const rows = outputBlocks.length ? flatten(outputBlocks) : "";
  const fails = failedBlocks.length ? flatten(failedBlocks) : "";
  if (!coinControlMode) {
    return html`<div>
      ${ccStyle()}
      <span class="cc-link" id="openCoinControlButton">coin control</span>
    </div>`;
  }
  return html`<div>
    ${ccStyle()}
    ${rows}
    ${sweepMode
      ? ""
      : html`<span class="cc-btn" id="cc-add-output">add output</span>`}
    <span
      class="cc-btn ${selectInputOpen ? "cc-btn-on" : ""}"
      id="cc-select-input"
      >select input</span
    >
    ${list}
    <div>
      <span class="cc-btn ${sweepMode ? "cc-btn-on" : ""}" id="cc-sweep"
        >external sweep</span
      >
    </div>
    <div>
      <span class="cc-link cc-link-on" id="openCoinControlButton"
        >standard transaction</span
      >
    </div>
    ${fails}
  </div>`;
}
