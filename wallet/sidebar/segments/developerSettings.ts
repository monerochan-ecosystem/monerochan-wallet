import {
  LOGGING_FUNCTIONS,
  readDir,
  type PossibleLogs,
} from "@spirobel/monero-wallet-api";
import { html, flatten } from "../../../mininext/mininext";
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
async function wipeWalletCallback() {
  const wipeWallet = document.getElementById(
    "wipeWallet",
  ) as HTMLInputElement | null;
  if (!wipeWallet) return;
  if (wipeWallet.value === "DELETE ALL FILES") {
    void window.wallets?.stopWorker();
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
function openFile(e: MouseEvent) {
  const target = e.currentTarget as HTMLElement | null;
  const id = (e.currentTarget as HTMLElement | null)?.id as string;
  const fileObject = fileObjects[Number(id)];
  if (!fileObject || !target) return;
  fileObject.opened = !fileObject.opened;
  target.classList.toggle("file-opened");
  target.classList.toggle("file-closed");
  const content = document.getElementById(`${id}-content`);
  if (content) {
    if (target.classList.contains("file-closed")) {
      content.innerText = "";
      content.style.backgroundColor = "unset";
    } else {
      content.innerText = fileObject.content;
      content.style.backgroundColor = "#333";
    }
  }
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
    const filename = document.getElementById(String(i)) as HTMLElement | null;
    if (filename) {
      if (file.opened) {
        filename.classList.add("file-opened");
        filename.classList.remove("file-closed");
      } else {
        filename.classList.add("file-closed");
        filename.classList.remove("file-opened");
      }
    }
    const content = document.getElementById(
      `${String(i)}-content`,
    ) as HTMLElement | null;
    if (content) {
      if (file.opened) {
        content.classList.add("content-opened");
        content.classList.remove("content-closed");
      } else {
        content.classList.add("content-closed");
        content.classList.remove("content-opened");
      }
    }
    return html`<div class="dir">
      <div class="filename" id="${String(i)}">${file.filename}</div>
      <div class="content" id="${String(i)}-content">
        ${file.opened ? file.content : ""}
      </div>
    </div>`;
  });
  const dirElement = document.getElementsByClassName("filename");
  if (dirElement) {
    for (const element of Array.from(dirElement)) {
      (element as HTMLElement).onclick = openFile;
    }
  }

  const files = flatten(dirlist);
  const exportWalletButton = document.getElementById(
    "exportWallet",
  ) as HTMLElement | null;
  if (exportWalletButton) {
    exportWalletButton.onclick = exportWallet;
  }
  const wipeWalletInput = document.getElementById(
    "wipeWallet",
  ) as HTMLInputElement | null;
  if (wipeWalletInput) {
    wipeWalletInput.oninput = wipeWalletCallback;
  }
  const regTestOneBlockBtn = document.getElementById(
    "regtestOneBlock",
  ) as HTMLElement | null;
  if (regTestOneBlockBtn) {
    regTestOneBlockBtn.onclick = regTestOneBlock;
  }
  const regTest1000BlockBtn = document.getElementById(
    "regtest1000Block",
  ) as HTMLElement | null;
  if (regTest1000BlockBtn) {
    regTest1000BlockBtn.onclick = regTest1000Block;
  }
  for (const level of logLevels) {
    const levelBtn = document.getElementById(`log-level-${level}`);
    if (!levelBtn || levelBtn.onclick) continue;
    levelBtn.onclick = () => {
      chosenLogLevel = level;
      queueLogSave();
    };
  }
  for (const name of LOGGING_FUNCTIONS) {
    const box = document.getElementById(
      `log-fn-${name}`,
    ) as HTMLInputElement | null;
    if (!box || box.onchange) continue;
    box.checked = selectedLogFns.has(name);
    box.onchange = () => {
      if (box.checked) selectedLogFns.add(name);
      else selectedLogFns.delete(name);
      queueLogSave();
    };
  }
  const deleteLogs = document.getElementById("deleteLogFiles");
  if (deleteLogs) deleteLogs.onclick = () => {
    void deleteLogFiles();
  };
  const regTest60BlockBtn = document.getElementById(
    "regtest60Block",
  ) as HTMLElement | null;
  if (regTest60BlockBtn) {
    regTest60BlockBtn.onclick = regTest60Block;
  }
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
      <span id="exportWallet">EXPORT WALLETS</span>
    </div>
    <div>
      <span> type DELETE ALL FILES to reset your wallet: </span>
      ${textInput("wipeWallet", "DELETE ALL FILES")}
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
      <span class="regtest-btn" id="regtestOneBlock">regtest one block</span>
      <span class="regtest-btn" id="regtest60Block">regtest 60 blocks</span>
    </div>
    <div style="margin-bottom: 36px; margin-top: 12px">
      <span class="regtest-btn" id="regtest1000Block">regtest 1000 blocks</span>
    </div>
    ${regtestNote
      ? html`<div style="margin-bottom: 12px">${regtestNote}</div>`
      : ""}
    <div style="margin-top: 12px">log level</div>
    <div style="margin-top: 8px; margin-bottom: 12px">
      ${
        flatten(
          logLevels.map(
            (level) => html`<span
              class="regtest-btn ${currentLogLevel() === level ? "log-level-on" : ""}"
              id="log-level-${level}"
              >${level}</span
            >`,
          ),
        )
      }
    </div>
    <div style="margin-top: 12px">
      logged functions. no selection logs every function.
    </div>
    <div style="margin-top: 8px; margin-bottom: 12px">
      ${
        flatten(
          LOGGING_FUNCTIONS.map(
            (name) => html`<label class="log-fn">
              <input type="checkbox" id="log-fn-${name}" />
              ${name}
            </label>`,
          ),
        )
      }
    </div>
    <div style="margin-bottom: 24px">
      <span class="regtest-btn" id="deleteLogFiles">delete log files</span>
    </div>
  </div>`;
}
