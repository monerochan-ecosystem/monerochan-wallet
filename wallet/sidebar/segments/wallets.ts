import {
  convertBigIntAmount,
  getToolUiByPermissions,
  truncateDecimalString,
  type InvocationState,
  writeWalletToScanSettings,
  writeWalletSecretsToDotEnv,
  writeScanSettingsFileDefaultLocation,
} from "@spirobel/monero-wallet-api";
import { flatten, html, type MiniHtmlString } from "../../../mininext/mininext";
import { router } from "../router";
import { rightLower, tactileContentPlate } from "../ui/content";
import { allWallets, navigateToFirstWallet } from "./walletRoute";
import {
  getWalletSecret,
  walletRouteFromString,
  walletRouteToString,
  type WalletRoute,
} from "@spirobel/seedphrase";
import { initWallets } from "../init";
import { textInput } from "../ui/input";
import { toggleActionLogPage } from "../../actionlog/open";
let shareOpen: InvocationState | null = null;
let shareBusyId: string | null = null;
let openAdvancedOptions = false;
let restoreRouteMessage: MiniHtmlString = html`<div></div>`;
let removeRouteMessage: MiniHtmlString = html`<div></div>`;

function openWalletsAdvancedOptionsHandler() {
  openAdvancedOptions = !openAdvancedOptions;
  restoreRouteMessage = html`<div></div>`;
  removeRouteMessage = html`<div></div>`;
}

async function removeWalletRouteHandler() {
  const removeInput = document.getElementById(
    "removeWalletRoute",
  ) as HTMLInputElement | null;
  if (!removeInput) return;
  removeInput.value = removeInput.value.trim();
  const res = walletRouteFromString(removeInput.value);
  if (res.ok) {
    await writeScanSettingsFileDefaultLocation({
      async writeCallback(settings) {
        const toRemove = removeInput.value;
        // Find matching wallet first so we can delete its files
        const matching = settings.wallets.find(
          (w) => w.wallet_route === toRemove,
        );
        if (matching) {
          await Bun.file(`${matching.primary_address}_cache.json`).delete();
          await Bun.file(`${matching.primary_address}_stats.json`).delete();
        }
        settings.wallets = settings.wallets.filter(
          (w) => w.wallet_route !== toRemove,
        );
      },
    });
    await initWallets();
    void window.wallets?.buildWallets();
    removeInput.value = "";
    navigateToFirstWallet();
  } else {
    removeRouteMessage = html`<div class="options-message-negative">
      Invalid wallet route, ${res.error}
    </div>`;
    return;
  }
}

async function restoreWalletRouteHandler() {
  const restoreInput = document.getElementById(
    "restoreWalletRoute",
  ) as HTMLInputElement | null;
  if (!restoreInput) return;
  restoreInput.value = restoreInput.value.trim();
  const res = walletRouteFromString(restoreInput.value);
  if (res.ok) {
    await addWalletFromRoute(res.route);
    restoreInput.value = "";
    return;
  } else {
    restoreRouteMessage = html`<div class="options-message-negative">
      Invalid wallet route, ${res.error}
    </div>`;
    return;
  }
}

