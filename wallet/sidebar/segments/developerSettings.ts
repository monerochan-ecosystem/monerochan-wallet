import {
  LOGGING_FUNCTIONS,
  readDir,
  type PossibleLogs,
} from "@spirobel/monero-wallet-api/unpacked";
import { html } from "@spirobel/mininext";
import { textInput } from "../ui/input";
import { router } from "../router";

import { currentlySelectedWallet } from "./walletRoute";
let fileObjects: { filename: string; content: string; opened: boolean }[] = [];
let fileReadBusy = false;
let lastFileRead = 0;
const logLevels = ["off", "console", "file", "console-and-file"] as const;
const selectedLogFns = new Set<string>();
let logFnsReady = false;

function rememberLogFns() {
  if (logFnsReady) return;
  logFnsReady = true;
  for (const name of window.wallets?.logs_include ?? []) selectedLogFns.add(name);
}

let logSaveFlight: Promise<void> | null = null;
let logSaveAgain = false;

let chosenLogLevel: (typeof logLevels)[number] | null = null;

function currentLogLevel(): (typeof logLevels)[number] {
  if (chosenLogLevel) return chosenLogLevel;
  const fromWallet = window.wallets?.logs;
  if (
    fromWallet &&
    (logLevels as readonly string[]).includes(fromWallet)
  ) {
    chosenLogLevel = fromWallet;
    return fromWallet;
  }
  return "off";
}

async function saveLogSettings() {
  const logs = currentLogLevel();
  const include = selectedLogFns.size
    ? ([...selectedLogFns] as PossibleLogs[])
    : null;
  await window.wallets?.setLogSettings(logs, include, null);
}

function queueLogSave() {
  if (logSaveFlight) {
    logSaveAgain = true;
    return;
  }
  logSaveFlight = saveLogSettings()
    .catch(() => undefined)
    .then(() => {
      logSaveFlight = null;
      if (!logSaveAgain) return;
      logSaveAgain = false;
      queueLogSave();
    });
}

async function deleteLogFiles() {
  const names = fileObjects
    .filter((file) => file.filename.endsWith(".log"))
    .map((file) => file.filename);
  for (const name of names) await Bun.file(name).delete();
  fileObjects = fileObjects.filter((file) => !file.filename.endsWith(".log"));
  lastFileRead = 0;
}

