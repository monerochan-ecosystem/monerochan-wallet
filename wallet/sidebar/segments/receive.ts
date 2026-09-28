import {
  convertBigIntAmount,
  truncateDecimalString,
} from "@spirobel/monero-wallet-api";
import { flatten, html } from "../../../mininext/mininext";
import { actionButton, attachHandlers } from "../ui/buttons";
import { middleUpper, tactileContentPlate } from "../ui/content";
import { currentlySelectedWallet } from "./walletRoute";
import type {
  FoundTransaction,
  Pending,
  Subaddress,
} from "@spirobel/monero-wallet-api/";
export type ReceiveActionButtonIds =
  (typeof receiveActionButtonIds)[keyof typeof receiveActionButtonIds];
export const receiveActionButtonIds = {
  newAddress: "new-address",
  copyAddress: "copy-address",
} as const;

const openDetails: Record<string, boolean | undefined> = {};
function setOpenSubaddressDetails(subaddress: string) {
  const details = document.getElementById(
    `details-${subaddress}`,
  ) as HTMLElement | null;
  if (details) {
    if (openDetails[subaddress]) {
      details.style.display = "block";
    } else {
      details.style.display = "none";
    }
  }
}
export function receivePlate() {
  attachHandlers(receiveActionButtonIds, receiveClickHandler);
  const subaddresses = currentlySelectedWallet()?.subaddresses.toReversed();
  let plateContent = html`<div></div>`;
  if (subaddresses?.length) {
    plateContent = flatten(
      subaddresses.map((subaddress) => {
        const showDetailsBtn = document.getElementById(subaddress.address);
        if (showDetailsBtn) {
          showDetailsBtn.onclick = () => {
            const details = document.getElementById(
              `details-${subaddress.address}`,
            ) as HTMLElement | null;
            if (details) {
              if (openDetails[subaddress.address]) {
                details.style.display = "none";
                openDetails[subaddress.address] = false;
              } else {
                details.style.display = "block";
                openDetails[subaddress.address] = true;
              }
            }
          };
        }
        const colorclass =
          (subaddress.received_amount || 0n) > 0
            ? "amount-positive"
            : "amount-zero";
        const amount = convertBigIntAmount(subaddress.received_amount || 0n);
        const amountTrun = truncateDecimalString(amount, 3);
        setOpenSubaddressDetails(subaddress.address);

        return html`<div class="subaddress-container">
          <div class="subaddress" id="subaddress-${subaddress.address}">
            ${subaddress.address}
          </div>
          <div>
            <div class="amount ${colorclass}">${amountTrun}</div>
            <div class="show-info" id="${subaddress.address}">
              ${openDetails[subaddress.address] ? "hide" : "show"} details
            </div>
          </div>
          <div class="subaddress-details" id="details-${subaddress.address}">
            subadddress minor index: ${subaddress.minor}
            ${miniTransactionsList(subaddress)}
          </div>
        </div>`;
      }),
    );
  } else {
    plateContent = html`<div class="no-subaddress">
      no subaddresses <br />
    </div>`;
  }
  return html`<div class="plate">
    <style>
      .plate {
        display: grid;
        grid-template-rows: 1fr 80px;
      }
      .actions {
        display: grid;
        grid-template-columns: 140px 1fr 140px;
        margin-left: 8px;
      }
      .subaddress {
        width: 210px;
        word-wrap: break-word;
        display: inline-block;
        margin-bottom: 20px;
        user-select: all;
      }
      .subaddress-container {
        display: grid;
        grid-template-columns: 230px 1fr;
        grid-template-areas:
          "subaddress amount"
          "details details";
      }
      .show-info {
        width: 36px;
        margin-top: 7px;
        cursor: pointer;
        font-family: sans-serif;
        font-weight: 700;
        user-select: none;
      }
      .show-info:hover {
        color: white;
      }
      .amount {
      }
      .amount-positive {
        color: #ff4444;
      }
      .amount-zero {
        color: white;
      }
      .subaddress-details {
        grid-area: details;
        display: none;
        border: 2px solid white;
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
    </style>
    ${tactileContentPlate(
      plateContent,
      middleUpper,
      undefined,
      // floor 425. +80 for action row under the plate on top of the 400 surroundings.
      "max(425px, calc(100vh - 480px))",
    )}
    <div class="actions">
      ${actionButton(receiveActionButtonIds.newAddress, "NEW ADDRESS")}
      <div></div>
      ${actionButton(receiveActionButtonIds.copyAddress, "COPY")}
    </div>
  </div>`;
}

function selectTextAndCopy(address: string) {
  const el = document.getElementById(`subaddress-${address}`);
  if (!el) return false;

  // programmatically select the text like a mouse would
  const range = document.createRange();
  range.selectNodeContents(el);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);

  return true;
}

export function receiveClickHandler(e: MouseEvent) {
  console.log("receiveClickHandler");
  console.log(e);
  const target = e.currentTarget as HTMLElement | null;
  const id = (e.currentTarget as HTMLElement | null)
    ?.id as ReceiveActionButtonIds;
  if (!id || !target) return;
  if (id === receiveActionButtonIds.newAddress) {
    const subaddress = currentlySelectedWallet()?.makeSubaddress();
  }
  if (id === receiveActionButtonIds.copyAddress) {
    const subaddresses = currentlySelectedWallet()?.subaddresses.toReversed();
    if (subaddresses?.length) {
      const firstAddress = subaddresses[0]?.address;
      if (firstAddress) {
        if (selectTextAndCopy(firstAddress)) {
          navigator.clipboard.writeText(firstAddress);
        }
      }
    }
  }
}

function miniTransactionsList(subaddress: Subaddress) {
  const txs = currentlySelectedWallet()
    ?.transactions.toReversed()
    .filter((tx) => tx.outputs[0]?.subaddress_index === subaddress.minor)
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
      setOpenTxDetails(tx_hash);
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

function setOpenTxDetails(tx_hash: string) {
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
  </div>`;
}
