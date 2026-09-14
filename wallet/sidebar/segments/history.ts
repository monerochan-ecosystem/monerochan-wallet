import type { FoundTransaction } from "@spirobel/monero-wallet-api";
import { flatten, html } from "../../../mininext/mininext";
import { rightUpper, tactileContentPlate } from "../ui/content";
import { currentlySelectedWallet } from "./walletRoute";
import {
  truncateDecimalString,
  convertBigIntAmount,
} from "@spirobel/monero-wallet-api";
import type { Pending, PrePendingTx } from "@spirobel/monero-wallet-api/";
import { openActionLogPage } from "../../actionlog/open";
const openDetails: Record<string, boolean | undefined> = {};
function setOpenDetails(tx_hash: string) {
  const details = document.getElementById(
    `${tx_hash}-details`,
  ) as HTMLElement | null;
  if (details) {
    if (openDetails[tx_hash]) {
      details.style.display = "block";
    } else {
      details.style.display = "none";
    }
  }
}
function txDetails(tx: FoundTransaction) {
  const sub_index = tx.outputs[0]?.subaddress_index;
  const sub_snippet = sub_index
    ? html`<div class="tx-detail">
        <div>subaddress index:</div>
        <div style="color: white;">${sub_index}</div>
      </div>`
    : "";
  const is_miner = tx.outputs[0]?.is_miner_tx;
  const miner_snippet = is_miner
    ? html`<div class="tx-detail">
        <div>is miner tx:</div>
        <div style="color: white;">yes</div>
      </div>`
    : "";
  const is_pending = tx.status.status === "pending";
  const pending_snippet = is_pending
    ? html`<div class="tx-detail">
        <div>unlock height:</div>
        <div style="color: white;">${(tx.status as Pending).unlock_height}</div>
      </div>`
    : "";
  const is_confirmed = tx.status.status === "spendable";
  const confirmed_snippet = is_confirmed
    ? html`<div class="tx-detail">
        <div>confirmed:</div>
        <div style="color: white;">yes</div>
      </div>`
    : "";

  const has_destination = tx.txlog?.payments?.length || 0 > 0;
  const destination_snippet = has_destination
    ? html`<div class="tx-detail">
        <div>destination:</div>
        <div style="color: white;" class="destination-address">
          ${tx.txlog?.payments[0]?.address || ""}
        </div>
      </div>`
    : "";

  return html`<div>
    <style>
      .tx-detail {
        display: grid;
        grid-template-columns: 50px 158px;
        margin-top: 5px;
        margin-bottom: 4px;
        margin-left: 33px;
        gap: 40px;
      }
      .tx-hash {
        width: 162px;
        word-wrap: break-word;
        display: inline-block;
        color: white;
      }
    </style>
    <div class="tx-detail">
      <div>tx_hash:</div>
      <div class="tx-hash">${tx.tx_hash}</div>
    </div>
    <div class="tx-detail">
      <div>block_height:</div>
      <div>${tx.outputs[0]?.block_height!}</div>
    </div>
    <div class="tx-detail">
      <div>payment_id:</div>
      <div>${tx.outputs[0]?.payment_id!}</div>
    </div>
    <div class="tx-detail">
      <div>exact amount:</div>
      <div style="color: white;">${convertBigIntAmount(tx.amount)}</div>
    </div>
    ${sub_snippet} ${miner_snippet} ${pending_snippet} ${confirmed_snippet}
    ${destination_snippet}
    ${invocationLink(tx.txlog?.invocationId, `log-${tx.tx_hash}`)}
  </div>`;
}

function invocationLink(invocationId: string | undefined, domId: string) {
  if (!invocationId) return html`<div></div>`;
  const el = document.getElementById(domId);
  if (el) el.onclick = () => openActionLogPage(invocationId);
  return html`<div class="tx-detail">
    <div>log:</div>
    <div id="${domId}" style="cursor: pointer; text-decoration: underline;">
      actionlog
    </div>
  </div>`;
}

