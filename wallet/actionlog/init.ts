import {
  ActionLogOpened,
  type InvocationState,
} from "@spirobel/monero-wallet-api";

if (typeof chrome !== "undefined" && typeof browser === "undefined") {
  (globalThis as unknown as { browser: typeof chrome }).browser = chrome;
}

let log: ActionLogOpened | null = null;

export function actionLog(): ActionLogOpened | null {
  return log;
}

export async function initActionLogPage() {
  log = await ActionLogOpened.create({
    backend: "idb",
    extensionMessageBus: "ui",
  });
}

export function openRows(): InvocationState[] {
  return log?.invocations("active") ?? [];
}
