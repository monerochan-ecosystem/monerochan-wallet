import { expect, spyOn, test } from "bun:test";
import * as walletApi from "@spirobel/monero-wallet-api/unpacked";

// a spend call fills and locks the send fields. when it ends outside the plate, the fields are empty and editable.
test("a spend call that ends outside the plate leaves empty, editable send fields", async () => {
  await import("../wallet/sidebar/init");
  const { sendPlateContent } = await import("../wallet/sidebar/segments/send");
  const parse = spyOn(walletApi, "parseAddress").mockResolvedValue({ address: "payee" } as walletApi.ParsedAddress);
  const call = (invocationId: string, amount: string) => ({ invocationId, toolId: "001", amount, address: "payee", valid: "valid" });
  const ended = call("outside", "0.1");
  let active: unknown[] = [ended];
  const original = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", { configurable: true, value: {
    unlocked: true,
    walletRouteParams: { identity: "main", domain: "no_domain", wallet_type: "single", wallet_slot: "0" },
    wallets: {
      wallets: [{ primary_address: "payer", failed_txs: [], tx_logs: [], spendableInputs: () => [] }],
      connectionStatusOpened: { isConnected: true },
      actionLogOpened: { getActiveByPermissions: () => active, invocations: () => [ended] },
    },
  } });
  // the backend render drops handlers and false attributes. true becomes disabled="".
  const field = (id: string) => sendPlateContent().renderBackend().match(new RegExp(`<input[^>]*id="${id}"[^>]*>`))?.[0] ?? "";
  try {
    expect(field("amountInput")).toContain("disabled");
    expect(field("addressInput")).toContain("disabled");
    active = []; // dismissed outside the plate
    const amount = field("amountInput");
    const address = field("addressInput");
    expect(amount).not.toContain("disabled");
    expect(address).not.toContain("disabled");
    expect(amount).toContain('value=""');
    expect(address).toContain('value=""');
    // the legacy rules stay: address-only and zero amounts leave the amount editable. the address stays locked.
    for (const [id, value] of [["address-only", ""], ["zero", "0"]] as const) {
      active = [call(id, value)];
      expect(field("amountInput")).not.toContain("disabled");
      expect(field("addressInput")).toContain("disabled");
    }
  } finally {
    parse.mockRestore();
    if (original) Object.defineProperty(globalThis, "window", original);
    else Reflect.deleteProperty(globalThis, "window");
  }
});
