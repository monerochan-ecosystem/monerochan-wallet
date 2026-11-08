import { expect, test } from "bun:test";
import type { FoundTransaction, TxLog } from "@spirobel/monero-wallet-api/unpacked";
import {
  MONERO_BLOCK_TIME_SECONDS,
  confirmationChainHeight,
  confirmationEta,
  formatConfirmationEta,
  minedSpendHeight,
  pendingTransactionEta,
  txLogConfirmationEta,
} from "../wallet/sidebar/segments/toolInfo";

const accepted: NonNullable<TxLog["sendResult"]> = {
  status: "OK",
  double_spend: false,
  fee_too_low: false,
  invalid_input: false,
  invalid_output: false,
  low_mixin: false,
  not_relayed: false,
  overspend: false,
  reason: "",
  too_big: false,
  untrusted: false,
};
const log = { height: 100, sendResult: accepted };
const pending = {
  status: { status: "pending" as const, unlock_height: 110 },
  inputs: [],
  outputs: [],
  tx_hash: "sent-tx",
};

test("ETA uses the remaining heights and a fixed two-minute block time", () => {
  expect(MONERO_BLOCK_TIME_SECONDS).toBe(120);
  expect(confirmationEta(110, 103)).toEqual({
    currentHeight: 103,
    expectedHeight: 110,
    blocksLeft: 7,
    minutes: 14,
  });
  expect(confirmationEta(110, 104)?.minutes).toBe(12);
});

test("daemon height is a block count, not the top block index", () => {
  // Block 100 is included in a chain with height 101. Nine blocks remain.
  expect(confirmationEta(110, 101)?.blocksLeft).toBe(9);
  expect(confirmationEta(110, 109)?.minutes).toBe(2);
});

test("no ETA is shown at or after the expected height", () => {
  expect(confirmationEta(110, 110)).toBeNull();
  expect(confirmationEta(110, 200)).toBeNull();
});

test("missing or invalid heights do not produce an ETA", () => {
  for (const height of [undefined, NaN, Infinity, -1, 0, 1.5]) {
    expect(confirmationEta(110, height)).toBeNull();
    expect(confirmationEta(height, 103)).toBeNull();
  }
});

test("chain height uses the newest valid node height", () => {
  expect(confirmationChainHeight({ sync: { daemon_height: 0 }, last_packet: { daemon_height: 103 } })).toBe(103);
  expect(confirmationChainHeight({ sync: { daemon_height: 103 }, last_packet: { daemon_height: 104 } })).toBe(104);
  expect(confirmationChainHeight({ sync: { daemon_height: 105 }, last_packet: { daemon_height: 104 } })).toBe(105);
  expect(confirmationChainHeight({ sync: { daemon_height: NaN }, last_packet: { daemon_height: -1 } })).toBeUndefined();
  expect(confirmationChainHeight()).toBeUndefined();
});

test("history pending transactions use their actual unlock height", () => {
  expect(pendingTransactionEta(pending, 103)?.minutes).toBe(14);
});

test("normal confirmation estimates never exceed ten blocks", () => {
  expect(confirmationEta(110, 100)?.minutes).toBe(20);
  expect(confirmationEta(110, 99)).toBeNull();
  expect(confirmationEta(10101, 1)).toBeNull();
  expect(pendingTransactionEta(pending, 99)).toBeNull();
  expect(pendingTransactionEta({ ...pending, status: { status: "pending", unlock_height: 10101 } }, 1)).toBeNull();
});

test("only coinbase transactions get the sixty-block confirmation window", () => {
  const miner = {
    ...pending,
    status: { status: "pending" as const, unlock_height: 160 },
    outputs: [{ is_miner_tx: true }],
  };
  expect(pendingTransactionEta(miner, 110)?.minutes).toBe(100);
  expect(pendingTransactionEta(miner, 100)?.minutes).toBe(120);
  expect(pendingTransactionEta(miner, 99)).toBeNull();
  expect(pendingTransactionEta(miner, 1)).toBeNull();
  expect(pendingTransactionEta({ ...miner, outputs: [{ is_miner_tx: false }] }, 110)).toBeNull();
});

