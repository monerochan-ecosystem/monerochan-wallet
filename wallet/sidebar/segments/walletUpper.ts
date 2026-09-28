import {
  convertBigIntAmount,
  readConnectionStatusDefaultLocation,
} from "@spirobel/monero-wallet-api";
import { html } from "../../../mininext/mininext";
import { currentlySelectedWallet, firstWallet } from "./walletRoute";
export const safetyButtonIds = {
  fire: "fire",
  safe: "safe",
} as const;
export type SafetyButtonIds =
  (typeof safetyButtonIds)[keyof typeof safetyButtonIds];
export function safetyClickHandler(e: MouseEvent) {
  const target = e.currentTarget as HTMLElement | null;
  const id = (e.currentTarget as HTMLElement | null)?.id as SafetyButtonIds;
  if (!id || !target) return;
  const knob = document.getElementById("knob");
  const fireLabel = document.getElementById("fire-label");
  const safeLabel = document.getElementById("safe-label");
  const fireButton = document.getElementById("fire");
  const safeButton = document.getElementById("safe");
  if (knob && fireLabel && safeLabel && fireButton && safeButton) {
    if (id === "fire") {
      knob.classList.add("knob-fire");
      fireLabel.classList.remove("deselected-label");
      safeLabel.classList.add("deselected-label");
      window.unlocked = true;
      fireButton.style.cursor = "default";
      safeButton.style.cursor = "pointer";
    } else {
      fireLabel.classList.add("deselected-label");
      safeLabel.classList.remove("deselected-label");
      knob.classList.remove("knob-fire");
      window.unlocked = false;
      fireButton.style.cursor = "pointer";
      safeButton.style.cursor = "default";
    }
  }
}
export function truncateDecimalString(str: string, decimals = 3): string {
  if (!str.includes(".")) return str;

  const [integer, fraction = ""] = str.split(".");
  const truncatedFraction = fraction.slice(0, decimals);
  return truncatedFraction ? `${integer}.${truncatedFraction}` : integer!;
}
let interval: null | number | NodeJS.Timeout = null;
let catastropic_reorg = false;

export function startCatReorgCheck() {
  if (!interval) {
    interval = setInterval(checkConnection, 500);
    checkConnection();
  }
}

async function checkConnection() {
  const connectionStatus = await readConnectionStatusDefaultLocation();
  if (connectionStatus?.last_packet.status === "catastrophic_reorg") {
    catastropic_reorg = true;
  } else {
    catastropic_reorg = false;
  }
}

