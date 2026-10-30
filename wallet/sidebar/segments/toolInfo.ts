// tool call info plates. moved out of the plates so the toolconfirm page can show the same thing.
// no side effects on import.
import { getToolUiByPermissions } from "@spirobel/monero-wallet-api/tools";
import type { InvocationState } from "@spirobel/monero-wallet-api/unpacked";
import { html, type MiniValue } from "../../../mininext/mininext";

export function formatTime(timestamp: number | string, block_timestamp = false) {
  const date = new Date(
    typeof timestamp === "string"
      ? Date.parse(timestamp) || Date.now()
      : block_timestamp
        ? timestamp * 1000
        : timestamp,
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

export function toolInfo(t?: InvocationState | null) {
  if (!t) return "";
  const destinationLink =
    t.found_in === "linkText" ? (t.linkText ?? t.link ?? "") : (t.link ?? "");
  const contextDomain = t.context_domain ?? "";
  const contextHref = t.context_href ?? "";
  const destinationDomain = t.destination_domain ?? "";
  const validClass = t.valid ?? "";
  const clickedAt =
    typeof t.timestamp === "string"
      ? Date.parse(t.timestamp) || Date.now()
      : (t.timestamp ?? Date.now());
  // keep the original uri so other wallets can open it, with no destination domain.
  // show a legacy uri as itself, not as the search page that wrapped it
  const lower = destinationLink.toLowerCase();
  const plain_at = lower.indexOf("monero:");
  const escaped_at = lower.indexOf("monero%3a");
  const legacy_at = plain_at !== -1 ? plain_at : escaped_at;
  let legacyUri = "";
  if (legacy_at !== -1) {
    const tail = destinationLink.slice(legacy_at);
    try {
      legacyUri = new URL(
        decodeURIComponent(plain_at !== -1 ? tail : tail.split("&")[0] ?? ""),
      ).href;
    } catch {}
  }
  const openTitle = legacyUri
    ? "legacy monero payment uri"
    : (getToolUiByPermissions(["spend"])?.openTitle ?? "");

  return html`<div class="tool-info">
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
        margin-top: -5px;
      }
      .context-href {
        width: 236px;
        word-wrap: break-word;
      }
      .destination-link {
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
      .destination-link.grey-link,
      .destination-link.grey-link:hover {
        cursor: default;
      }
      .valid {
        color: greenyellow !important;
      }
      .invalid {
        color: #e74c3c !important;
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
    </style>
    <span class="tool-label">${openTitle}</span>
    <div class="tool-row">
      <span class="tool-context">context:</span>
      <span class="tool-value">${contextDomain}</span>
    </div>
    <a class="context-href grey-link" href=${contextHref} target="_blank">
      ${contextHref}
    </a>
    <div class="tool-row">
      <span class="tool-context">${legacyUri ? "destination (legacy):" : "destination:"}</span>
      <span class="tool-value ${validClass}">${legacyUri ? "" : destinationDomain}</span>
    </div>
    ${legacyUri
      ? html`<a class="context-href grey-link" style="color: #007bff; width: 100%; font-size: 14px; overflow-wrap: anywhere" href="${legacyUri}" target="_blank">
          ${legacyUri}
        </a>`
      : html`<div class="destination-link grey-link">${destinationLink}</div>`}
    <div class="tool-row">
      <span class="tool-context">clicked:</span>
      <span class="tool-value">${formatTime(clickedAt)}</span>
    </div>
  </div> `;
}

export function validityMessage(
  t?: { valid?: string; no_check?: boolean } | null,
) {
  if (!t) return "";
  if (t.valid === "invalid")
    return html`<div class="invalidity-message">
      <style>
        .invalidity-warning {
          color: #e74c3c;
          margin-top: 8px;
          margin-bottom: 8px;
          user-select: none;
        }
      </style>
      <span class="invalidity-warning ">the payment link is invalid</span><br />
      <span class="invalidity-hint">
        the payment destination server responded that it does not recognize this
        address <br />
      </span>
    </div>`;
  if (t.no_check)
    return html`<div class="unverified-message">
      <span
        >this payment link skips destination checks, make sure you
        got it from a trusted source & the address matches.</span
      >
    </div>`;
  return "";
}

/** the share view tool call plate. the wallets plate shows it with its actions in extra. */
export function shareToolInfo(
  t?: InvocationState | null,
  extra: MiniValue = "",
) {
  if (!t) return "";
  const shareUi = getToolUiByPermissions(["share_view"]);
  const walletSlot = t.wallet_slot ?? 0;
  const contextDomain = t.context_domain ?? "";
  const contextHref = t.context_href ?? "";
  const clickedAt = t.timestamp ?? Date.now();
  const openTitle = shareUi?.openTitle ?? "";

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
      ${extra}
    </div>
  </div>`;
}
