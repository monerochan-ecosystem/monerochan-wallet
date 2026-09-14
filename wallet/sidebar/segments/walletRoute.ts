import {
  type ConnectionStatus,
  type ManyScanCachesOpened,
} from "@spirobel/monero-wallet-api";
import type { Mini } from "../../../mininext/mininext";
import { router, type WalletRouteParams } from "../router";
import { attachHandlers } from "../ui/buttons";
import {
  lowerButtonIds,
  lowerClickHandler,
  walletLower,
  type LowerButtonId,
} from "./walletLower";
import {
  safetyButtonIds,
  safetyClickHandler,
  walletUpper,
} from "./walletUpper";
import { walletRouteToString, type WalletRoute } from "@spirobel/seedphrase";

declare global {
  interface Window {
    walletRouteParams?: WalletRouteParams | null;
    activeWalletPlate?: LowerButtonId | null;
    wallets?: ManyScanCachesOpened;
    unlocked?: boolean;
    connectionStatus?: ConnectionStatus | null;
  }
}

export function setConnectionStatus(status: ConnectionStatus | null) {
  window.connectionStatus = status;
}

export const walletRoute = (mini: Mini, params: WalletRouteParams) => {
  window.walletRouteParams = params;
  //derive current wallet from that
  // with window.wallets
  attachHandlers(safetyButtonIds, safetyClickHandler);
  attachHandlers(lowerButtonIds, lowerClickHandler);
  return mini.html`
        <div class="main">
        <style>
            .main {
                display: flex;
                flex-direction: column;
                height: 100%;
                padding: 8px;
                gap: 11px;
            }
        </style>
        
            ${walletUpper()}
            ${walletLower()}
        </div>`;
};
export function allWallets() {
  if (!window.wallets?.wallets) return [];
  return window.wallets.wallets;
}
export function currentlySelectedWallet() {
  if (!window.wallets?.wallets) return undefined;
  if (!window.walletRouteParams) return undefined;
  const wallet_route = walletRouteToString(
    window.walletRouteParams as WalletRoute,
  );
  return (
    window.wallets?.wallets.find(
      (wallet) => wallet.wallet_route === wallet_route,
    ) || window.wallets?.wallets[0]
  );
}
export function firstWallet() {
  if (!window.wallets?.wallets) return undefined;
  return window.wallets.wallets[0];
}
export function navigateToFirstWallet() {
  router.navigate(firstWallet()?.wallet_route || "/main/no_domain/single/0");
}
export function currentStartingHeight() {
  if (!window.wallets?.wallets) return undefined;
  return window.wallets.start_height;
}
export async function setCurrentStartingHeight(start_height: number | null) {
  if (!window.wallets?.wallets) throw new Error("no wallets");
  await window.wallets.changeStartHeight(start_height);
}
export function daemonHeight(): number {
  const s = window.connectionStatus;
  return (
    s?.sync?.daemon_height ??
    s?.last_packet?.daemon_height ??
    0
  );
}
export function currentScanHeight(): number {
  return window.connectionStatus?.sync?.current_scan_height ?? 0;
}
export function eta(): string | null {
  return window.connectionStatus?.sync?.eta ?? null;
}

export function connectedToNode(): boolean {
  return window.wallets?.connectionStatusOpened?.isConnected ?? false;
}