function refreshFileList() {
  const now = Date.now();
  if (fileReadBusy || now - lastFileRead < 1000) return;
  fileReadBusy = true;
  lastFileRead = now;
  const opened = new Set(
    fileObjects.filter((file) => file.opened).map((file) => file.filename),
  );
  readFiles()
    .then((files) => {
      fileObjects = files.map((file) => ({
        ...file,
        opened: opened.has(file.filename),
      }));
      fileReadBusy = false;
    })
    .catch(() => {
      fileReadBusy = false;
    });
}
async function readFiles() {
  const files = [];
  const filenames = await readDir("");
  for (const filename of filenames) {
    const content = await Bun.file(filename).text();
    files.push({ filename, content, opened: false });
  }
  return files;
}
async function deleteAllfiles() {
  for (const file of fileObjects) {
    await Bun.file(file.filename).delete();
  }
}
let wipeWalletValue = "";
async function wipeWalletCallback(event: Event) {
  wipeWalletValue = (event.target as HTMLInputElement).value;
  if (wipeWalletValue === "DELETE ALL FILES") {
    // stop the background worker before the files go. the wipe goes on when the background does not answer.
    await window.wallets?.stopWorker().catch(() => {});
    await deleteAllfiles();
    router.navigate("/onboarding");
    location.reload();
  }
}
async function exportWallet() {
  const download = (filename: string, text: string) =>
    Object.assign(document.createElement("a"), {
      href: URL.createObjectURL(new Blob([text], { type: "text/plain" })),
      download: filename,
    }).click();

  const backup = {
    files: fileObjects.map((file) => {
      return {
        filename: file.filename,
        content: file.content,
      };
    }),
  };
  download("wallets.json", JSON.stringify(backup, null, 2));
}
function openFile(index: number) {
  const fileObject = fileObjects[index];
  if (fileObject) fileObject.opened = !fileObject.opened;
}
function setLogLevel(level: (typeof logLevels)[number]) {
  chosenLogLevel = level;
  queueLogSave();
}
function toggleLogFn(name: string, event: Event) {
  if ((event.target as HTMLInputElement).checked) selectedLogFns.add(name);
  else selectedLogFns.delete(name);
  queueLogSave();
}
let regtestNote = "";
let regtestNoteTimer: ReturnType<typeof setTimeout> | undefined;
function showRegtestNote(text: string) {
  regtestNote = text;
  if (regtestNoteTimer) clearTimeout(regtestNoteTimer);
  regtestNoteTimer = setTimeout(() => {
    regtestNote = "";
  }, 10000);
}
async function generateblocks(amount_of_blocks: number, wallet_address?: string) {
  const node_url = currentlySelectedWallet()?.node_url;
  const payload = {
    jsonrpc: "2.0",
    id: "0",
    method: "generateblocks",
    params: { amount_of_blocks, wallet_address },
  };
  const response = await fetch(`${node_url}/json_rpc`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return response.json();
}
async function regTestOneBlock() {
  const wallet_address = currentlySelectedWallet()?.primary_address;
  try {
    const result = await generateblocks(1, wallet_address);
    console.log(JSON.stringify(result, null, 2));
    showRegtestNote(`mined 1 block, height ${result.result?.height ?? result.height}`);
  } catch (e) {
    console.error("Error:", e);
    showRegtestNote("mine failed");
  }
}
async function regTest1000Block() {
  try {
    const result = await generateblocks(
      1000,
      "47cYSGSjzWPX3KFEN9PaxT5zpWKgRtx568bazbGzt57ffBbUAQevjMk19sfZCrMB1RWHNJLbz1eKU63B77HpHwUVA6JGudr",
    );
    console.log(JSON.stringify(result, null, 2));
    showRegtestNote(`mined 1000 blocks, height ${result.result?.height ?? result.height}`);
  } catch (e) {
    console.error("Error:", e);
    showRegtestNote("mine failed");
  }
}
async function regTest60Block() {
  try {
    const result = await generateblocks(
      60,
      "47cYSGSjzWPX3KFEN9PaxT5zpWKgRtx568bazbGzt57ffBbUAQevjMk19sfZCrMB1RWHNJLbz1eKU63B77HpHwUVA6JGudr",
    );
    console.log(JSON.stringify(result, null, 2));
    showRegtestNote(`mined 60 blocks, height ${result.result?.height ?? result.height}`);
  } catch (e) {
    console.error("Error:", e);
    showRegtestNote("mine failed");
  }
}
export function developerSettings() {
  rememberLogFns();
  refreshFileList();

  const dirlist = fileObjects.map((file, i) => {
    return html`<div class="dir">
      <div
        class="filename ${file.opened ? "file-opened" : "file-closed"}"
        id="${String(i)}"
        onclick=${() => openFile(i)}
      >
        ${file.filename}
      </div>
      <div
        class="content ${file.opened ? "content-opened" : "content-closed"}"
        id="${String(i)}-content"
        style="background-color: ${file.opened ? "#333" : "unset"}"
      >
        ${file.opened ? file.content : ""}
      </div>
    </div>`;
  });
  const files = html`<div>${dirlist}</div>`;
  return html`<div>
    <style>
      .dir {
        width: 270px;
        word-wrap: break-word;
        display: inline-block;
      }
      .filename {
        user-select: none;
      }
      .content {
        padding: 5px;
        overflow-y: auto;
        text-wrap: auto;
      }
      .content-opened {
        background-color: #333;
      }
      .content-closed {
        background-color: unset;
      }
      .file-opened {
        color: #551a8b;
        text-decoration: underline;
        font-family: serif;
        font-size: 16px;
        margin-bottom: 12px;
        cursor: pointer;
      }

      .file-closed {
        color: rgba(255, 255, 255, 0.3);
        text-decoration: underline;
        font-family: serif;
        font-size: 16px;
        cursor: pointer;
      }
      .file-closed:hover {
        color: #551a8b;
      }
      #exportWallet {
        box-shadow:
          inset 0 4px 12px rgba(0, 0, 0, 0.45),
          0 5px 8px rgba(0, 0, 0, 0.4);
        margin-top: 4px;
        font-size: 14px;
        margin-bottom: 12px;
        cursor: pointer;
        border: 2px solid rgba(255, 255, 255, 0.3);
        border-radius: 4px;
        padding: 2px 4px;
        user-select: none;
      }
      #exportWallet:hover {
        color: white;
      }
      .regtest-btn {
        box-shadow:
          inset 0 4px 12px rgba(0, 0, 0, 0.45),
          0 5px 8px rgba(0, 0, 0, 0.4);
        margin-top: 4px;
        font-size: 14px;
        margin-bottom: 12px;
        cursor: pointer;
        border: 2px solid rgba(255, 255, 255, 0.3);
        border-radius: 4px;
        padding: 2px 4px;
        user-select: none;
      }
      .regtest-btn:hover {
        color: white;
      }
      .log-level-on {
        color: white;
        border-color: rgba(255, 255, 255, 0.7);
      }
      .log-fn {
        display: block;
        margin-top: 4px;
        color: white;
      }
    </style>
    <div style="margin-top: 12px">
      Sharing the content of these files will result in the loss of your funds &
      privacy.
    </div>
    <div style="margin-bottom: 36px; margin-top: 12px">
      <span id="exportWallet" onclick=${exportWallet}>EXPORT WALLETS</span>
    </div>
    <div>
      <span> type DELETE ALL FILES to reset your wallet: </span>
      ${textInput("wipeWallet", "DELETE ALL FILES", wipeWalletValue, wipeWalletCallback)}
    </div>
    <div style="margin-top: 85px; margin-bottom: 7px">
      inspect wallet files:
    </div>
    ${files}
    <div style=" margin-bottom: 7px">
      send command to local regtest node (currently selected wallet receives
      miner reward for one block. 60 blocks to random address, 1000 blocks to
      random address. Useful to make sure the chain is long enough for decoys to
      be sampled, make sure coinbase miner reward becomes spendable):
    </div>
    <div style="margin-bottom: 36px; margin-top: 12px">
      <span class="regtest-btn" id="regtestOneBlock" onclick=${regTestOneBlock}>regtest one block</span>
      <span class="regtest-btn" id="regtest60Block" onclick=${regTest60Block}>regtest 60 blocks</span>
    </div>
    <div style="margin-bottom: 36px; margin-top: 12px">
      <span class="regtest-btn" id="regtest1000Block" onclick=${regTest1000Block}>regtest 1000 blocks</span>
    </div>
    ${regtestNote
      ? html`<div style="margin-bottom: 12px">${regtestNote}</div>`
      : ""}
    <div style="margin-top: 12px">log level</div>
    <div style="margin-top: 8px; margin-bottom: 12px">
      ${
        html`<div>${
          logLevels.map(
            (level) => html`<span
              class="regtest-btn ${currentLogLevel() === level ? "log-level-on" : ""}"
              id="log-level-${level}"
              onclick=${() => setLogLevel(level)}
              >${level}</span
            >`,
          )
        }</div>`
      }
    </div>
    <div style="margin-top: 12px">
      logged functions. no selection logs every function.
    </div>
    <div style="margin-top: 8px; margin-bottom: 12px">
      ${
        html`<div>${
          LOGGING_FUNCTIONS.map(
            (name) => html`<label class="log-fn">
              <input
                type="checkbox"
                id="log-fn-${name}"
                checked=${selectedLogFns.has(name)}
                onchange=${(e: Event) => toggleLogFn(name, e)}
              />
              ${name}
            </label>`,
          )
        }</div>`
      }
    </div>
    <div style="margin-bottom: 24px">
      <span class="regtest-btn" id="deleteLogFiles" onclick=${() => void deleteLogFiles()}>delete log files</span>
    </div>
  </div>`;
}
