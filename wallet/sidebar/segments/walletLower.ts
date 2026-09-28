import { html } from "../../../mininext/mininext";
import { addActive, tactileSwitch } from "../ui/buttons";
import { removeActive } from "../ui/buttons";
import { plate } from "../ui/content";
import { walletUnlocked } from "./send";
import {
  connectedToNode,
  currentScanHeight,
  daemonHeight
} from "./walletRoute";

export const walletLower = () => {
  return html` <div class="lower">
    <style>
      .lower {
        display: grid;
        grid-template-rows: 40px 1fr 40px;
        height: 100%;
      }
    </style>
    ${lowerTopMenu()} ${plate()} ${lowerBottomMenu()}
  </div>`;
};
export function lowerClickHandler(e: MouseEvent) {
  const target = e.currentTarget as HTMLElement | null;
  const id = (e.currentTarget as HTMLElement | null)?.id as LowerButtonId;
  if (!id || !target) return;
  removeActive(lowerButtonIds);
  addActive(target);
  if (window.activeWalletPlate === id) {
    window.activeWalletPlate = null;
    removeActive(lowerButtonIds);
    return;
  }
  window.activeWalletPlate = id;
}

export type LowerButtonId =
  (typeof lowerButtonIds)[keyof typeof lowerButtonIds];

export const lowerButtonIds = {
  send: "send",
  receive: "receive",
  history: "history",
  wallets: "wallets",
  connection: "connection",
} as const;
export const sendButtonDotStyles = html` <style>
  .red-dot {
    height: 4px;
    width: 4px;
    margin: 2px;
    background-color: #ff4444;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.8);
    border-radius: 50%;
    display: inline-block;
  }
  .grey-dot {
    height: 4px;
    width: 4px;
    margin: 2px;
    background-color: #666;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.8);
    border-radius: 50%;
    display: inline-block;
  }
</style>`;
export function lowerTopMenu() {
  const historyButton = tactileSwitch(lowerButtonIds.history, "HISTORY");
  const receiveButton = tactileSwitch(lowerButtonIds.receive, "RECEIVE");
  const sendButtonClass = walletUnlocked() ? "red-dot" : "grey-dot";
  const sendButton = tactileSwitch(
    lowerButtonIds.send,
    html`<span>
      ${sendButtonDotStyles} SEND <span class="${sendButtonClass}"></span
    ></span>`,
  );
  return html`<div class="top-menu">
    ${sendButton} ${receiveButton}
    <div></div>
    ${historyButton}
    <style>
      .top-menu {
        display: grid;
        grid-template-columns: 80px 80px 1fr 80px;
        justify-content: start;
        gap: 8px;
        margin-left: 8px;
      }
    </style>
  </div> `;
}
export function lowerBottomMenu() {
  const walletsButton = tactileSwitch(lowerButtonIds.wallets, "WALLETS");
  const dotColor = connectedToNode() ? "green-dot" : "grey-dot";
  const connectionButton = tactileSwitch(
    lowerButtonIds.connection,
    html`<span>
      <style>
        .green-dot {
          height: 4px;
          width: 4px;
          margin: 2px;
          background-color: #4ade80;
          box-shadow: 0 1px 2px rgba(0, 0, 0, 0.8);
          border-radius: 50%;
          display: inline-block;
        }
        .grey-dot {
          height: 4px;
          width: 4px;
          margin: 2px;
          background-color: #666;
          box-shadow: 0 1px 2px rgba(0, 0, 0, 0.8);
          border-radius: 50%;
          display: inline-block;
        }
      </style>
      CONNECTION <span class="${dotColor}"></span
    ></span>`,
  );
  return html`<div class="bottom-menu">
    ${connectionButton} ${connectionProgress()} ${walletsButton}
    <style>
      .bottom-menu {
        display: grid;
        grid-template-columns: 135px 1fr 135px;

        margin-left: 8px;
      }
    </style>
  </div> `;
}

export function connectionProgress() {
  if (!connectedToNode()) return html`<div></div>`;
  return html`<div class="connection-progress">
    <style>
      .connection-progress {
        place-items: center;
        margin-left: -4px;
      }
      .mini-divider {
        width: 50px;
        height: 4px;
        background: #666;
        border-radius: 12px;
        box-shadow: 0 0 12px rgba(0, 0, 0, 0.6);
      }
      .heights {
        color: #888;
      }
      .eta {
        color: #aaa;
      }
    </style>
    <div class="heights">${currentScanHeight()}</div>
    <div class="mini-divider"></div>
    <div class="heights">${daemonHeight()}</div>
  </div>`;
}
