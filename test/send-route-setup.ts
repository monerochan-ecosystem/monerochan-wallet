import { ensureSidePanel } from "./cdp";
import {
  mineTo,
  needsReorgReset,
  nodeHeight,
  panelEval,
  reloadWalletBackground,
  reviveSidebar,
  startNodeAndBrowser,
  useRegtestNodeBeforeRestart,
} from "./setup";

const DECOY = "47cYSGSjzWPX3KFEN9PaxT5zpWKgRtx568bazbGzt57ffBbUAQevjMk19sfZCrMB1RWHNJLbz1eKU63B77HpHwUVA6JGudr";
export type TestRouteWallet = { address: string; route: string; amount: string; height: number };

export async function ensureTwoFundedRoutes(): Promise<TestRouteWallet[]> {
  startNodeAndBrowser();
  const info = await fetch("http://127.0.0.1:18081/get_info").then((response) => response.json());
  if (info.nettype !== "fakechain" || !info.offline) throw new Error("refuse to fund outside offline regtest");
  await ensureSidePanel();
  await reviveSidebar();
  if (await needsReorgReset()) {
    console.log("clear old regtest caches; keep the seed, routes, and selected-route file");
    await useRegtestNodeBeforeRestart();
    await reloadWalletBackground();
    await reviveSidebar();
  }
  const snapshot = () => panelEval(`window.wallets.wallets.filter(wallet => wallet.wallet_route).map(wallet => ({
    address: wallet.primary_address, route: wallet.wallet_route, amount: String(wallet.amount), height: wallet.current_height ?? 0,
  }))`) as Promise<TestRouteWallet[]>;
  const wallets = await snapshot();
  if (wallets.length < 2) throw new Error("test needs two routed wallets; run test/browser-002.ts first");
  let funded = false;
  for (const wallet of wallets.slice(0, 2)) {
    if (BigInt(wallet.amount) < 2_000_000_000_000n) {
      console.log("fund route", wallet.route);
      await mineTo(wallet.address, 2);
      funded = true;
    }
  }
  const height = await nodeHeight();
  const targetHeight = Math.max(10000, funded ? height + 60 : height);
  if (height < targetHeight) await mineTo(DECOY, targetHeight - height);
  const tip = await nodeHeight();
  const start = Date.now();
  while (Date.now() - start < 180000) {
    const current = (await snapshot()).slice(0, 2);
    if (current.every((wallet) => wallet.height + 2 >= tip && BigInt(wallet.amount) > 2_000_000_000_000n)) {
      console.log("two funded routes ready", JSON.stringify(current));
      return current;
    }
    await Bun.sleep(1000);
  }
  throw new Error("wallets did not scan to funded balances");
}

if (import.meta.main) {
  const wallets = await ensureTwoFundedRoutes();
  await Bun.write("testdata/send-route-ready.json", JSON.stringify(wallets, null, 2));
}
