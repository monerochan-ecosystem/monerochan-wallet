import {
  configureUnpacked,
  openWallets,
  type ManyScanCachesOpened,
} from "@spirobel/monero-wallet-api/unpacked";
import { confirmationChainHeight } from "../sidebar/segments/toolInfo";

if (typeof chrome !== "undefined" && typeof browser === "undefined") {
  (globalThis as unknown as { browser: typeof chrome }).browser = chrome;
}

configureUnpacked({
  workerUrl: "worker_unpacked.js",
  moneroWasmUrl: "monero_wallet_api.wasm",
  dkgWasmUrl: "frost_dkg.wasm",
});

let wallets: ManyScanCachesOpened | null = null;

export function actionLog() {
  return wallets?.actionLogOpened ?? null;
}

export function actionLogWallets() {
  return wallets?.wallets ?? [];
}

export function actionLogHeight(): number | undefined {
  return confirmationChainHeight(wallets?.connectionStatus);
}

export async function initActionLogPage() {
  wallets = await openWallets({
    no_worker: true,
    actionLogBackend: "idb",
    extensionMessageBus: "ui",
  });
  window.addEventListener("pagehide", () => wallets?.unwatchConnectionStatus(), { once: true });
}
