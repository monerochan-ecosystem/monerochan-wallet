import {
  convertBigIntAmount,
  convertAmountBigInt,
  parseAddress,
  type ParseAddressError,
  type ParsedAddress,
} from "@spirobel/monero-wallet-api/unpacked";
import { html, type MiniHtmlString } from "@spirobel/mininext";
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
let selectInputOpen = false;
let coinOutputSeq = 1;
// the payment rows belong to the wallet route that made them
type CoinControlState = {
  rows: CoinOutputRow[];
  sweep: boolean;
  fee: bigint | null;
};
const ccByRoute = new Map<string, CoinControlState>();
function cc(): CoinControlState {
  const key = currentlySelectedWallet()?.primary_address ?? "";
  let row = ccByRoute.get(key);
  if (!row)
    ccByRoute.set(key, (row = { rows: [], sweep: false, fee: null }));
  return row;
}
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
  cc().sweep = false;
  cc().fee = null;
  selectInputOpen = false;
  cc().rows = [];
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
    if (cc().rows.length === 0) {
      const row = freshOutputRow();
      row.amount = notedDraft.amount;
      row.address = notedDraft.address;
      row.amountAtomic = notedDraft.amountAtomic;
      row.parsed = notedDraft.parsed;
      cc().rows = [row];
      if (row.address && !row.parsed) void setOutputAddress(row, row.address);
    }
    return;
  }
  const first = cc().rows[0];
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
  const state = cc();
  state.sweep = !state.sweep;
  if (!state.sweep) {
    state.fee = null;
    return;
  }
  const kept = state.rows[0] ?? freshOutputRow();
  kept.amount = "";
  kept.amountAtomic = null;
  state.rows = [kept];
  const wallet = currentlySelectedWallet();
  if (!wallet) return;
  try {
    const estimate = await wallet.getFeeEstimate();
    if (state.sweep) state.fee = BigInt(estimate.fees?.[0] ?? 0) * 10000n;
  } catch {
    state.fee = null;
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
  return cc().rows.reduce(
    (sum, row) => sum + (row.amountAtomic ?? 0n),
    0n,
  );
}

function rowAddressOk(row: CoinOutputRow) {
  return !!row.parsed && "address" in row.parsed;
}

function coinOutputsValid() {
  const first = cc().rows[0];
  if (!first) return false;
  if (cc().sweep) return cc().rows.length === 1 && rowAddressOk(first);
  return cc().rows.every(
    (row) => rowAddressOk(row) && (row.amountAtomic ?? 0n) > 0n,
  );
}

