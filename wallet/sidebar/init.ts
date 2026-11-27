import {
  openWallets,
  configureUnpacked,
  openScanSettingsFile,
  writeScanSettingsFileDefaultLocation,
  type InvocationState,
} from "@spirobel/monero-wallet-api/unpacked";
import { WALLET_DEFAULT_ROUTE, walletRouteFromString, walletRouteToString } from "@spirobel/seedphrase";

configureUnpacked({
  workerUrl: "worker_unpacked.js",
  moneroWasmUrl: "monero_wallet_api.wasm",
  dkgWasmUrl: "frost_dkg.wasm",
});
import { router } from "./router";
import { prepareSelfSpend, selfSpendIsOn, setSendError } from "./segments/coincontrol";
import { lowerButtonIds } from "./segments/walletLower";
import {
  allWallets,
  setConnectionStatus,
} from "./segments/walletRoute";

if (typeof chrome !== "undefined" && typeof browser === "undefined") {
  globalThis.browser = chrome;
}

function normalizeRoute(route: string): string {
  return route.trim().replace(/^\/+/, "");
}

export function chooseSelectedWalletRoute(savedRoute: string, wallets: { wallet_route?: string }[]): string {
  const routes = wallets
    .map((wallet) => normalizeRoute(wallet.wallet_route ?? ""))
    .filter((route) => walletRouteFromString(route).ok);
  const saved = normalizeRoute(savedRoute);
  return routes.find((route) => route === saved)
    ?? routes[0]
    ?? walletRouteToString(WALLET_DEFAULT_ROUTE);
}

async function readSelection(): Promise<string> {
  return (await openScanSettingsFile())?.selected_wallet ?? "";
}

async function writeSelection(route: string): Promise<void> {
  await writeScanSettingsFileDefaultLocation({
    writeCallback: (settings) => { settings.selected_wallet = route; },
  });
}

export class SelectedWalletRouteStore {
  private lastSavedRoute: string | undefined;

  constructor(
    private read: () => Promise<string> = readSelection,
    private write: (route: string) => Promise<unknown> = writeSelection,
  ) {}

  async restore(wallets: { wallet_route?: string }[]): Promise<string> {
    const saved = await this.read().catch(() => "");
    const route = chooseSelectedWalletRoute(saved, wallets);
    this.lastSavedRoute = saved.trim() === route ? route : undefined;
    return route;
  }

  async save(path: string, wallets: { wallet_route?: string }[]): Promise<void> {
    const route = normalizeRoute(path);
    if (!walletRouteFromString(route).ok) return;
    if (!wallets.some((wallet) => normalizeRoute(wallet.wallet_route ?? "") === route)) return;
    if (route === this.lastSavedRoute) return;
    this.lastSavedRoute = route;
    try {
      await this.write(route);
    } catch (error) {
      if (this.lastSavedRoute === route) this.lastSavedRoute = undefined;
      throw error;
    }
  }
}

export const selectedWalletRouteStore = new SelectedWalletRouteStore();

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
  if (!(await setupFinishedYet())) {
    router.navigate("/onboarding");
    return;
  }
  await initWallets();
  const params = new URLSearchParams(window.location.search);
  const txLogIndex = params.get("self-spend");
  if (txLogIndex && /^\d+$/.test(txLogIndex)) {
    const wallet = allWallets().find((wallet) => wallet.primary_address === params.get("wallet"));
    if (wallet?.wallet_route) {
      const prepared = prepareSelfSpend(wallet, Number(txLogIndex));
      if (!prepared) setSendError(wallet.primary_address, "self spend inputs unavailable");
      window.activeWalletPlate = lowerButtonIds.send;
      router.navigate(wallet.wallet_route);
      return;
    }
  }
  router.navigate(await selectedWalletRouteStore.restore(allWallets()));
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
  if (selfSpendIsOn()) return;
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
}