export function walletsPlate() {
  const al = window.wallets?.actionLogOpened;
  shareOpen = al?.getActiveByPermissions(["share_view"])[0] ?? null;
  if (shareOpen?.invocationId !== shareBusyId) shareBusyId = null;
  if (shareOpen?.lastType === "execute_error") shareBusyId = null;
  const shareUi = getToolUiByPermissions(["share_view"]);

  function shareWalletToolInfo(t?: InvocationState | null) {
    if (!t) return "";

    const walletSlot = t.wallet_slot ?? 0;
    const contextDomain = t.context_domain ?? "";
    const contextHref = t.context_href ?? "";
    const clickedAt = t.timestamp ?? Date.now();
    const openTitle = shareUi?.openTitle ?? "";
    const acceptLabel = shareUi?.acceptLabel ?? "ACCEPT";
    const dismissLabel = shareUi?.dismissLabel ?? "DISMISS";

    return html`<div>
      <div class="tool-info">
        <span class="tool-label">${openTitle}</span>
        <div class="tool-row">
          <span class="tool-context">context:</span>
          <span class="tool-value">${contextDomain}</span>
        </div>
        <a
          class="context-href grey-link"
          href=${contextHref}
          target="_blank"
        >
          ${contextHref}
        </a>
        <div class="tool-row">
          <span class="tool-context">wallet slot:</span>
          <span class="tool-value">${walletSlot}</span>
        </div>
        <div class="tool-row">
          <span class="tool-context">domain:</span>
          <span class="tool-value">${contextDomain}</span>
        </div>
        <div class="tool-row">
          <span class="tool-context">clicked:</span>
          <span class="tool-value">${formatTime(clickedAt)}</span>
        </div>
        ${t.error
          ? html`<div class="tool-hint">${t.error}</div>`
          : ""}
        <div class="tool-actions">
          <span class="tool-action" id="acceptShareWallet">${acceptLabel}</span>
          <span class="tool-action" id="dismissShareWallet">${dismissLabel}</span>
        </div>
      </div>
    </div>`;
  }

  const hideBusy =
    shareBusyId &&
    shareOpen?.invocationId === shareBusyId &&
    shareOpen.lastType !== "execute_error";
  const toolInfoSnippet = shareWalletToolInfo(hideBusy ? null : shareOpen);

  if (shareOpen?.invocationId) {
    const dismissBtn = document.getElementById("dismissShareWallet");
    if (dismissBtn) {
      dismissBtn.onclick = dismissShareViewWalletTool;
    }
    const acceptBtn = document.getElementById("acceptShareWallet");
    if (acceptBtn) {
      acceptBtn.onclick = acceptShareViewWalletTool;
    }
  }

  const openAdvancedOptionsButton = document.getElementById(
    "openWalletsAdvancedOptionsButton",
  ) as HTMLElement | null;
  if (openAdvancedOptionsButton) {
    openAdvancedOptionsButton.onclick = openWalletsAdvancedOptionsHandler;
  }

  const removeBtn = document.getElementById("removeWalletRouteBtn");
  if (removeBtn) {
    removeBtn.onclick = removeWalletRouteHandler;
  }

  const restoreBtn = document.getElementById("restoreWalletRouteBtn");
  if (restoreBtn) {
    restoreBtn.onclick = restoreWalletRouteHandler;
  }
  const logBtn = document.getElementById("openActionLog");
  if (logBtn) {
    logBtn.onclick = () => toggleActionLogPage();
  }

  const walletsList: () => MiniHtmlString = () => {
    const wl = allWallets().map((wallet) => {
      const colorclass =
        (wallet.amount || 0n) > 0 ? "amount-positive" : "amount-zero";
      const amount = convertBigIntAmount(wallet.amount || 0n);
      const amountTrun = truncateDecimalString(amount, 3);
      return html`<div class="wallet-route">
        <a class="wallet" href=${router.link(wallet.wallet_route || "")}>
          ${wallet.wallet_route || '""'}
        </a>
        <div class="amount ${colorclass}">${amountTrun}</div>
      </div>`;
    }) || [html`<div class="wallet">no wallets</div>`];
    return flatten(wl);
  };

  return tactileContentPlate(
    html`<div>
      <style>
        .wallet {
          box-sizing: border-box;
          color: rgb(0, 0, 238);
          cursor: pointer;
          display: inline;
          font-family: sans-serif;
          font-size: 16px;
          font-weight: 700;
        }
        .wallet-route {
          display: grid;
          grid-template-columns: 200px 1fr;
          gap: 28px;
          place-items: baseline;
        }
        .amount-positive {
          color: #ff4444;
        }
        .amount-zero {
          color: white;
        }
        #openWalletsAdvancedOptionsButton {
          margin-top: 12px;
          text-decoration: underline;
          font-family: serif;
          font-size: 16px;
          margin-bottom: 12px;
          cursor: pointer;
          ${openAdvancedOptions ? "color: #551a8b;" : ""}
        }
        #openWalletsAdvancedOptionsButton:hover {
          ${openAdvancedOptions
          ? "color: rgba(255, 255, 255, 0.3)"
          : "color: white;"}
        }
        .dev-message-positive {
          color: #00ff00;
          font-size: 12px;
          margin-top: 4px;
        }
        .dev-message-negative {
          color: #ff0000;
          font-size: 12px;
          margin-top: 4px;
        }
        .wallet-options-input {
          margin-bottom: 8px;

        }

        .wallet-options-buttons {
          display: grid;
          grid-template-columns: 198px 78px;
          margin-top: 8px;
          margin-bottom: 12px;
        }
        .wallet-options-button {
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
        justify-self: end;
        }
        .wallet-options-button:hover {
          color: white;
        }
      </style>
      ${shareWalletToolStyles}
      ${toolInfoSnippet}
      ${walletsList()}
      <div style="margin-top: 15px; user-select: none;">
        <span id="openWalletsAdvancedOptionsButton">advanced options</span>
      </div>
      <div id="walletsAdvancedOptions">
        ${openAdvancedOptions
          ? html`<div
              style="margin-left: 10px; margin-top: 12px; border-top: 1px solid rgba(255, 255, 255, 0.2); padding-top: 12px;"
            >
              <div
                style="font-size: 12px; color: rgba(255, 255, 255, 0.7); margin-bottom: 8px;"
              >
                Remove Wallet Route
              </div>
              <div class="wallet-options-input">
                ${textInput(
                  "removeWalletRoute",
                  "Enter wallet route to remove",
                )}
              </div>
              <div class="wallet-options-buttons">
                ${removeRouteMessage}

                <span class="wallet-options-button" id="removeWalletRouteBtn"
                  >REMOVE</span
                >
              </div>

              <div
                style="font-size: 12px; color: rgba(255, 255, 255, 0.7); margin-bottom: 8px; margin-top: 12px;"
              >
                Restore Wallet Route
              </div>
              <div class="wallet-options-input">
                ${textInput(
                  "restoreWalletRoute",
                  "Enter wallet route to restore",
                )}
                <div class="wallet-options-buttons">
                  <span>${restoreRouteMessage}</span>
                  <span
                    class="wallet-options-button restore"
                    id="restoreWalletRouteBtn"
                    >RESTORE</span
                  >
                </div>
              </div>
            </div>`
          : ""}
      </div>
      <div style="margin-top: 12px;">
        <span class="tool-action" id="openActionLog">actionlog</span>
      </div>
    </div>`,
    rightLower,
    "top",
    // floor 468 so tiny sidebars dont collapse. grow with window when taller.
    "max(468px, calc(100vh - 400px))",
  );
}

