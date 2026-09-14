import { flatten, html } from "../../../mininext/mininext";
import {
  generateSeedphrase,
  getWalletSecret,
  validateSeedphrase,
  WALLET_DEFAULT_ROUTE,
  walletRouteToString,
} from "@spirobel/seedphrase";
import { actionButton, tactileSwitch } from "../ui/buttons";
import { middleUpper, rightUpper, tactileContentPlate } from "../ui/content";
import { textInput } from "../ui/input";
import {
  atomicWrite,
  writeEnvLineToDotEnvRefresh,
  writeWalletSecretsToDotEnv,
  writeWalletToScanSettings,
} from "@spirobel/monero-wallet-api";
import { router } from "../router";

import { navigateToFirstWallet } from "./walletRoute";

let seedphrase: string[] = []; //generateSeedphrase().split(" ");
export function onboarding() {
  return html`<div class="main">
    <style>
      .main {
        display: flex;
        flex-direction: column;
        height: 100%;
        padding: 8px;
        gap: 11px;
      }
      #importWallet {
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
      }
      #importWallet:hover {
        color: white;
      }
    </style>
    ${onboardingUpper()} ${onboardingTopMenu()} ${recoveryPlate()}
    ${seedoffsetPassphraseInput()} ${onboardingBottomMenu()}
  </div>`;
}

function onboardingUpper() {
  const seedwords = seedphrase.map((word, i) => {
    return html`<div class="seed-phrase" id="word${i + 1}">${word}</div>`;
  });
  const flattenedSeedwords = flatten(seedwords, (htmlstrings) => {
    const words = seedwords.length ? htmlstrings : "";
    return html`<div class="seedphrase-container">${words}</div>`;
  });
  return html`<div class="upper">
    <style>
      .upper {
        height: 199px;
        background: linear-gradient(145deg, #444 0%, #2a2a2a 100%);
        border-radius: 12px;
        border: 4px solid #666;
        box-shadow:
          inset 0 4px 12px rgba(0, 0, 0, 0.6),
          0 15px 25px rgba(0, 0, 0, 0.4);
        display: grid;
        grid-template-areas:
          "seedphrase seedphrase seedphrase seedphrase"
          "seedphrase seedphrase seedphrase seedphrase"
          "seedphrase seedphrase seedphrase seedphrase"
          "divider divider divider divider"
          "passphrase passphrase passphrase passphrase";
        grid-template-columns: repeat(4, 1fr);
        grid-template-rows: repeat(5, 20px);
        box-sizing: border-box;
        gap: 14px;
        padding: 17px;
      }
      .seedphrase-container {
        grid-area: seedphrase;
        display: grid;
        grid-template-columns: subgrid;
        grid-auto-rows: 20px;
        gap: inherit;
        align-content: start;
      }
      .seed-phrase {
        font-size: 14px;
        font-weight: bold;
        color: #bbb;
        text-shadow: 0 1px 2px rgba(0, 0, 0, 0.8);
      }
      .divider {
        margin-top: 10px;
        grid-area: divider;
        height: 4px;
        background: #666;
        border-radius: 12px;
        box-shadow: 0 0 12px rgba(0, 0, 0, 0.6);
      }
      .passphrase {
        grid-area: passphrase;
        font-size: 14px;
        font-weight: bold;
        color: #bbb;
        text-shadow: 0 1px 2px rgba(0, 0, 0, 0.8);
      }
      .divider::before {
        content: "seedphrase";
        margin-top: -14px;
        float: right;
        font-size: 10px;
        color: #888;
        font-weight: normal;
        user-select: none;
        pointer-events: none;
        white-space: nowrap;
      }

      .divider::after {
        content: "seedoffset passphrase";
        margin-top: 7px;
        float: right;
        font-size: 10px;
        color: #888;
        font-weight: normal;
        user-select: none;
        pointer-events: none;
        white-space: nowrap;
      }
    </style>

    ${flattenedSeedwords}

    <div class="divider"></div>
    ${displayPassphrase()}
  </div>`;
}
function displayPassphrase() {
  return html`<div class="passphrase">${String(seedOffsetInputValue)}</div>`;
}
function generateSeedphraseCB() {
  seedphrase = generateSeedphrase().split(" ");
  closeRecoveryPlate();
}
let recoverPlateOpened = false;
function closeRecoveryPlate() {
  recoverPlateOpened = false;
  const recoverPlate = document.getElementById(
    "recover-plate",
  ) as HTMLElement | null;
  if (recoverPlate) {
    recoverPlate.style.display = "none";
  }
  const recoverEl = document.getElementById("recover") as HTMLElement | null;
  if (!recoverEl) return;
  recoverEl.classList.remove("active-switch");
}
function openRecoveryPlate() {
  const recoverEl = document.getElementById("recover") as HTMLElement | null;

  recoverPlateOpened = true;
  const recoverPlate = document.getElementById(
    "recover-plate",
  ) as HTMLElement | null;
  if (recoverPlate) {
    recoverPlate.style.display = "block";
  }
  if (recoverEl) {
    recoverEl.classList.add("active-switch");
  }
}
function recoverWalletCB() {
  if (!recoverPlateOpened) {
    openRecoveryPlate();
  } else {
    closeRecoveryPlate();
  }
}
let recoveryMessage = html`<div class="recovery-message"></div>`;
function updateRecoverySeedphraseCB() {
  const recoverySeedphraseInput = document.getElementById(
    "recoverySeedphrase",
  ) as HTMLInputElement | null;
  if (recoverySeedphraseInput) {
    const isValid = validateSeedphrase(recoverySeedphraseInput.value.trim());
    if (isValid) {
      recoveryMessage = html`<div class="recovery-message">
        <span>seedphrase is valid</span>
      </div>`;
      seedphrase = recoverySeedphraseInput.value.trim().split(" ");
    } else if (recoverySeedphraseInput.value.length === 0) {
      seedphrase = [];
      recoveryMessage = html`<div class="recovery-message"></div>`;
    } else {
      seedphrase = [];
      recoveryMessage = html`<div class="recovery-message-error">
        <span>recovery seedphrase is not valid</span>
      </div>`;
    }
  }
}

