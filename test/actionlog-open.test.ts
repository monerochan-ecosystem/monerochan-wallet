import { afterAll, beforeAll, beforeEach, expect, test } from "bun:test";
import {
  actionLogPageUrl,
  openActionLogPage,
  toggleActionLogPage,
} from "../wallet/actionlog/open";

const base = "chrome-extension://test-wallet/actionlog.html";
const originalBrowser = Object.getOwnPropertyDescriptor(globalThis, "browser");
const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
let tabs: { id: number; url: string }[] = [];
let opened: string[] = [];
let updated: (string | undefined)[] = [];

beforeAll(() => {
  Object.defineProperty(globalThis, "browser", {
    configurable: true,
    value: {
      runtime: { getURL: () => base },
      tabs: {
        query: async () => tabs,
        remove: async (ids: number[]) => {
          tabs = tabs.filter((tab) => !ids.includes(tab.id));
        },
        update: async (id: number, changes: { url?: string }) => {
          const tab = tabs.find((tab) => tab.id === id);
          if (tab && changes.url) tab.url = changes.url;
          updated.push(changes.url);
        },
      },
    },
  });
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      open: (url: string) => {
        opened.push(url);
        tabs.push({ id: opened.length, url });
      },
    },
  });
});

afterAll(() => {
  for (const [key, descriptor] of [
    ["browser", originalBrowser],
    ["window", originalWindow],
  ] as const) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  }
});

beforeEach(() => {
  tabs = [];
  opened = [];
  updated = [];
});

test("a new action log receives the selected wallet as its default", () => {
  const url = new URL(actionLogPageUrl(undefined, "wallet-a"));
  expect(url.searchParams.get("wallet")).toBe("wallet-a");
  expect(url.hash).toBe("#/");
  expect(new URL(actionLogPageUrl()).search).toBe("");
});

test("a new detail page receives the selected wallet", async () => {
  await openActionLogPage("call-1", "wallet-b");
  const url = new URL(opened[0]!);
  expect(url.searchParams.get("wallet")).toBe("wallet-b");
  expect(url.hash).toBe("#/invo/call-1");
});

test("visiting an open log changes only the route and keeps the page state", async () => {
  tabs = [{ id: 1, url: `${base}?wallet=wallet-a#/` }];
  await openActionLogPage("call-2", "wallet-b");
  expect(opened).toEqual([]);
  expect(updated).toEqual([`${base}?wallet=wallet-a#/invo/call-2`]);
  await openActionLogPage(undefined, "wallet-c");
  expect(updated[1]).toBe(`${base}?wallet=wallet-a#/`);
});

test("visiting the current route does not reload the open page", async () => {
  for (const invocationId of [undefined, "call-1"]) {
    const url = actionLogPageUrl(invocationId, "wallet-a");
    tabs = [{ id: 1, url }];
    await openActionLogPage(invocationId, "wallet-b");
    expect(updated.at(-1)).toBeUndefined();
    expect(tabs[0]?.url).toBe(url);
    expect(opened).toEqual([]);
  }
});

test("closing and reopening the log uses the wallet selected at the new open", async () => {
  await toggleActionLogPage("wallet-a");
  expect(new URL(opened[0]!).searchParams.get("wallet")).toBe("wallet-a");
  await toggleActionLogPage("wallet-b");
  expect(tabs).toEqual([]);
  await toggleActionLogPage("wallet-b");
  expect(new URL(opened[1]!).searchParams.get("wallet")).toBe("wallet-b");
});
