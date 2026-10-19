import {
  openWallets,
  configureUnpacked,
  type ManyScanCachesOpened,
} from "@spirobel/monero-wallet-api/unpacked";

configureUnpacked({
  workerUrl: "worker_unpacked.js",
  moneroWasmUrl: "monero_wallet_api.wasm",
  dkgWasmUrl: "frost_dkg.wasm",
});

declare global {
  var browser: typeof chrome;
}
if (typeof chrome !== "undefined" && typeof browser === "undefined") {
  globalThis.browser = chrome;
}

let wallets: ManyScanCachesOpened | undefined;

async function initWallets() {
  wallets?.stopWorker();
  wallets = await openWallets({
    autoRetry: true,
    retryDelayMs: 1000,
    no_stats: true,
    actionLogBackend: "idb",
    extensionMessageBus: "worker",
  });
  return wallets;
}

wallets = await initWallets();
