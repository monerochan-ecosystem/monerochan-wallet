import { get_info } from "@spirobel/monero-wallet-api";

export function nodeUrlCandidates(nodeUrl: string) {
  const candidates = [nodeUrl];
  if (!nodeUrl.startsWith("https://")) {
    candidates.push(
      nodeUrl.startsWith("http://")
        ? "https://" + nodeUrl.slice("http://".length)
        : "https://" + nodeUrl,
    );
  }
  if (!nodeUrl.startsWith("http://")) {
    candidates.push(
      nodeUrl.startsWith("https://")
        ? "http://" + nodeUrl.slice("https://".length)
        : "http://" + nodeUrl,
    );
  }
  return candidates;
}

export function canStoreNodeUrl(nodeUrl: string) {
  try {
    const parsed = new URL(nodeUrl);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

export async function findWorkingNode<T>(
  nodeUrl: string,
  probe: (url: string) => Promise<T>,
) {
  const tried = new Set<string>();
  for (const candidate of nodeUrlCandidates(nodeUrl)) {
    if (tried.has(candidate)) continue;
    tried.add(candidate);
    try {
      return { url: candidate, info: await probe(candidate) };
    } catch {
      // try the next form
    }
  }
  return null;
}

export async function chooseNodeUrl(
  nodeUrl: string,
  probe: (url: string) => Promise<unknown>,
) {
  const found = await findWorkingNode(nodeUrl, probe);
  return found ? found.url : nodeUrl;
}

function probeGetInfo(url: string) {
  return Promise.race([
    get_info(url),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("timeout")), 8000),
    ),
  ]);
}

export async function findNodeInfo(nodeUrl: string) {
  return findWorkingNode(nodeUrl, probeGetInfo);
}

export async function nodeUrlToSave(nodeUrl: string) {
  const found = await findNodeInfo(nodeUrl);
  return found ? found.url : nodeUrl;
}
