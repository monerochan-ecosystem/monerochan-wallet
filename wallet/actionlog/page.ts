import {
  getToolUiByPermissions,
  type ActionLogEvent,
  type InvocationState,
} from "@spirobel/monero-wallet-api";
import { flatten, html, type MiniHtmlString } from "../../mininext/mininext";
import { actionLog } from "./init";
import { router } from "./router";

function formatTime(timestamp?: string) {
  if (!timestamp) return "";
  const t = Date.parse(timestamp);
  if (!Number.isFinite(t)) return timestamp;
  return new Date(t).toLocaleString(undefined, {
    year: "2-digit",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function titleFor(row: { toolId?: string }) {
  if (row.toolId === "001")
    return getToolUiByPermissions(["spend"])?.openTitle ?? "001";
  if (row.toolId === "002")
    return getToolUiByPermissions(["share_view"])?.openTitle ?? "002";
  return row.toolId ?? "";
}

const styles = html`<style>
  .log-page {
    max-width: 720px;
    margin: 16px auto;
    padding: 0 16px 32px;
  }
  .log-title {
    font-size: 18px;
    margin-bottom: 12px;
    user-select: none;
  }
  .log-home {
    cursor: pointer;
    text-decoration: underline;
    user-select: none;
    font-size: 14px;
    color: rgba(255, 255, 255, 0.6);
  }
  .log-home:hover {
    color: white;
  }
  .log-back {
    cursor: pointer;
    user-select: none;
    font-size: 16px;
    color: rgba(255, 255, 255, 0.85);
    margin-top: 24px;
    display: inline-block;
    border: 2px solid rgba(255, 255, 255, 0.3);
    border-radius: 4px;
    padding: 10px 20px;
  }
  .log-back:hover {
    color: white;
    border-color: rgba(255, 255, 255, 0.6);
  }
  .log-row {
    border: 2px solid rgba(255, 255, 255, 0.2);
    border-radius: 4px;
    padding: 8px;
    margin-bottom: 8px;
    cursor: pointer;
    overflow: hidden;
  }
  .log-row:hover {
    border-color: rgba(255, 255, 255, 0.45);
  }
  .log-meta {
    color: rgba(255, 255, 255, 0.55);
    font-size: 12px;
    margin-top: 4px;
    word-wrap: break-word;
  }
  .log-address {
    word-wrap: break-word;
    display: block;
  }
  .log-status {
    color: rgba(255, 255, 255, 0.45);
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.4px;
    user-select: none;
  }
  .log-empty {
    user-select: none;
    color: rgba(255, 255, 255, 0.5);
  }
  .log-event {
    font-size: 13px;
    margin-top: 6px;
    color: rgba(255, 255, 255, 0.8);
    word-wrap: break-word;
  }
  .log-info {
    border: 2px solid rgba(255, 255, 255, 0.2);
    border-radius: 4px;
    padding: 8px;
    margin: 12px 0;
  }
  .log-info-row {
    margin-bottom: 8px;
  }
  .log-info-label {
    color: rgba(255, 255, 255, 0.45);
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.4px;
    user-select: none;
  }
  .log-info-value {
    color: white;
    word-wrap: break-word;
  }
</style>`;

function listPage(): MiniHtmlString {
  const rows = [...(actionLog()?.invocations() ?? [])].sort((a, b) =>
    (b.timestamp ?? "").localeCompare(a.timestamp ?? ""),
  );
  const items = rows.map((row) => {
    const id = `row-${row.invocationId}`;
    const el = document.getElementById(id);
    if (el) {
      el.onclick = () =>
        router.navigate("/invo/:invocationId", {
          invocationId: row.invocationId,
        });
    }
    return html`<div class="log-row" id="${id}">
      <div class="log-status">${row.status}</div>
      <div>${titleFor(row)}</div>
      <div class="log-meta">
        ${row.error ?? ""} ${row.amount ?? ""} ${row.context_domain ?? ""}
        ${formatTime(row.timestamp)}
        ${row.address
          ? html`<span class="log-address">${row.address}</span>`
          : ""}
      </div>
    </div>`;
  });
  return html`<div class="log-page">
    ${styles}
    <div class="log-title">action log</div>
    ${rows.length
      ? flatten(items)
      : html`<div class="log-empty">no tool calls</div>`}
  </div>`;
}

function eventLine(ev: ActionLogEvent): MiniHtmlString {
  return html`<div class="log-event">
    ${formatTime(ev.timestamp)} ${ev.type} ${ev.stage}
    ${ev.valid ?? ""} ${ev.ok === undefined ? "" : ev.ok ? "ok" : "fail"}
    ${ev.error ? ` · ${ev.error}` : ""}
  </div>`;
}

function addInfoRow(
  rows: MiniHtmlString[],
  label: string,
  value?: string | number | boolean,
) {
  if (value === undefined || value === "") return;
  const text =
    typeof value === "boolean" ? (value ? "yes" : "") : String(value);
  if (!text) return;
  rows.push(html`<div class="log-info-row">
    <div class="log-info-label">${label}</div>
    <div class="log-info-value">${text}</div>
  </div>`);
}

function invoInfo(head: InvocationState): MiniHtmlString {
  const rows: MiniHtmlString[] = [];
  addInfoRow(rows, "error", head.error);
  addInfoRow(rows, "amount", head.amount);
  addInfoRow(rows, "address", head.address);
  addInfoRow(rows, "from", head.wallet_to_send_from_pa);
  addInfoRow(rows, "wallet slot", head.wallet_slot);
  addInfoRow(rows, "valid", head.valid);
  addInfoRow(rows, "no check", head.no_check);
  addInfoRow(rows, "context", head.context_domain);
  addInfoRow(rows, "destination", head.destination_domain);
  addInfoRow(rows, "page", head.context_href);
  addInfoRow(rows, "found in", head.found_in);
  addInfoRow(rows, "link", head.link);
  addInfoRow(rows, "link text", head.linkText);
  addInfoRow(rows, "time", formatTime(head.timestamp));
  if (!rows.length) return html``;
  return html`<div class="log-info">${flatten(rows)}</div>`;
}

function goHome() {
  router.navigate("/");
}

function detailPage(invocationId: string): MiniHtmlString {
  const home = document.getElementById("log-home");
  if (home) home.onclick = goHome;
  const back = document.getElementById("log-back");
  if (back) back.onclick = goHome;

  const head =
    (actionLog()?.invocations() ?? []).find(
      (r) => r.invocationId === invocationId,
    ) ?? null;
  const evs = head?.events ?? [];
  const status = head?.status ?? "";

  return html`<div class="log-page">
    ${styles}
    <div class="log-home" id="log-home">action log</div>
    <div class="log-title">${head ? titleFor(head) : "tool call"}</div>
    <div class="log-status">${status}</div>
    ${head ? invoInfo(head) : ""}
    ${evs.length
      ? flatten(evs.map(eventLine))
      : html`<div class="log-empty">no events</div>`}
    <div class="log-back" id="log-back">back</div>
  </div>`;
}

export function actionLogList() {
  return listPage();
}

export function actionLogDetail(params: { invocationId: string }) {
  return detailPage(params.invocationId);
}
