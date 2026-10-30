import { expect, test } from "bun:test";
import type { InvocationState } from "@spirobel/monero-wallet-api/unpacked";
import { toolInfo } from "../wallet/sidebar/segments/toolInfo";

test("bad stored payment links do not break the info plate", () => {
  for (const link of ["not a url", "https://%", "%", ""]) {
    expect(() => toolInfo({ link, found_in: "link" } as InvocationState)).not.toThrow();
  }
});

// the plate must use the same legacy rule as the parser, not its own.
function labels(t: Parameters<typeof toolInfo>[0]): string {
  const out = toolInfo(t) as unknown as { stringLiterals: string[]; values: unknown[] };
  return JSON.stringify([...out.stringLiterals, ...out.values]);
}

const ADDRESS =
  "47cYSGSjzWPX3KFEN9PaxT5zpWKgRtx568bazbGzt57ffBbUAQevjMk19sfZCrMB1RWHNJLbz1eKU63B77HpHwUVA6JGudr";

test("a legacy uri wrapped in any parameter is labelled legacy", () => {
  for (const wrapped of [
    `https://search.brave.com/search?q=${encodeURIComponent(`monero:${ADDRESS}?tx_amount=1`)}`,
    `https://example.com/r?target=${encodeURIComponent(`monero:${ADDRESS}`)}`,
    `monero:${ADDRESS}?tx_amount=1`,
  ]) {
    expect(labels({ link: wrapped, found_in: "link" } as InvocationState)).toContain(
      "destination (legacy):",
    );
  }
});

test("a normal payment link keeps the plain destination label", () => {
  const modern = `https://shop.example.com/#monerochan001_amount_0.1_address_${ADDRESS}`;
  const out = labels({ link: modern, found_in: "link" } as InvocationState);
  expect(out).toContain("destination:");
  expect(out).not.toContain("destination (legacy):");
});

test("bad stored link text does not break the info plate", () => {
  expect(() => toolInfo({
    link: "https://example.com/", linkText: "not a url", found_in: "linkText",
  } as InvocationState)).not.toThrow();
});