function formatTime(timestamp: number | string) {
  const date = new Date(
    typeof timestamp === "string" ? Date.parse(timestamp) || Date.now() : timestamp,
  );
  return date.toLocaleString(undefined, {
    year: "2-digit",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

async function dismissShareViewWalletTool() {
  if (shareOpen?.invocationId)
    await window.wallets?.actionLogOpened?.dismiss(shareOpen.invocationId);
}

async function acceptShareViewWalletTool() {
  const open =
    window.wallets?.actionLogOpened?.getActiveByPermissions(["share_view"])[0] ??
    null;
  if (!open?.invocationId) return;
  if (shareBusyId === open.invocationId && open.lastType !== "execute_error")
    return;
  shareBusyId = open.invocationId;
  const wallet_slot = String(open.wallet_slot ?? 0);

  const walletRoute: WalletRoute = {
    identity: "main",
    domain: open.context_domain ?? "",
    wallet_type: "single" as const,
    wallet_slot,
  };
  const primary_address = await addWalletFromRoute(walletRoute);
  const viewkey = Bun.env[`vk${primary_address}`];
  if (!primary_address || !viewkey) return;
  await window.wallets?.actionLogOpened?.execute(open.invocationId, {
    viewkey,
    primary_address,
  });
}

export async function addWalletFromRoute(walletRoute: WalletRoute) {
  const seedphrase = Bun.env["SEEDPHRASE"];
  if (!seedphrase) return;
  const passphrase = Bun.env["PASSPHRASE"];
  const spendkeySecretSeed = getWalletSecret({
    route: walletRoute,
    password: passphrase,
    seedphrase: seedphrase,
    coin_name: "monero",
    key_type: "spend",
  });

  let primary_address = await writeWalletSecretsToDotEnv(spendkeySecretSeed);

  await writeWalletToScanSettings({
    primary_address,
    wallet_route: walletRouteToString(walletRoute),
  });

  await initWallets();
  await window.wallets?.buildWallets();
  return primary_address;
}

function shareWalletToolStyles() {
  return html`
    <style>
      .tool-info {
        display: flex;
        flex-direction: column;
        box-shadow:
          inset 0 4px 12px rgba(0, 0, 0, 0.45),
          0 5px 8px rgba(0, 0, 0, 0.4);
        margin-top: 4px;
        font-size: 14px;
        margin-bottom: 12px;
        cursor: pointer;
        border: 2px solid rgba(255, 255, 255, 0.3);
        border-radius: 4px;
        padding: 8px 7px;
        margin-right: 12px;
        margin-left: 17px;
        margin-top: 12px;
      }
      .tool-info-error {
        border-color: #e74c3c;
        background-color: rgba(231, 76, 60, 0.1);
      }
      .context-href {
        width: 236px;
        word-wrap: break-word;
      }
      .grey-link {
        margin-top: 3px;
        text-decoration: underline;
        font-size: 10px;
        margin-bottom: 12px;
        cursor: pointer;
        color: rgba(255, 255, 255, 0.3);
      }
      .grey-link:hover {
        color: white;
      }
      .valid {
        color: greenyellow;
      }
      .invalid {
        color: #e74c3c;
      }
      .unverified {
        color: rgba(255, 255, 255, 0.3);
      }
      .tool-context {
        color: rgba(255, 255, 255, 0.7);
      }
      .tool-label {
        color: rgba(255, 255, 255, 0.5);
        font-size: 11px;
        text-transform: uppercase;
        letter-spacing: 0.5px;
      }
      .tool-label-error {
        color: #e74c3c;
      }
      .tool-value {
        color: white;
        font-weight: 600;
      }
      .tool-row {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 4px;
      }
      .tool-hint {
        color: rgba(255, 255, 255, 0.6);
        font-size: 11px;
        font-style: italic;
        margin-top: 4px;
        margin-bottom: 4px;
        line-height: 1.4;
      }
      .tool-actions {
        display: flex;
        gap: 8px;
        margin-top: 8px;
        margin-bottom: 4px;
      }
      .tool-action {
        box-shadow:
          inset 0 4px 12px rgba(0, 0, 0, 0.45),
          0 5px 8px rgba(0, 0, 0, 0.4);
        margin-left: 12px;
        margin-top: 4px;
        font-size: 14px;
        margin-bottom: 12px;
        cursor: pointer;
        border: 2px solid rgba(255, 255, 255, 0.3);
        border-radius: 4px;
        padding: 2px 4px;
      }
      .tool-action:hover {
        color: white;
      }
      .tool-action-accept {
        color: #00ff00;
      }
      .tool-action-dismiss {
        color: #ff4444;
      }
    </style>
  `;
}
