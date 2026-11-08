import { expect, test } from "bun:test";
import {
  matchesWallet,
  walletFilterOptions,
  type LogWallet,
} from "../wallet/actionlog/page";

const wallets: LogWallet[] = [
  { primary_address: "wallet-a", wallet_route: "main/shop.example/single/0" },
  { primary_address: "wallet-b", wallet_route: "main/shop.example/single/1" },
  { primary_address: "wallet-c", wallet_route: "main/other.example/single/0" },
  { primary_address: "wallet-d", wallet_route: "other/shop.example/single/0" },
];

test("all wallets includes calls with no source wallet", () => {
  expect(matchesWallet({ toolId: "001" }, "", wallets)).toBe(true);
  expect(matchesWallet({ toolId: "002" }, "", wallets)).toBe(true);
});

test("payments match the saved source wallet", () => {
  const row = { toolId: "001" as const, wallet_to_send_from_pa: "wallet-a" };
  expect(matchesWallet(row, "wallet-a", wallets)).toBe(true);
  expect(matchesWallet(row, "wallet-b", wallets)).toBe(false);
});

test("payments with no source are not assigned to the selected wallet", () => {
  expect(matchesWallet({ toolId: "001" }, "wallet-a", wallets)).toBe(false);
  expect(matchesWallet({ toolId: "001", context_domain: "shop.example" }, "wallet-a", wallets)).toBe(false);
});

test("the linked transaction can identify a payment wallet", () => {
  expect(matchesWallet({ toolId: "001" }, "wallet-a", wallets, "wallet-a")).toBe(true);
  expect(matchesWallet({ toolId: "001" }, "wallet-b", wallets, "wallet-a")).toBe(false);
});

test("the saved source takes priority over a linked transaction", () => {
  const row = { toolId: "001" as const, wallet_to_send_from_pa: "wallet-a" };
  expect(matchesWallet(row, "wallet-a", wallets, "wallet-b")).toBe(true);
  expect(matchesWallet(row, "wallet-b", wallets, "wallet-b")).toBe(false);
});

test("share calls match both the page domain and wallet slot", () => {
  const row = { toolId: "002" as const, context_domain: "shop.example", wallet_slot: 0 };
  expect(matchesWallet(row, "wallet-a", wallets)).toBe(true);
  expect(matchesWallet(row, "wallet-b", wallets)).toBe(false);
  expect(matchesWallet(row, "wallet-c", wallets)).toBe(false);
  expect(matchesWallet(row, "wallet-d", wallets)).toBe(false);
  expect(matchesWallet({ ...row, wallet_slot: 1 }, "wallet-b", wallets)).toBe(true);
});

test("share calls use slot zero when the slot is not stored", () => {
  expect(matchesWallet({ toolId: "002", context_domain: "shop.example" }, "wallet-a", wallets)).toBe(true);
});

test("share calls with no matching route remain under all wallets", () => {
  for (const context_domain of [undefined, "", "unknown.example", "not a domain"]) {
    const row = { toolId: "002" as const, context_domain, wallet_slot: 0 };
    expect(matchesWallet(row, "wallet-a", wallets)).toBe(false);
    expect(matchesWallet(row, "", wallets)).toBe(true);
  }
});

test("wallet options include configured routes with no calls and remove duplicates", () => {
  const options = walletFilterOptions([...wallets, wallets[0]!]);
  expect(options.map((option) => option.value)).toEqual([
    "", "wallet-a", "wallet-b", "wallet-c", "wallet-d",
  ]);
  expect(options.map((option) => option.label)).toEqual([
    "all wallets", ...wallets.map((wallet) => wallet.wallet_route!),
  ]);
});

test("wallet options show only the route, not the wallet name or address", () => {
  const address = "123456789012345678901234567890";
  const options = walletFilterOptions([
    { primary_address: address, wallet_name: "test wallet", wallet_route: "main/shop.example/single/0" },
  ]);
  expect(options[1]).toEqual({ value: address, label: "main/shop.example/single/0" });
});

test("wallets with no route do not create address-only options", () => {
  const options = walletFilterOptions([
    ...wallets,
    { primary_address: "old-wallet" },
    { primary_address: "empty-route", wallet_route: "" },
    { primary_address: "blank-route", wallet_route: "   " },
  ]);
  expect(options).toEqual(walletFilterOptions(wallets));
});

test("all wallets remains available when there are no current routes", () => {
  expect(walletFilterOptions([])).toEqual([{ value: "", label: "all wallets" }]);
  expect(walletFilterOptions([{ primary_address: "old-wallet" }])).toEqual([
    { value: "", label: "all wallets" },
  ]);
});