export function coinControlSendReady(sendLocked: boolean) {
  if (!connectedToNode() || !window.unlocked || sendLocked) return false;
  if (!coinOutputsValid()) return false;
  if (cc().sweep) {
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
  pruneCheckedInputs();
  const sweep = cc().sweep;
  const address = (cc().rows[0]?.address ?? "").trim();
  const input_indexes = [...checkedInputIds];
  const payments = cc().rows.map((row) => ({
    address: row.address.trim(),
    amount: (row.amountAtomic ?? 0n).toString(),
  }));
  markSent();
  // drop the form before the wallet waits on the node.
  resetCoinControl();
  if (openSpendId) await dismissSpend(openSpendId);
  if (sweep) {
    await window.wallets?.sweepSignSend({
      primary_address: wallet_to_send_from_pa,
      address,
      input_indexes,
    });
    return;
  }
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
  outputNumber?: number,
) {
  if (hidden) return html`<div style="display: none;"></div>`;
  if (!raw.length || !parsed) return html`<div></div>`;
  if (!("address" in parsed))
    return html`<div style="user-select: none;">invalid address</div>`;
  return html`<div>
    <div style="user-select: none;">
      destination address${outputNumber === undefined ? "" : ` for output ${outputNumber}`} (${parsed.network}):
    </div>
    <div class="parsed-address">${parsed.address}</div>
  </div>`;
}

function ccStyle() {
  return html`<style>
    .cc-toolbar { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; margin: 8px 0; }
    .cc-toolbar-actions { display: flex; align-items: center; gap: 6px; }
    .cc-toolbar .cc-btn { margin: 0; }
    .cc-output-label { min-height: 1.2em; margin-right: 12px; text-align: right; font-size: 12px; font-weight: normal; line-height: 1.2; color: rgba(255, 255, 255, 0.75); user-select: none; }
    .cc-modes { display: inline-flex; width: fit-content; margin: 0; }
    .cc-modes .cc-btn { position: relative; margin: 0; border-radius: 0; }
    .cc-modes .cc-btn:first-child { border-radius: 4px 0 0 4px; }
    .cc-modes .cc-btn:last-child { border-radius: 0 4px 4px 0; margin-left: -2px; }
    .cc-modes .cc-btn-on { z-index: 1; }
    .cc-btn {
      box-shadow:
        inset 0 4px 12px rgba(0, 0, 0, 0.45),
        0 5px 8px rgba(0, 0, 0, 0.4);
      display: inline-block;
      color: rgba(255, 255, 255, 0.75);
      background: transparent;
      font-family: inherit;
      font-size: 14px;
      font-weight: normal;
      line-height: normal;
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
    .cc-list {
      overflow: auto;
      max-height: 140px;
      margin-top: 8px;
      margin-right: 12px;
    }
    .cc-line {
      display: grid;
      grid-template-columns: 22px max-content minmax(0, 1fr);
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

function inputValue(event: Event) {
  return (event.target as HTMLInputElement).value;
}
function toggleInputSelection(id: string, event: Event) {
  if ((event.target as HTMLInputElement).checked) checkedInputIds.add(id);
  else checkedInputIds.delete(id);
}
async function setOutputAddress(row: CoinOutputRow, value: string) {
  row.address = value;
  row.parsed = null;
  const parsed = await parseAddress(value.trim());
  // a newer keystroke wins over an older parse
  if (row.address === value) row.parsed = parsed;
}
function setOutputAmount(row: CoinOutputRow, value: string) {
  row.amount = value;
  const atomic = convertAmountBigInt(value);
  row.amountAtomic = atomic > 0n ? atomic : null;
}
function removeOutput(key: CoinOutputRow["key"]) {
  cc().rows = cc().rows.filter((item) => item.key !== key);
}
function addOutput() {
  cc().rows = [...cc().rows, freshOutputRow()];
}
function chooseMode(coinControl: boolean) {
  if (coinControlMode !== coinControl) toggleCoinControlMode();
}

export function sendModeSelector(activeTool = false): MiniHtmlString {
  pruneCheckedInputs();
  if (activeTool) return html`<div hidden>${ccStyle()}</div>`;
  return html`<div>${ccStyle()}<div class="cc-toolbar">
    <div class="cc-modes" role="group" aria-label="transaction mode">
      <button type="button" class="cc-btn ${!coinControlMode ? "cc-btn-on" : ""}" id="send-mode-standard" aria-pressed="${String(!coinControlMode)}" onclick=${() => chooseMode(false)}>standard</button>
      <button type="button" class="cc-btn ${coinControlMode ? "cc-btn-on" : ""}" id="openCoinControlButton" aria-pressed="${String(coinControlMode)}" onclick=${() => chooseMode(true)}>coin control</button>
    </div>
    ${coinControlMode ? html`<div class="cc-toolbar-actions">
      <button type="button" class="cc-btn ${selectInputOpen ? "cc-btn-on" : ""}" id="cc-select-input" aria-pressed="${String(selectInputOpen)}" onclick=${toggleSelectInput}>select input</button>
      ${cc().sweep ? html`<span hidden></span>` : html`<button type="button" class="cc-btn" id="cc-add-output" onclick=${addOutput}>add output</button>`}
    </div>` : ""}
  </div></div>`;
}

function coinOutputFields(row: CoinOutputRow, number: number): MiniHtmlString {
  return html`<div class="input-block cc-output-fields" data-output-key="${row.key}">
    ${cc().sweep ? html`<span hidden></span>` : html`<div class="input-block"><input type="text" id="cc-amt-${row.key}" class="send-input-element" placeholder="Enter amount" value="${row.amount}" oninput=${(e: Event) => setOutputAmount(row, inputValue(e))} />${selectedAmountLine(row.amountAtomic, "")}</div>`}
    <input type="text" id="cc-addr-${row.key}" class="send-input-element" placeholder="Enter address" value="${row.address}" oninput=${(e: Event) => void setOutputAddress(row, inputValue(e))} />
    <div class="cc-output-label">output ${number}</div>
  </div>`;
}

export function coinControlFields(): MiniHtmlString {
  if (!cc().rows.length) cc().rows = [freshOutputRow()];
  return coinOutputFields(cc().rows[0]!, 1);
}

export function coinControlView(): MiniHtmlString {
  if (!coinControlMode) return html`<div hidden></div>`;
  const inputs = currentlySelectedWallet()?.spendableInputs() ?? [];
  const inputRows = inputs.map((input) => {
    const id = String(input.index_on_blockchain);
    return html`<div class="cc-line">
      <input
        class="cc-check"
        type="checkbox"
        id="cc-in-${id}"
        checked=${checkedInputIds.has(id)}
        onchange=${(e: Event) => toggleInputSelection(id, e)}
      />
      <label class="cc-amt" for="cc-in-${id}">${convertBigIntAmount(input.amount)}</label>
      <label for="cc-in-${id}">${id}</label>
    </div>`;
  });
  const outSum = extraOutputSum();
  const inSum = selectedInputSum();
  const short =
    !cc().sweep && checkedInputIds.size > 0 && inSum < outSum
      ? "exceeds selected inputs"
      : "";
  const visibleRows = cc().sweep ? cc().rows.slice(0, 1) : cc().rows;
  const outputBlocks = visibleRows.map((row, index) => html`<div class="cc-extra">
    ${index > 0 ? coinOutputFields(row, index + 1) : ""}
    ${addressPreviewLine(row.address, row.parsed, false, index + 1)}
    ${cc().sweep ? html`<div>
      ${previewLine("selected inputs:", convertBigIntAmount(sweepBaseSum()))}
      ${previewLine("fee estimate:", cc().fee == null ? "..." : convertBigIntAmount(cc().fee!))}
    </div>` : index > 0 ? html`<button type="button" class="cc-btn" id="cc-rm-${row.key}" onclick=${() => removeOutput(row.key)}>remove</button>` : ""}
  </div>`);
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
      ${inputLines}
      ${row.txlog.signed_tx
        ? html`<span class="cc-btn" id="cc-re-${row.index}" onclick=${() => {
            const pa = currentlySelectedWallet()?.primary_address;
            if (!pa || !row.txlog.signed_tx) return;
            void window.wallets?.rebroadcastTx({
              primary_address: pa,
              tx_log_index: row.index,
            });
          }}>rebroadcast</span>`
        : ""}
    </div>`;
  });
  const list = selectInputOpen
    ? html`<div class="cc-list">
        ${inputs.length
          ? html`<div>${inputRows}</div>`
          : html`<div>no spendable inputs</div>`}
        <div>
          ${checkedInputIds.size} selected
          ${convertBigIntAmount(inSum)}
        </div>
        <div style="color: #e74c3c;">${short}</div>
        ${cc().sweep && checkedInputIds.size === 0
          ? html`<div>no selection sweeps all spendable inputs</div>`
          : ""}
      </div>`
    : "";
  const rows = outputBlocks.length ? html`<div>${outputBlocks}</div>` : "";
  return html`<div>
    ${list}
    ${rows}
    <div>
      <span class="cc-btn ${cc().sweep ? "cc-btn-on" : ""}" id="cc-sweep" onclick=${toggleSweep}
        >external sweep</span
      >
    </div>
    ${failedBlocks}
  </div>`;
}