test("history does not show an ETA for transactions that are not pending", () => {
  for (const status of ["spendable", "spent", "reorged", "burnt", "prepending"] as const) {
    const state: FoundTransaction["status"] = { status };
    expect(pendingTransactionEta({ ...pending, status: state }, 103)).toBeNull();
  }
});

test("spent input heights identify a mined send without a change output", () => {
  const inputs = [{ spent_in_tx_hash: "sent-tx", spent_block_height: 100 }];
  const tx = { ...pending, status: { status: "pending" as const, unlock_height: 0 }, inputs };
  expect(minedSpendHeight(inputs, "sent-tx")).toBe(100);
  expect(pendingTransactionEta(tx, 103)).toEqual(confirmationEta(110, 103));
});

test("input lookup ignores other transactions and incomplete spend data", () => {
  expect(minedSpendHeight([
    { spent_in_tx_hash: "other-tx", spent_block_height: 80 },
    { spent_block_height: 90 },
    { spent_in_tx_hash: "sent-tx" },
    { spent_in_tx_hash: "sent-tx", spent_block_height: NaN },
  ], "sent-tx")).toBeUndefined();
  expect(pendingTransactionEta({ ...pending, status: { status: "pending", unlock_height: 0 } }, 103)).toBeNull();
});

test("a send in the pool assumes inclusion in the next block", () => {
  expect(txLogConfirmationEta(log, 101)).toEqual(confirmationEta(111, 101));
  expect(txLogConfirmationEta({ height: 100 }, 101)?.minutes).toBe(20);
});

test("pool estimates do not add an extra block at the broadcast height", () => {
  expect(txLogConfirmationEta(log, 100)).toEqual(confirmationEta(110, 100));
});

test("old chain heights do not produce a send ETA", () => {
  const oldLog = { ...log, height: 10090 };
  expect(txLogConfirmationEta(oldLog, 1)).toBeNull();
  expect(txLogConfirmationEta(oldLog, 1, 10091)).toBeNull();
  expect(txLogConfirmationEta(oldLog, 10090, 10091)).toBeNull();
  expect(txLogConfirmationEta(oldLog, 10092, 10091)?.minutes).toBe(18);
});

test("pool waiting time is not treated as confirmations", () => {
  const eta = txLogConfirmationEta(log, 150);
  expect(eta?.expectedHeight).toBe(160);
  expect(eta?.blocksLeft).toBe(10);
  expect(eta?.minutes).toBe(20);
});

test("a mined send uses the actual block height, not the broadcast height", () => {
  expect(txLogConfirmationEta(log, 105, 102)).toEqual(confirmationEta(112, 105));
  expect(txLogConfirmationEta(log, 112, 102)).toBeNull();
  expect(txLogConfirmationEta(log, 200, 102)).toBeNull();
});

test("failed and rejected sends do not get an ETA", () => {
  expect(txLogConfirmationEta({ ...log, error: "send failed" }, 103)).toBeNull();
  expect(txLogConfirmationEta({ ...log, sendResult: { ...accepted, status: "Failed" } }, 103)).toBeNull();
  expect(txLogConfirmationEta({ ...log, error: "send failed" }, 103, 100)).toBeNull();
});

test("send estimates require a valid current height", () => {
  for (const height of [undefined, NaN, Infinity, -1, 0, 1.5]) {
    expect(txLogConfirmationEta(log, height)).toBeNull();
    expect(txLogConfirmationEta(log, height, 100)).toBeNull();
  }
  expect(txLogConfirmationEta({ height: NaN }, 103)).toBeNull();
});

test("history and action log agree for the same mined transaction", () => {
  expect(pendingTransactionEta(pending, 103)).toEqual(txLogConfirmationEta(log, 103, 100));
});

test("ETA text shows the estimate, blocks left, and height calculation", () => {
  expect(formatConfirmationEta(confirmationEta(110, 103)!)).toBe(
    "~14 min (7 blocks left; height 103 to 110)",
  );
  expect(formatConfirmationEta(confirmationEta(110, 109)!)).toBe(
    "~2 min (1 block left; height 109 to 110)",
  );
});
