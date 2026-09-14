import {
  openWallets,
  SCAN_SETTINGS_STORE_NAME_DEFAULT,
  type InvocationState,
} from "@spirobel/monero-wallet-api";
import { router } from "./router";
import { lowerButtonIds } from "./segments/walletLower";
import { removeActive } from "./ui/buttons";
import {
  navigateToFirstWallet,
  setConnectionStatus,
} from "./segments/walletRoute";

if (typeof chrome !== "undefined" && typeof browser === "undefined") {
  globalThis.browser = chrome;
}

function log() {
  return window.wallets?.actionLogOpened;
}

export async function initWallets() {
  window.wallets = await openWallets({
    no_worker: true,
    actionLogBackend: "idb",
    extensionMessageBus: "ui",
    onConnectionStatusChange: (status) => {
      setConnectionStatus(status);
    },
    onActionLogChange: () => {
      const last = newestOpen();
      if (last) syncUiToOpen(last);
    },
  });
  setConnectionStatus(
    window.wallets?.connectionStatusOpened?.connectionStatus ?? null,
  );
}

export async function initSidebar() {
  if (await setupFinishedYet()) {
    navigateToFirstWallet();
  } else {
    router.navigate("/onboarding");
    return;
  }
  await initWallets();
  await initToolInvocation();
}

export async function setupFinishedYet() {
  const scan_settings_file_content = await Bun.file(
    SCAN_SETTINGS_STORE_NAME_DEFAULT,
  )
    .text()
    .catch(() => "");
  return !!scan_settings_file_content.length;
}

export async function initToolInvocation() {
  const last = newestOpen();
  if (last) syncUiToOpen(last);
}

const plateByPermission = {
  spend: lowerButtonIds.send,
  share_view: lowerButtonIds.wallets,
} as const;

function openTimestamp(o: InvocationState): number {
  if (!o.timestamp) return 0;
  const t = Date.parse(o.timestamp);
  return Number.isFinite(t) ? t : 0;
}

function newestOpen(): InvocationState | null {
  const all = log()?.getActive() ?? [];
  if (!all.length) return null;
  all.sort((a, b) => openTimestamp(b) - openTimestamp(a));
  return all[0] ?? null;
}

function syncUiToOpen(open: InvocationState) {
  removeActive(lowerButtonIds);
  for (const perm of Object.keys(plateByPermission) as Array<
    keyof typeof plateByPermission
  >) {
    const hit = log()
      ?.getActiveByPermissions([perm])
      .some((o) => o.invocationId === open.invocationId);
    if (!hit) continue;
    window.activeWalletPlate = plateByPermission[perm];
    break;
  }
  if (!window.activeWalletPlate) return;
  const button = document.getElementById(window.activeWalletPlate);
  if (button) button.classList.add("active-switch");
}
