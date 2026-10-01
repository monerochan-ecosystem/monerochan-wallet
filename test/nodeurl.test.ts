import { expect, test } from "bun:test";
import {
  canStoreNodeUrl,
  chooseNodeUrl,
  findNodeInfo,
  findWorkingNode,
  nodeUrlCandidates,
  nodeUrlToSave,
} from "../wallet/sidebar/segments/nodeUrlSave";

const LOCAL = "http://127.0.0.1:18081";
const REMOTE = "https://node.monero.fail";

function probe(works: Set<string>) {
  const tried: string[] = [];
  return {
    tried,
    run(url: string) {
      tried.push(url);
      if (!works.has(url)) return Promise.reject(new Error("down"));
      return Promise.resolve({ height: 1 });
    },
  };
}

test("candidates try the typed url, then https, then http", () => {
  expect(nodeUrlCandidates("127.0.0.1:18081")).toEqual([
    "127.0.0.1:18081",
    "https://127.0.0.1:18081",
    "http://127.0.0.1:18081",
  ]);
  expect(nodeUrlCandidates("node.monero.fail")).toEqual([
    "node.monero.fail",
    "https://node.monero.fail",
    "http://node.monero.fail",
  ]);
  expect(nodeUrlCandidates("http://node.monero.fail")).toEqual([
    "http://node.monero.fail",
    "https://node.monero.fail",
  ]);
  expect(nodeUrlCandidates("https://127.0.0.1:18081")).toEqual([
    "https://127.0.0.1:18081",
    "http://127.0.0.1:18081",
  ]);
});

test("a working typed url is saved and later forms are not tried", async () => {
  const local = probe(new Set([LOCAL]));
  expect(await chooseNodeUrl(LOCAL, local.run)).toBe(LOCAL);
  expect(local.tried).toEqual([LOCAL]);

  const remote = probe(new Set([REMOTE]));
  expect(await chooseNodeUrl(REMOTE, remote.run)).toBe(REMOTE);
  expect(remote.tried).toEqual([REMOTE]);
});

test("local node without a scheme uses http after https fails", async () => {
  const p = probe(new Set([LOCAL]));
  expect(await chooseNodeUrl("127.0.0.1:18081", p.run)).toBe(LOCAL);
  expect(p.tried).toEqual([
    "127.0.0.1:18081",
    "https://127.0.0.1:18081",
    LOCAL,
  ]);
});

test("https on the local node falls back to http", async () => {
  const p = probe(new Set([LOCAL]));
  expect(await chooseNodeUrl("https://127.0.0.1:18081", p.run)).toBe(LOCAL);
  expect(p.tried).toEqual(["https://127.0.0.1:18081", LOCAL]);
});

test("node.monero.fail without a scheme uses https", async () => {
  const p = probe(new Set([REMOTE]));
  expect(await chooseNodeUrl("node.monero.fail", p.run)).toBe(REMOTE);
  expect(p.tried).toEqual(["node.monero.fail", REMOTE]);
});

test("http node.monero.fail is replaced when only https answers", async () => {
  const p = probe(new Set([REMOTE]));
  expect(await chooseNodeUrl("http://node.monero.fail", p.run)).toBe(REMOTE);
  expect(p.tried).toEqual(["http://node.monero.fail", REMOTE]);
});

test("a valid url that does not answer is saved as typed", async () => {
  const p = probe(new Set());
  const typed = "http://127.0.0.1:1";
  expect(await chooseNodeUrl(typed, p.run)).toBe(typed);
  expect(canStoreNodeUrl(typed)).toBe(true);
  expect(p.tried).toEqual([typed, "https://127.0.0.1:1"]);
});

test("a value that is not an http url is not stored", async () => {
  const p = probe(new Set());
  const typed = "not-a-real-node.invalid";
  expect(await chooseNodeUrl(typed, p.run)).toBe(typed);
  expect(canStoreNodeUrl(typed)).toBe(false);
  expect(canStoreNodeUrl("https://" + typed)).toBe(true);
});

test("findWorkingNode returns the working url and the probe info", async () => {
  const p = probe(new Set([LOCAL]));
  const found = await findWorkingNode("127.0.0.1:18081", p.run);
  expect(found?.url).toBe(LOCAL);
  expect(found?.info).toEqual({ height: 1 });
  expect(p.tried).toEqual([
    "127.0.0.1:18081",
    "https://127.0.0.1:18081",
    LOCAL,
  ]);
  const miss = probe(new Set());
  expect(await findWorkingNode("127.0.0.1:18081", miss.run)).toBeNull();
});

test("live local node", async () => {
  expect(await nodeUrlToSave("127.0.0.1:18081")).toBe(LOCAL);
  expect(await nodeUrlToSave(LOCAL)).toBe(LOCAL);
  expect(await nodeUrlToSave("https://127.0.0.1:18081")).toBe(LOCAL);
  const info = await findNodeInfo("127.0.0.1:18081");
  expect(info?.url).toBe(LOCAL);
  expect(info?.info.height).toBeGreaterThan(0);
});

test("live node.monero.fail", async () => {
  expect(await nodeUrlToSave("node.monero.fail")).toBe(REMOTE);
  expect(await nodeUrlToSave(REMOTE)).toBe(REMOTE);
  expect(await nodeUrlToSave("http://node.monero.fail")).toBe(REMOTE);
  const info = await findNodeInfo("node.monero.fail");
  expect(info?.url).toBe(REMOTE);
  expect(info?.info.height).toBeGreaterThan(0);
});
