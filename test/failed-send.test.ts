import { expect, test } from "bun:test";
import * as failure from "../wallet/failedSend";

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