export const walletUpper = () => {
  startCatReorgCheck();
  if (catastropic_reorg) return catReorgWarningUpper();
  if (!firstWallet()) return noWalletUpper();
  const wallet = currentlySelectedWallet();
  const amount = convertBigIntAmount(wallet?.amount || 0n);
  const amountTrun = truncateDecimalString(amount, 3);
  const pendingAmount = convertBigIntAmount(wallet?.pending_amount || 0n);
  const pendingAmountTrun = truncateDecimalString(pendingAmount, 3);
  const pendingEl = document.getElementById("pending-amount");
  if (pendingEl && wallet?.pending_amount && wallet.pending_amount > 0n)
    pendingEl.style.display = "block";
  if (
    pendingEl &&
    ((wallet?.pending_amount && wallet.pending_amount <= 0n) ||
      !wallet?.pending_amount)
  )
    pendingEl.style.display = "none";

  const domain = window.walletRouteParams?.domain ?? "no_domain";
  const wallet_index = Number(window.walletRouteParams?.wallet_slot) ?? 0;
  const wallet_index_string = wallet_index > 0 ? ` ${wallet_index} ` : "";
  const display_domain = domain === "no_domain" ? "" : domain;
  const identity = window.walletRouteParams?.identity ?? "main";

  return html` <div class="upper">
    <div class="labels">
      <div class="safe-label" id="safe-label">0</div>
      <div class="fire-label deselected-label" id="fire-label">
        ${amountTrun} XMR
        <div class="pending-amount" id="pending-amount" style="display: none;">
          ${pendingAmountTrun} (pending)
        </div>
      </div>
    </div>

    <div class="track" id="track">
      <div class="knob" id="knob">
        <div class="knob-outer">
          <div class="knob-inner"></div>
        </div>
      </div>
    </div>

    <div class="multi"></div>
    <div class="divider"></div>
    <div class="wallet-domain">${display_domain} ${wallet_index_string}</div>

    <div class="wallet-name">${identity}</div>
    <div id="safe"></div>
    <div id="fire"></div>
    <style>
      .pending-amount {
        font-size: 10px;
        right: 53px;
        position: absolute;
      }
      #safe {
        position: absolute;
        width: 100px;
        height: 80px;
      }
      #fire {
        position: absolute;
        margin-left: 100px;
        width: 170px;
        height: 80px;
        cursor: pointer;
      }
      .upper {
        height: 199px;
        background: linear-gradient(145deg, #444 0%, #2a2a2a 100%);
        border-radius: 12px;
        border: 4px solid #666;
        box-shadow:
          inset 0 4px 12px rgba(0, 0, 0, 0.6),
          0 15px 25px rgba(0, 0, 0, 0.4);
        display: grid;
        grid-template-areas:
          "labels labels labels"
          "track track track"
          "multi multi multi"
          "divider divider divider"
          "wallet wallet wallet";
        grid-template-rows: 30px 16px 30px 4px 40px;
        grid-template-columns: 30px 1fr 30px;
        padding: 20px 30px;
        box-sizing: border-box;
        gap: 10px 0;
        user-select: none;
      }
      .multi {
        grid-area: multi;
        height: 100%;
      }
      .track {
        grid-area: track;
        width: 200px;
        height: 100%;
        background: #555;
        border-radius: 6px;
        border: 2px inset #777;
        box-shadow: inset 0 1px 3px rgba(0, 0, 0, 0.8);
        cursor: pointer;
      }
      .knob {
        width: 30px;
        height: 28px;
        cursor: pointer;
        transform: translate(3px, -5px);
        transition: transform 0.1s linear;
        display: flex;
        align-items: center;
      }
      .knob-fire {
        transform: translate(172px, -5px);
      }
      .knob-outer {
        width: 24px;
        height: 100%;
        background: linear-gradient(145deg, #666, #444);
        border: 2px solid #888;
        border-radius: 3px;
        box-shadow:
          inset 0 1px 3px rgba(255, 255, 255, 0.1),
          0 3px 8px rgba(0, 0, 0, 0.6);
      }

      .knob-inner {
        position: relative;
        left: 2px;
        width: 16px;
        height: 24px;
        background: #555;
        border: 1px solid #777;
        border-radius: 1px;
        transform: rotate(90deg);
        box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.8);
      }

      .labels {
        grid-area: labels;
        display: flex;
        align-items: flex-end;
        padding-bottom: 3px;
        margin-right: 10px;
        justify-content: space-between;
        font-size: 20px;
        font-weight: bold;
        text-shadow: 0 1px 2px rgba(0, 0, 0, 0.8);
      }

      .safe-label {
        color: white;
        margin-left: 35px;
      }
      .fire-label {
        color: #ff4444;
        white-space: nowrap;
      }
      .deselected-label {
        opacity: 0.5;
      }

      .divider {
        grid-area: divider;
        height: 4px;
        background: #666;
        border-radius: 12px;
        box-shadow: 0 0 12px rgba(0, 0, 0, 0.6);
      }
      .wallet-domain {
        grid-area: wallet;
        margin-left: 5px;
        font-size: 18px;
        font-weight: bold;
        color: #bbb;
        text-shadow: 0 1px 2px rgba(0, 0, 0, 0.8);
      }

      .wallet-name {
        grid-area: wallet;
        text-align: right;
        margin-right: 10px;
        font-size: 18px;
        font-weight: bold;
        color: #bbb;
        text-shadow: 0 1px 2px rgba(0, 0, 0, 0.8);
      }
    </style>
  </div>`;
};

function catReorgWarningUpper() {
  return html` <div class="upper">
    <div class="cat-reorg">
      catastrophic reorg occured, <br />

    </div>
    <div class="hint">
      reset your wallet, <br />
      connect to a non faulty node (preferably local) &
      recover from seedphrase 
      </div>
      <style>
        .upper {
          height: 199px;
          background: linear-gradient(145deg, #444 0%, #2a2a2a 100%);
          border-radius: 12px;
          border: 4px solid #666;
          box-shadow:
            inset 0 4px 12px rgba(0, 0, 0, 0.6),
            0 15px 25px rgba(0, 0, 0, 0.4);
          display: grid;

          padding: 20px 30px;
          box-sizing: border-box;
          gap: 10px 0;
          user-select: none;
        }
        .cat-reorg {
          font-size: 20px;
          font-weight: bold;
          color: #ff4444;
          text-shadow: 0 1px 2px rgba(0, 0, 0, 0.8);
        }
        .hint{
          font-size: 16px;
          font-weight: bold;
          color: #ff4444;
          text-shadow: 0 1px 2px rgba(0, 0, 0, 0.8);
        }
      </style>
    </div>
  </div>`;
}

function noWalletUpper() {
  return html` <div class="upper">
    <div class="cat-reorg">
      no wallet routes found, <br />

    </div>
    <div class="hint">
      most likely you removed them all, <br />
      restore the routes you need or
      recover from seedphrase 
      </div>
      <style>
        .upper {
          height: 199px;
          background: linear-gradient(145deg, #444 0%, #2a2a2a 100%);
          border-radius: 12px;
          border: 4px solid #666;
          box-shadow:
            inset 0 4px 12px rgba(0, 0, 0, 0.6),
            0 15px 25px rgba(0, 0, 0, 0.4);
          display: grid;

          padding: 20px 30px;
          box-sizing: border-box;
          gap: 10px 0;
          user-select: none;
        }
        .cat-reorg {
          font-size: 20px;
          font-weight: bold;
          color: #ff4444;
          text-shadow: 0 1px 2px rgba(0, 0, 0, 0.8);
        }
        .hint{
          font-size: 16px;
          font-weight: bold;
          color: #ff4444;
          text-shadow: 0 1px 2px rgba(0, 0, 0, 0.8);
        }
      </style>
    </div>
  </div>`;
}
