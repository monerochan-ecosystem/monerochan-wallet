import { expect, test } from "bun:test";
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

test("the warning does not promise that a local node hides conflicting transactions", () => {
  expect(failure.doubleSpendWarning).toContain("key image");
  expect(failure.doubleSpendWarning).toContain("real input");
  expect(failure.doubleSpendWarning).toContain("peers");
});
