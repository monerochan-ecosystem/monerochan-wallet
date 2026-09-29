// Download monerod into testdata/moneronode when the file is absent.
// Same checks as monero-wallet-api typescript/tests/acceptance/reorg_handling.test.ts.
// The binary stays in this repo. Do not use the other repo copy.
import { mkdir, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const MONERONODE_DIR = join(ROOT, "testdata", "moneronode");
const MONEROD_PATH = join(MONERONODE_DIR, "monerod");

async function setupMoneroNode(): Promise<void> {
  if (await Bun.file(MONEROD_PATH).exists()) {
    console.log("monerod already present");
    return;
  }

  await mkdir(MONERONODE_DIR, { recursive: true });

  console.log("Downloading hashes.txt...");
  const hashesResp = await fetch("https://getmonero.org/downloads/hashes.txt");
  if (!hashesResp.ok)
    throw new Error(`Failed to download hashes.txt: ${hashesResp.statusText}`);
  const hashesText = await hashesResp.text();
  await Bun.write(join(MONERONODE_DIR, "hashes.txt"), hashesText);

  try {
    const gpgKeyResp = await fetch(
      "https://raw.githubusercontent.com/monero-project/monero/master/utils/gpg_keys/binaryfate.asc",
    );
    if (gpgKeyResp.ok) {
      await Bun.write(join(MONERONODE_DIR, "binaryfate.asc"), gpgKeyResp);
      const imp = Bun.spawn(
        ["gpg", "--import", join(MONERONODE_DIR, "binaryfate.asc")],
        { stdout: "pipe", stderr: "pipe" },
      );
      await imp.exited;
      const ver = Bun.spawn(
        ["gpg", "--verify", join(MONERONODE_DIR, "hashes.txt")],
        { stdout: "pipe", stderr: "pipe" },
      );
      await ver.exited;
    }
  } catch {
    console.warn("GPG verification unavailable, skipping");
  }

  console.log("Downloading monero CLI binaries...");
  const binResp = await fetch("https://downloads.getmonero.org/cli/linux64");
  if (!binResp.ok) throw new Error(`Download failed: ${binResp.statusText}`);

  const disposition = binResp.headers.get("content-disposition");
  const tarballName =
    disposition?.match(/filename="?(.+?)"?$/)?.[1] ??
    binResp.url.split("/").pop() ??
    "monero-linux.tar.bz2";
  const tarballPath = join(MONERONODE_DIR, tarballName);

  const contentLength = binResp.headers.get("content-length");
  const total = contentLength ? Number(contentLength) : 0;
  let downloaded = 0;
  let lastLog = 0;
  if (!binResp.body) throw new Error("download response has no body");
  const reader = binResp.body.getReader();
  const writer = Bun.file(tarballPath).writer();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    downloaded += value.length;
    writer.write(value);
    if (total && Date.now() - lastLog > 2000) {
      lastLog = Date.now();
      const pct = ((downloaded / total) * 100).toFixed(1);
      console.log(
        `  ${(downloaded / 1024 / 1024).toFixed(1)}MB / ${(total / 1024 / 1024).toFixed(1)}MB (${pct}%)`,
      );
    } else if (!total && Date.now() - lastLog > 5000) {
      lastLog = Date.now();
      console.log(`  ${(downloaded / 1024 / 1024).toFixed(1)}MB downloaded`);
    }
  }
  await writer.end();

  const tarballData = await Bun.file(tarballPath).arrayBuffer();
  const hashBuf = await crypto.subtle.digest("SHA-256", tarballData);
  const hashHex = Array.from(new Uint8Array(hashBuf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  const hashLines = hashesText.split("\n").filter((l) => l.trim().length > 0);
  if (!hashLines.some((l) => l.startsWith(hashHex))) {
    await Bun.spawn(["rm", tarballPath]).exited;
    throw new Error(
      "sha256 verification failed, downloaded binary may be tampered or corrupted",
    );
  }

  console.log("SHA256 verification passed. Extracting...");
  const extractDir = join(MONERONODE_DIR, "extracted");
  await mkdir(extractDir, { recursive: true });
  const tar = Bun.spawn(["tar", "-xf", tarballPath, "-C", extractDir], {
    stdout: "pipe",
    stderr: "pipe",
  });
  if ((await tar.exited) !== 0) {
    const err = await new Response(tar.stderr).text();
    throw new Error(`Extraction failed: ${err}`);
  }

  const entries = await readdir(extractDir);
  const subdir = entries.find((e) => e.startsWith("monero-"));
  if (!subdir)
    throw new Error("Unexpected tarball structure: no monero- directory found");
  await Bun.spawn(["mv", join(extractDir, subdir, "monerod"), MONEROD_PATH]).exited;

  await Bun.spawn(["rm", "-rf", extractDir]).exited;
  await Bun.spawn(["rm", tarballPath]).exited;
  console.log("monerod saved");
}

await setupMoneroNode();
