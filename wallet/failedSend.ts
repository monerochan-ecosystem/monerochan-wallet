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