function preTxDetails(tx: PrePendingTx) {
  const has_destination = tx.txlog?.payments?.length || 0 > 0;
  const destination_snippet = has_destination
    ? html`<div class="tx-detail">
        <div>destination:</div>
        <div style="color: white;" class="destination-address">
          ${tx.txlog?.payments[0]?.address || ""}
        </div>
      </div>`
    : "";

  return html`<div>
    <style>
      .tx-detail {
        display: grid;
        grid-template-columns: 50px 158px;
        margin-top: 5px;
        margin-bottom: 4px;
        margin-left: 33px;
        gap: 40px;
      }
      .tx-hash {
        width: 162px;
        word-wrap: break-word;
        display: inline-block;
        color: white;
      }
    </style>
    <div class="tx-detail">
      <div>self spent:</div>
      <div class="tx-hash">${tx.self_spent ? "yes" : "no"}</div>
    </div>

    ${destination_snippet}
    ${invocationLink(
      tx.txlog?.invocationId,
      `log-pre-${tx.inputs[0]?.index_on_blockchain ?? "x"}`,
    )}
  </div>`;
}
function PrependingTxsList() {
  const pretxs = currentlySelectedWallet()
    ?.prepending_txs.toReversed()
    .map((tx) => {
      const detailsId = `inputId0-${tx.inputs[0]?.index_on_blockchain!}`;
      const date = new Date(tx.txlog.timestamp);
      const showDetailsBtn = document.getElementById(detailsId);
      if (showDetailsBtn) {
        showDetailsBtn.onclick = () => {
          const details = document.getElementById(
            `${detailsId}-details`,
          ) as HTMLElement | null;
          if (details) {
            if (openDetails[detailsId]) {
              details.style.display = "none";
              openDetails[detailsId] = false;
            } else {
              details.style.display = "block";
              openDetails[detailsId] = true;
            }
          }
        };
      }
      setOpenDetails(detailsId);
      return html`<div class="tx-container">
        <div class="transaction">
          <div></div>
          <div>
            <span class="sign">-</span>
            <span class="amount-negative">
              ${truncateDecimalString(convertBigIntAmount(tx.amount))}
            </span>
          </div>
          <div class="timestamp">
            ${date.toLocaleString(undefined, {
              year: "2-digit",
              month: "2-digit",
              day: "2-digit",
              hour: "2-digit",
              minute: "2-digit",
              hour12: false,
            })}
            <span class="pending">(pending)</span>
          </div>
          <div class="details" id="${detailsId}">
            ${openDetails[detailsId] ? "hide" : "show"} details
          </div>
        </div>
        <div class="tx-details" id="${detailsId}-details">
          ${openDetails[detailsId] ? preTxDetails(tx) : html`<div></div>`}
        </div>
      </div> `;
    });
  if (!pretxs || pretxs.length === 0) {
    return html`<div></div>`;
  }
  return flatten(pretxs);
}
function transactionsList() {
  const txs = currentlySelectedWallet()
    ?.transactions.toReversed()
    .map((tx) => {
      const tx_hash = tx.tx_hash;

      const date = new Date(tx.outputs[0]?.block_timestamp! * 1000);
      const showDetailsBtn = document.getElementById(tx_hash);
      if (showDetailsBtn) {
        showDetailsBtn.onclick = () => {
          const details = document.getElementById(
            `${tx_hash}-details`,
          ) as HTMLElement | null;
          if (details) {
            if (openDetails[tx_hash]) {
              details.style.display = "none";
              openDetails[tx_hash] = false;
            } else {
              details.style.display = "block";
              openDetails[tx_hash] = true;
            }
          }
        };
      }
      setOpenDetails(tx_hash);
      const positive_or_negative = tx.amount > 0 ? "amount" : "amount-negative";
      const amount_class =
        tx.status.status === "pending" ? "" : positive_or_negative;
      const sign = tx.amount > 0 ? "+" : "-";
      return html`<div class="tx-container">
        <div class="transaction">
          <div></div>
          <div>
            <span class="sign">${sign}</span>
            <span class="${amount_class}">
              ${truncateDecimalString(convertBigIntAmount(tx.amount))}
            </span>
          </div>
          <div class="timestamp">
            ${date.toLocaleString(undefined, {
              year: "2-digit",
              month: "2-digit",
              day: "2-digit",
              hour: "2-digit",
              minute: "2-digit",
              hour12: false,
            })}
            ${tx.status.status === "pending"
              ? html`<span class="pending">(pending)</span>`
              : ""}
          </div>
          <div class="details" id="${tx.tx_hash}">
            ${openDetails[tx.tx_hash] ? "hide" : "show"} details
          </div>
        </div>
        <div class="tx-details" id="${tx.tx_hash}-details">
          ${openDetails[tx_hash] ? txDetails(tx) : html`<div></div>`}
        </div>
      </div> `;
    });
  if (!txs || txs.length === 0) {
    return html`<div style="user-select: none;margin-left: 148px;">
      no transactions found yet
    </div>`;
  }
  return flatten(txs);
}
export function historyPlate() {
  return tactileContentPlate(
    html`
      <div class="tx-history-container">
        <style>
          .transaction {
            margin-top: 10px;
            margin-right: 5px;
            display: grid;
            grid-template-columns: 1fr 69px 124px 60px;
            font-weight: 700;
            font-size: 16px;
            gap: 12px;
          }
          .timestamp {
          }
          .sign {
            margin-right: 4px;
          }
          .amount {
            color: #ff4444;
          }
          .amount-negative {
            color: white;
          }
          .pending {
            color: #ff4444;
          }
          .details {
            cursor: pointer;
            font-family: sans-serif;
            font-weight: 700;
            user-select: none;
          }
          .details:hover {
            color: white;
          }
          .destination-address {
            width: 150px;
            word-wrap: break-word;
            display: inline-block;
            margin-bottom: 20px;
          }
        </style>
        ${PrependingTxsList()} ${transactionsList()}
      </div>
    `,
    rightUpper,
    undefined,
    // floor 468 so tiny sidebars dont collapse. grow with window when taller.
    "max(468px, calc(100vh - 400px))",
  );
}
