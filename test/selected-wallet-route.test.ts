import { expect, test } from "bun:test";
import {
  chooseSelectedWalletRoute,
  SelectedWalletRouteStore,
} from "../wallet/sidebar/init";

// selection lives in ScanSettings.json through the existing lib file helpers
// inject read and write functions so these tests do not change wallet files
const first = "main/no_domain/single/0";
const second = "main/shop.example/single/1";
const wallets = [{ wallet_route: first }, { wallet_route: second }];

function selectionStore(initial = "") {
  let selected = initial;
  const writes: string[] = [];
  return {
    writes,
    read: async () => selected,
    write: async (route: string) => {
      selected = route;
      writes.push(route);
    },
  };
}

test("a saved route is restored instead of the first wallet", () => {
  expect(chooseSelectedWalletRoute(second, wallets)).toBe(second);
  expect(chooseSelectedWalletRoute("/" + second + "\n", wallets)).toBe(second);
});

test("missing, invalid, and removed routes fall back to the first current route", () => {
  for (const saved of ["", "not a route", "onboarding", "main/removed.example/single/3"]) {
    expect(chooseSelectedWalletRoute(saved, wallets)).toBe(first);
  }
  expect(chooseSelectedWalletRoute(second, [{ wallet_route: first }])).toBe(first);
});

test("fallback skips wallets without a valid route", () => {
  expect(chooseSelectedWalletRoute("", [{}, { wallet_route: "bad" }, ...wallets])).toBe(first);
  expect(chooseSelectedWalletRoute("", [])).toBe(first);
});

test("closing and reopening the store restores the last saved route", async () => {
  const store = selectionStore();
  const open = new SelectedWalletRouteStore(store.read, store.write);
  expect(await open.restore(wallets)).toBe(first);
  await open.save("/" + first, wallets);
  await open.save("/" + second, wallets);
  const reopened = new SelectedWalletRouteStore(store.read, store.write);
  expect(await reopened.restore(wallets)).toBe(second);
  expect(await store.read()).toBe(second);
});

test("restoring an existing route does not write it again", async () => {
  const store = selectionStore(second);
  const selected = new SelectedWalletRouteStore(store.read, store.write);
  expect(await selected.restore(wallets)).toBe(second);
  await selected.save("/" + second, wallets);
  await selected.save(second, wallets);
  expect(store.writes).toEqual([]);
});

test("route changes are written once, without a render-loop write", async () => {
  const store = selectionStore(first);
  const selected = new SelectedWalletRouteStore(store.read, store.write);
  await selected.restore(wallets);
  await Promise.all([
    selected.save(second, wallets),
    selected.save(second, wallets),
    selected.save(first, wallets),
  ]);
  expect(store.writes).toEqual([second, first]);
});

test("onboarding and routes that do not exist are not saved", async () => {
  const store = selectionStore(first);
  const selected = new SelectedWalletRouteStore(store.read, store.write);
  for (const route of ["/onboarding", "", "not a route", "main/removed.example/single/3"]) {
    await selected.save(route, wallets);
  }
  expect(store.writes).toEqual([]);
});

test("a settings read failure uses and saves the first current route", async () => {
  const writes: string[] = [];
  const selected = new SelectedWalletRouteStore(
    async () => { throw new Error("settings read failed"); },
    async (route) => { writes.push(route); },
  );
  const route = await selected.restore(wallets);
  expect(route).toBe(first);
  await selected.save(route, wallets);
  expect(writes).toEqual([first]);
});

test("a removed saved route is replaced by the fallback route", async () => {
  const store = selectionStore(second);
  const selected = new SelectedWalletRouteStore(store.read, store.write);
  const current = [{ wallet_route: first }];
  const route = await selected.restore(current);
  await selected.save(route, current);
  expect(await store.read()).toBe(first);
});

test("a failed write can be retried", async () => {
  let attempts = 0;
  const selected = new SelectedWalletRouteStore(async () => first, async () => {
    if (++attempts === 1) throw new Error("settings write failed");
  });
  await selected.restore(wallets);
  await expect(selected.save(second, wallets)).rejects.toThrow("settings write failed");
  await selected.save(second, wallets);
  expect(attempts).toBe(2);
});
