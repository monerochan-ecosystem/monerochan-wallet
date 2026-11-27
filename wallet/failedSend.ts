import { canReleaseInputs, isInputLocked, txFailed, type InvocationState, type ScanCache, type TxLog } from "@spirobel/monero-wallet-api/unpacked";

export const doubleSpendWarning = "A failed reply does not prove that a transaction was rejected. A new spend of the same input uses the same key image. An observer who sees both transactions can compare their rings. Different decoys can narrow or identify the real input. Your own node removes a remote RPC observer, but does not remove this risk if both transactions reach peers.";

export function sendStatus(row: Pick<TxLog, "broadcast_accepted" | "last_broadcast_at" | "sendResult" | "error">) {
  if (row.broadcast_accepted || row.sendResult?.status === "OK")
    return { message: "successfully sent transaction", style: "success" };
  if (row.error || row.sendResult)
    return { message: row.error?.includes("not enough funds") ? "not enough funds" : "failed to send transaction", style: "error" };
  return { message: row.last_broadcast_at == null ? "preparing transaction" : "awaiting node reply", style: "neutral" };
}

export function sendFailureMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error ?? "");
  if (/message (?:channel|port) closed|listener indicated|receiving end does not exist|could not establish connection|background did not/i.test(message))
    return "The wallet connection was interrupted. Reopen the wallet and check this transaction.";
  if (/not enough funds|insufficient funds/i.test(message)) return "Not enough unlocked funds.";
  if (message.includes("self spend inputs unavailable")) return "The original inputs are no longer available for Self Spend.";
  if (/fee.too.low/i.test(message)) return "The transaction fee is too low.";
  if (/double.?spend|inputs? already spent/i.test(message)) return "The node reports that these funds are already spent. Check this transaction before paying again.";
  if (/scanner is not running|require the coordinator/i.test(message)) return "The wallet is not ready. Reconnect to a node and try again.";
  if (/failed to fetch|fetch failed|network|timeout|timed out|offline|aborted/i.test(message))
    return "The node did not reply. The transaction may still have been sent.";
  if (/rpc returned error|transaction rejected/i.test(message)) return "The node rejected this transaction. Check the details before trying again.";
  return "The wallet could not complete this request. Check this transaction before trying again.";
}

export function failedSendState(cache: ScanCache, index: number, events: readonly object[]) {
  const row = cache.tx_logs?.[index];
  const locked = !!row?.inputs_index.some((id) => cache.pending_spent_utxos?.[id] === index &&
    !cache.outputs[id]?.spent_in_tx_hash && isInputLocked(cache, id));
  const handover = ([...events].reverse().find((event) => "handover" in event && event.handover) as { handover?: { ok?: boolean } } | undefined)?.handover;
  const merchant = !handover ? "" : handover.ok
    ? "The merchant node accepted this transaction."
    : "The merchant node may have accepted this transaction.";
  return { locked, merchant };
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

export function selfSpendInputs(cache: ScanCache, index: number): string[] {
  const row = cache.tx_logs?.[index];
  if (!row || !txFailed(row)) return [];
  const inputs = row.inputs_index ?? [];
  return inputs.every((id) => {
    const output = cache.outputs[id];
    return output && !output.spent_in_tx_hash && typeof output.burned !== "number" &&
      (cache.pending_spent_utxos?.[id] === index || !isInputLocked(cache, id));
  }) ? inputs : [];
}

export function handoverRetryHint(
  invocation: Pick<InvocationState, "toolId" | "valid" | "lastType" | "invocationId" | "wallet_to_send_from_pa" | "events"> | null | undefined,
  wallets: readonly { primary_address: string; tx_logs: readonly Pick<TxLog, "invocationId" | "signed_tx">[] }[],
): string {
  if (invocation?.toolId !== "001" || invocation.valid !== "valid" || invocation.lastType !== "execute_result") return "";
  const result = invocation.events.findLast((event) => event.type === "execute_result");
  if (result?.ok !== false) return "";
  const validation = invocation.events.findLast((event) => event.type === "validate_result");
  const execution = invocation.events.find((event) => event.type === "execute_start");
  if (!execution?.address || validation?.address !== execution.address ||
    typeof validation.successUrl !== "string" || typeof validation.handoverUrl !== "string") return "";
  const payer = wallets.find((wallet) => wallet.primary_address === invocation.wallet_to_send_from_pa);
  if (!payer?.tx_logs.find((row) => row.invocationId === invocation.invocationId)?.signed_tx) return "";
  return result.sent === true ? "transaction sent, merchant receipt unconfirmed" : "merchant receipt unconfirmed";
}
