import { expect, spyOn, test } from "bun:test";
import * as walletApi from "@spirobel/monero-wallet-api/unpacked";
import * as failure from "../wallet/failedSend";

const now = 1_800_000_000_000;
function cache() { return { outputs: { "7": {} }, pending_spent_utxos: { "7": 0 }, tx_logs: [{ inputs_index: ["7"], error: "timeout", signed_tx: "same", last_broadcast_at: now }] } as any; }

test("internal message-channel errors have a plain explanation without claiming the payment failed", () => {
  const raw = "Error: A listener indicated an asynchronous response by returning true, but the message channel closed before a response was received";
  expect(failure.sendFailureMessage(raw)).toBe("The wallet connection was interrupted. Reopen the wallet and check this transaction.");
  expect(failure.sendFailureMessage(new Error("Could not establish connection. Receiving end does not exist."))).toBe(failure.sendFailureMessage(raw));
});
test("node and unknown errors do not expose internal exception text", () => {
  expect(failure.sendFailureMessage("TypeError: Failed to fetch")).toBe("The node did not reply. The transaction may still have been sent.");
  expect(failure.sendFailureMessage("not enough funds")).toBe("Not enough unlocked funds.");
  expect(failure.sendFailureMessage("unhandled internal error 491")).toBe("The wallet could not complete this request. Check this transaction before trying again.");
});

test("failed send holds its inputs until manual release", () => {
  const current = cache();
  current.tx_logs[0].last_broadcast_at = Date.now() - 600_000;
  expect(failure.failedSendState(current, 0).locked).toBe(true);
  current.tx_logs[0].inputs_unlocked = true;
  expect(failure.failedSendState(current, 0).locked).toBe(false);
});

test("manual unlock is not offered for inputs reserved by a newer transaction or seen spent", () => {
  const current = cache(); current.pending_spent_utxos["7"] = 1;
  expect(failure.failedSendState(current, 0).locked).toBe(false);
  current.pending_spent_utxos["7"] = 0; current.outputs["7"].spent_in_tx_hash = "mined";
  expect(failure.failedSendState(current, 0).locked).toBe(false);
});

test("input recovery follows the current reservation and keeps a link after release", () => {
  const current = cache();
  expect(failure.inputRecovery(current, "7")).toEqual({ index: 0, locked: true });

  current.tx_logs[0].inputs_unlocked = true;
  delete current.pending_spent_utxos["7"];
  expect(failure.inputRecovery(current, "7")).toEqual({ index: 0, locked: false });

  current.tx_logs.push({ inputs_index: ["7"], last_broadcast_at: null });
  current.pending_spent_utxos["7"] = 1;
  expect(failure.inputRecovery(current, "7")).toBeUndefined();

  current.tx_logs[1].signed_tx = "same";
  expect(failure.inputRecovery(current, "7")).toEqual({ index: 1, locked: true });
  current.tx_logs[1].broadcast_accepted = true;
  expect(failure.inputRecovery(current, "7")).toBeUndefined();
  delete current.tx_logs[1].broadcast_accepted;

  current.tx_logs[1].error = "send interrupted before broadcast";
  current.tx_logs[1].inputs_unlocked = false;
  expect(failure.inputRecovery(current, "7")).toEqual({ index: 1, locked: true });
  delete current.tx_logs[1].error;
  current.tx_logs[1].inputs_unlocked = true;
  expect(failure.inputRecovery(current, "7")).toEqual({ index: 1, locked: false });
  current.outputs["7"].spent_in_tx_hash = "mined";
  expect(failure.inputRecovery(current, "7")).toBeUndefined();
});

test("self spend prepares the whole input set or refuses the draft", () => {
  const current = cache();
  current.outputs["8"] = {};
  current.tx_logs[0].inputs_index.push("8");
  expect(failure.selfSpendInputs(current, 0)).toEqual(["7", "8"]);
  current.pending_spent_utxos["8"] = 1;
  expect(failure.selfSpendInputs(current, 0)).toEqual([]);
  delete current.pending_spent_utxos["8"];
  current.outputs["8"].spent_in_tx_hash = "mined";
  expect(failure.selfSpendInputs(current, 0)).toEqual([]);
});

test("self spend waits for release and sweeps only the original inputs to the wallet", async () => {
  await import("../wallet/sidebar/init");
  const { coinControlSendReady, forceStandardMode, prepareSelfSpend, submitCoinControl } =
    await import("../wallet/sidebar/segments/coincontrol");
  const current = cache();
  current.outputs["7"] = { index_on_blockchain: 7, amount: 10n };
  current.outputs["8"] = { index_on_blockchain: 8, amount: 20n };
  const address = "wallet-primary";
  const wallet = {
    primary_address: address,
    cache: current,
    getFeeEstimate: async () => ({ fees: [0] }),
    spendableInputs: () => Object.entries(current.outputs)
      .filter(([id]) => !walletApi.isInputLocked(current, id))
      .map(([, output]) => output),
  } as unknown as walletApi.ScanCacheOpened;
  const sweep = spyOn({ send: async (_params: unknown) => {} }, "send");
  const parse = spyOn(walletApi, "parseAddress").mockResolvedValue({ address } as walletApi.ParsedAddress);
  const original = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", { configurable: true, value: {
    unlocked: true,
    walletRouteParams: { identity: "main", domain: "no_domain", wallet_type: "single", wallet_slot: "0" },
    wallets: { wallets: [wallet], connectionStatusOpened: { isConnected: true }, sweepSignSend: sweep },
  } });
  try {
    expect(prepareSelfSpend(wallet, 0)).toBe(true);
    await Bun.sleep(0);
    expect(coinControlSendReady(false)).toBe(false);
    await submitCoinControl(() => {}, async () => {}, null);
    expect(sweep).not.toHaveBeenCalled();
    current.tx_logs[0].inputs_unlocked = true;
    expect(coinControlSendReady(false)).toBe(true);
    await submitCoinControl(() => {}, async () => {}, null);
    expect(sweep).toHaveBeenCalledTimes(1);
    expect(sweep).toHaveBeenCalledWith({ primary_address: address, address, input_indexes: ["7"] });
  } finally {
    forceStandardMode();
    parse.mockRestore();
    if (original) Object.defineProperty(globalThis, "window", original);
    else Reflect.deleteProperty(globalThis, "window");
  }
});
test("the warning does not promise that a local node hides conflicting transactions", () => {
  expect(failure.doubleSpendWarning).toContain("key image");
  expect(failure.doubleSpendWarning).toContain("real input");
  expect(failure.doubleSpendWarning).toContain("peers");
});
