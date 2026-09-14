import { readDir } from "@spirobel/monero-wallet-api";
import { html, flatten } from "../../../mininext/mininext";
import { textInput } from "../ui/input";
import { router } from "../router";

import { currentlySelectedWallet } from "./walletRoute";
let fileObjects: { filename: string; content: string; opened: boolean }[] = [];
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
async function regTestOneBlock() {
  const wallet_address = currentlySelectedWallet()?.primary_address;
  const node_url = currentlySelectedWallet()?.node_url;
  const payload = {
    jsonrpc: "2.0",
    id: "0",
    method: "generateblocks",
    params: {
      amount_of_blocks: 1,
      wallet_address: wallet_address,
    },
  };
  try {
    const response = await fetch(`${node_url}/json_rpc`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const result = await response.json();
    console.log(JSON.stringify(result, null, 2));
  } catch (e) {
    console.error("Error:", e);
  }
}
async function regTest1000Block() {
  const wallet_address =
    "47cYSGSjzWPX3KFEN9PaxT5zpWKgRtx568bazbGzt57ffBbUAQevjMk19sfZCrMB1RWHNJLbz1eKU63B77HpHwUVA6JGudr";
  const node_url = currentlySelectedWallet()?.node_url;
  const payload = {
    jsonrpc: "2.0",
    id: "0",
    method: "generateblocks",
    params: {
      amount_of_blocks: 1000,
      wallet_address: wallet_address,
    },
  };
  try {
    const response = await fetch(`${node_url}/json_rpc`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const result = await response.json();
    console.log(JSON.stringify(result, null, 2));
  } catch (e) {
    console.error("Error:", e);
  }
}
async function regTest60Block() {
  const wallet_address =
    "47cYSGSjzWPX3KFEN9PaxT5zpWKgRtx568bazbGzt57ffBbUAQevjMk19sfZCrMB1RWHNJLbz1eKU63B77HpHwUVA6JGudr";
  const node_url = currentlySelectedWallet()?.node_url;
  const payload = {
    jsonrpc: "2.0",
    id: "0",
    method: "generateblocks",
    params: {
      amount_of_blocks: 60,
      wallet_address: wallet_address,
    },
  };
  try {
    const response = await fetch(`${node_url}/json_rpc`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const result = await response.json();
    console.log(JSON.stringify(result, null, 2));
  } catch (e) {
    console.error("Error:", e);
  }
}
export function developerSettings() {
  if (!fileObjects.length)
    readFiles().then((files) => {
      fileObjects = files;
    });

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
    for (const element of dirElement) {
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
  </div>`;
}
