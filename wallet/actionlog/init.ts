import {
  ActionLogOpened,
  type ActionLogEvent,
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
  return log?.getActive() ?? [];
}

let loadedId: string | null = null;
let loadedBranch: ActionLogEvent[] = [];
let loadGen = 0;
let lastFetchAt = 0;

export function cachedBranch(invocationId: string): ActionLogEvent[] {
  if (loadedId !== invocationId) return [];
  return loadedBranch;
}

export function ensureBranch(invocationId: string) {
  const now = Date.now();
  if (loadedId === invocationId && now - lastFetchAt < 400) return;
  lastFetchAt = now;
  const g = ++loadGen;
  void log?.getBranch(invocationId).then((rows) => {
    if (g !== loadGen) return;
    loadedId = invocationId;
    loadedBranch = rows;
  });
}
