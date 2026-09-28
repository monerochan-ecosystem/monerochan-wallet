import { setupFinishedYet } from "../wallet/sidebar/init";
import {
  openWallets,
  type ManyScanCachesOpened,
} from "@spirobel/monero-wallet-api";

declare global {
  var browser: typeof chrome;
}
if (typeof chrome !== "undefined" && typeof browser === "undefined") {
  globalThis.browser = chrome;
}

let wallets: ManyScanCachesOpened | undefined;

async function initWallets() {
  wallets?.stopWorker();
  if (!(await setupFinishedYet())) return undefined;

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
