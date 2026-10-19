import {
  openWallets,
  configureUnpacked,
  type InvocationState,
} from "@spirobel/monero-wallet-api/unpacked";

configureUnpacked({
  workerUrl: "worker_unpacked.js",
  moneroWasmUrl: "monero_wallet_api.wasm",
  dkgWasmUrl: "frost_dkg.wasm",
});
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
  const env = await Bun.file(".env").text().catch(() => "");
  return env.split("\n").some((line) => {
    const [key, ...rest] = line.split("=");
    if (typeof key !== "string") return false;
    return key.trim() === "SEEDPHRASE" && rest.join("=").trim().length > 0;
  });
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
  const all = log()?.invocations("active") ?? [];
  if (!all.length) return null;
  all.sort((a, b) => openTimestamp(b) - openTimestamp(a));
  return all[0] ?? null;
}

// a new tool call must show send or wallets plate so accept/dismiss btn + tool call info is on screen.
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