async function importWalletFileCB() {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".json";
  input.onchange = async (e) => {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;
    const text = await file.text();
    const data = JSON.parse(text);
    if (!data.files || !Array.isArray(data.files)) {
      alert("Invalid wallet file format.");
      return;
    }
    for (const f of data.files) {
      await atomicWrite(f.filename, f.content);
    }
    navigateToFirstWallet();

    location.reload();
  };
  input.click();
}

function recoveryPlate() {
  const recoverySeedphraseInput = document.getElementById(
    "recoverySeedphrase",
  ) as HTMLInputElement | null;
  if (recoverySeedphraseInput) {
    recoverySeedphraseInput.oninput = updateRecoverySeedphraseCB;
  }
  const importWalletEl = document.getElementById(
    "importWallet",
  ) as HTMLElement | null;
  if (importWalletEl) {
    importWalletEl.onclick = importWalletFileCB;
  }
  return html` <div style="height:233px">
    ${recoverPlateOpened
      ? tactileContentPlate(
          html`<div style="padding: 8px">
            <div class="seedphraserecover">
              <style>
                .seedphraserecover {
                  height: 88px;
                }
                .recovery-message {
                  color: #4ade80;
                  margin-left: 7px;
                  margin-top: 4px;
                }
                .recovery-message-error {
                  color: #ff4444;
                  margin-left: 7px;
                  margin-top: 4px;
                }
              </style>
              <div style="margin-top: 12px;">recover by seedphrase</div>

              ${textInput("recoverySeedphrase", "Enter Seedphrase to recover")}
              ${recoveryMessage}
            </div>
            <div style="margin-bottom: 19px;">
              recover by wallet file import
            </div>

            <div style="">
              <span id="importWallet">IMPORT WALLETFILE</span>
            </div>
          </div>`,
          rightUpper,
          undefined,
          "182px",
          "recover-plate",
          "recover-plate",
        )
      : ""}
  </div>`;
}
function onboardingTopMenu() {
  const generateButton = actionButton("generate", "GENERATE SEEDPHRASE");
  const recoverWallet = tactileSwitch("recover", "RECOVER");
  const generateEl = document.getElementById("generate") as HTMLElement | null;
  if (generateEl) {
    generateEl.onclick = generateSeedphraseCB;
  }
  const recoverWalletEl = document.getElementById(
    "recover",
  ) as HTMLElement | null;
  if (recoverWalletEl) {
    recoverWalletEl.onclick = recoverWalletCB;
  }
  return html`<div class="top-menu">
    ${generateButton} ${recoverWallet}

    <style>
      .top-menu {
        display: grid;
        grid-template-columns: 200px 130px;
        justify-content: start;
        gap: 8px;
        margin-left: 8px;
      }
    </style>
  </div> `;
}
let seedOffsetInputValue: string = "";

