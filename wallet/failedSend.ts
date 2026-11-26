import { canReleaseInputs, isInputLocked, type ScanCache } from "@spirobel/monero-wallet-api/unpacked";

export const doubleSpendWarning = "A failed reply does not prove that a transaction was rejected. A new spend of the same input uses the same key image. An observer who sees both transactions can compare their rings. Different decoys can narrow or identify the real input. Your own node removes a remote RPC observer, but does not remove this risk if both transactions reach peers.";

export function sendFailureMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error ?? "");
  if (/message (?:channel|port) closed|listener indicated|receiving end does not exist|could not establish connection|background did not/i.test(message))
    return "The wallet connection was interrupted. Reopen the wallet and check this transaction.";
  if (/not enough funds|insufficient funds/i.test(message)) return "Not enough unlocked funds.";
  if (/fee.too.low/i.test(message)) return "The transaction fee is too low.";
  if (/double.?spend|inputs? already spent/i.test(message)) return "The node reports that these funds are already spent. Check this transaction before paying again.";
  if (/scanner is not running|require the coordinator/i.test(message)) return "The wallet is not ready. Reconnect to a node and try again.";
  if (/failed to fetch|fetch failed|network|timeout|timed out|offline|aborted/i.test(message))
    return "The node did not reply. The transaction may still have been sent.";
  if (/rpc returned error|transaction rejected/i.test(message)) return "The node rejected this transaction. Check the details before trying again.";
  return "The wallet could not complete this request. Check this transaction before trying again.";
}

export function failedSendState(cache: ScanCache, index: number) {
  const row = cache.tx_logs?.[index];
  const locked = !!row?.inputs_index.some((id) => cache.pending_spent_utxos?.[id] === index &&
    !cache.outputs[id]?.spent_in_tx_hash && isInputLocked(cache, id));
  return { locked };
}

export function inputRecovery(cache: ScanCache, id: string) {
  const output = cache.outputs[id];
  if (!output || output.spent_in_tx_hash || typeof output.burned === "number") return;
  if (isInputLocked(cache, id)) {
    const index = cache.pending_spent_utxos?.[id];
    const row = index === undefined ? undefined : cache.tx_logs?.[index];
    if (index !== undefined && row?.inputs_index?.includes(id) && canReleaseInputs(cache, index)) return { index, locked: true };
    return;
  }
  const index = cache.tx_logs?.findLastIndex((row) =>
    row?.inputs_unlocked === true && row.inputs_index?.includes(id),
  ) ?? -1;
  if (index >= 0) return { index, locked: false };
}