function updateSeedoffsetPassphraseCB() {
  const offsetPassphrase = document.getElementById(
    "seedoffsetPassphrase",
  ) as HTMLInputElement | null;
  if (!offsetPassphrase) return;
  seedOffsetInputValue = offsetPassphrase.value;
}
function seedoffsetPassphraseInput() {
  const seedOffsetInput = document.getElementById(
    "seedoffsetPassphrase",
  ) as HTMLInputElement | null;
  if (seedOffsetInput) {
    seedOffsetInput.oninput = updateSeedoffsetPassphraseCB;
  }
  return tactileContentPlate(
    html`<div style="padding: 8px">
      <span> seedoffset passphrase</span>
      ${textInput("seedoffsetPassphrase", "Enter Seedoffset Passphrase")}
    </div>`,
    middleUpper,
    "top",
    "100px",
  );
}
function resetCB() {
  seedphrase = [];
  seedOffsetInputValue = "";
  const seedOffsetInput = document.getElementById(
    "seedoffsetPassphrase",
  ) as HTMLInputElement | null;
  if (seedOffsetInput) {
    seedOffsetInput.value = "";
  }
  recoveryMessage = html`<div class="recovery-message"></div>`;
  const recoverySeedphraseInput = document.getElementById(
    "recoverySeedphrase",
  ) as HTMLInputElement | null;
  if (recoverySeedphraseInput) recoverySeedphraseInput.value = "";
}
function finishPossible() {
  return seedphrase.length > 0;
}
function onboardingBottomMenu() {
  const resetEL = document.getElementById("reset") as HTMLElement | null;
  if (resetEL) {
    resetEL.onclick = resetCB;
  }
  const finishEL = document.getElementById(
    "finish-setup",
  ) as HTMLElement | null;
  if (finishEL) {
    finishEL.onclick = finishCB;
  }
  const setupWallet = actionButton(
    "finish-setup",
    "FINISH SETUP",
    finishPossible(),
  );
  const resetSetup = tactileSwitch("reset", "RESET");
  return html`<div class="bottom-menu">
    ${setupWallet} ${resetSetup}
    <style>
      .bottom-menu {
        display: grid;
        grid-template-columns: 200px 130px;
        justify-content: start;
        gap: 8px;
        margin-left: 8px;
      }
    </style>
  </div>`;
}

async function finishCB() {
  if (!finishPossible()) return;
  await writeEnvLineToDotEnvRefresh("SEEDPHRASE", seedphrase.join(" "));
  await writeEnvLineToDotEnvRefresh("PASSPHRASE", seedOffsetInputValue);
  const spendkeySecretSeed = getWalletSecret({
    route: WALLET_DEFAULT_ROUTE,
    seedphrase: seedphrase.join(" "),
    password: seedOffsetInputValue,
    coin_name: "monero",
    key_type: "spend",
  });

  let primary_address = await writeWalletSecretsToDotEnv(spendkeySecretSeed);
  await writeWalletToScanSettings({
    primary_address,
    wallet_route: walletRouteToString(WALLET_DEFAULT_ROUTE),
    logs: "console",
    logs_include: [
      "handleCpuboundScan",
      "atomicWrite",
      "blocksBufferFetchLoop",
    ],
  });
  void window.wallets?.buildWallets();
  router.navigate(walletRouteToString(WALLET_DEFAULT_ROUTE));
  location.reload();
}
