import {
  getToolUiByPermissions,
  sendToBackground,
  type ActionLogEvent,
  type InvocationState,
  type TxLog,
} from "@spirobel/monero-wallet-api";
import { flatten, html, type MiniHtmlString } from "../../mininext/mininext";
import { actionLog } from "./init";
import { router } from "./router";

type LogTab = "history" | "success" | "discarded" | "txlog";
let logTab: LogTab = "history";
let logPage = 1;
let pageInputFocused = false;
let edgeLeftCount = 0;
let edgeRightCount = 0;
const PAGE_SIZE = 5;

type TxLogRow = { wallet: string; log: TxLog & { index: number } };
let txlogCache: TxLogRow[] | null = null;

async function refreshTxLogs() {
  try {
    const res = (await sendToBackground("worker.getTxLogs", null)) as {
      tx_logs?: { primary_address: string; tx_logs: (TxLog & { index: number })[] }[];
    } | null;
    const rows: TxLogRow[] = [];
    for (const w of res?.tx_logs ?? [])
      for (const log of w.tx_logs ?? [])
        rows.push({ wallet: w.primary_address, log });
    txlogCache = rows;
  } catch {
    txlogCache = [];
  }
}

function formatTime(timestamp?: string | number) {
  if (timestamp === undefined || timestamp === "") return "";
  const t =
    typeof timestamp === "number" ? timestamp : Date.parse(timestamp);
  if (!Number.isFinite(t)) return String(timestamp);
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
  .log-top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 12px;
  }
  .log-pager {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .log-page-btn {
    cursor: pointer;
    user-select: none;
    font-size: 16px;
    color: rgba(255, 255, 255, 0.85);
    display: inline-block;
    border: 2px solid rgba(255, 255, 255, 0.3);
    border-radius: 4px;
    padding: 6px 12px;
  }
  .log-page-btn:hover {
    color: white;
    border-color: rgba(255, 255, 255, 0.6);
  }
  .log-page-input {
    width: 3ch;
    box-sizing: content-box;
    font-size: 16px;
    color: rgba(255, 255, 255, 0.85);
    background: transparent;
    border: 2px solid rgba(255, 255, 255, 0.3);
    border-radius: 4px;
    padding: 6px 4px;
    text-align: center;
  }
  .log-tabs {
    display: flex;
    gap: 12px;
    margin-top: 16px;
    flex-wrap: wrap;
  }
  .log-tab {
    cursor: pointer;
    user-select: none;
    font-size: 16px;
    color: rgba(255, 255, 255, 0.55);
    display: inline-block;
    border: 2px solid rgba(255, 255, 255, 0.2);
    border-radius: 4px;
    padding: 10px 20px;
  }
  .log-tab:hover {
    color: white;
    border-color: rgba(255, 255, 255, 0.6);
  }
  .log-tab-active {
    color: white;
    border-color: rgba(255, 255, 255, 0.65);
  }
</style>`;

function tabRows(): InvocationState[] {
  const all = [...(actionLog()?.invocations() ?? [])].sort((a, b) =>
    (b.timestamp ?? "").localeCompare(a.timestamp ?? ""),
  );
  if (logTab === "success")
    return all.filter((r) => r.status === "done");
  if (logTab === "discarded")
    return all.filter(
      (r) => r.status === "dismissed" || r.status === "aborted",
    );
  return all;
}

function txlogRows(): TxLogRow[] {
  return [...(txlogCache ?? [])].sort((a, b) => b.log.timestamp - a.log.timestamp);
}

function txStatus(log: TxLogRow["log"]): string {
  if (log.sendResult?.status) return log.sendResult.status;
  if (log.error) return "failed";
  return "no result";
}

function txlogItem(row: TxLogRow) {
  const log = row.log;
  const id = `txlog-${row.wallet.slice(0, 8)}-${log.index}`;
  const payments = (log.payments ?? [])
    .map((p) => `${p.amount ?? ""} ${p.address ?? ""}`)
    .join(" | ");
  return html`<div class="log-row" id="${id}">
    <div class="log-status">${txStatus(log)}</div>
    <div>${formatTime(log.timestamp)}</div>
    <div class="log-meta">
      ${log.error ?? ""} ${payments}
      ${log.inputs_index?.length
        ? html`<span class="log-address">inputs: ${log.inputs_index.join(", ")}</span>`
        : ""}
      ${log.invocationId
        ? html`<span class="log-address">tool call: ${log.invocationId.slice(0, 8)}</span>`
        : ""}
      <span class="log-address">wallet: ${row.wallet.slice(0, 12)}… height: ${log.height ?? ""}</span>
    </div>
  </div>`;
}

function attachListHandlers(pages: number) {
  const tabs: LogTab[] = ["history", "success", "discarded", "txlog"];
  for (const tab of tabs) {
    const el = document.getElementById(`log-tab-${tab}`);
    if (el)
      el.onclick = () => {
        pageInputFocused = false;
        logTab = tab;
        logPage = 1;
        if (tab === "txlog") void refreshTxLogs();
      };
  }
  const prev = document.getElementById("log-prev");
  if (prev)
    prev.onclick = () => {
      pageInputFocused = false;
      logPage = Math.max(1, logPage - 1);
      if (logTab === "txlog") void refreshTxLogs();
    };
  const next = document.getElementById("log-next");
  if (next)
    next.onclick = () => {
      pageInputFocused = false;
      logPage = Math.min(pages, logPage + 1);
      if (logTab === "txlog") void refreshTxLogs();
    };
  document.onkeydown = (ev) => {
    const tag = (ev.target as HTMLElement | null)?.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA") return;
    if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
    if (ev.key === "ArrowLeft" || ev.key === "ArrowRight") {
      pageInputFocused = false;
      logPage =
        ev.key === "ArrowLeft"
          ? Math.max(1, logPage - 1)
          : Math.min(pages, logPage + 1);
      if (logTab === "txlog") void refreshTxLogs();
      return;
    }
    const tabs: Record<string, LogTab> = {
      h: "history",
      s: "success",
      d: "discarded",
      t: "txlog",
    };
    const tab = tabs[ev.key.toLowerCase()];
    if (!tab) return;
    pageInputFocused = false;
    logTab = tab;
    logPage = 1;
    if (tab === "txlog") void refreshTxLogs();
  };
  const input = document.getElementById("log-page") as HTMLInputElement | null;
  if (input) {
    input.onfocus = () => {
      pageInputFocused = true;
    };
    input.oninput = () => {
      const n = parseInt(input.value, 10);
      if (!Number.isFinite(n)) return;
      logPage = Math.min(pages, Math.max(1, n));
      if (logTab === "txlog") void refreshTxLogs();
    };
    input.onkeydown = (ev) => {
      if (ev.key !== "ArrowLeft" && ev.key !== "ArrowRight") {
        edgeLeftCount = 0;
        edgeRightCount = 0;
        return;
      }
      const pos = input.selectionStart ?? 0;
      const collapsed = pos === (input.selectionEnd ?? 0);
      if (ev.key === "ArrowLeft" && collapsed && pos <= 0) {
        edgeLeftCount += 1;
        edgeRightCount = 0;
        if (edgeLeftCount >= 2) {
          edgeLeftCount = 0;
          pageInputFocused = false;
          input.blur();
        }
      } else if (
        ev.key === "ArrowRight" &&
        collapsed &&
        pos >= input.value.length
      ) {
        edgeRightCount += 1;
        edgeLeftCount = 0;
        if (edgeRightCount >= 2) {
          edgeRightCount = 0;
          pageInputFocused = false;
          input.blur();
        }
      } else {
        edgeLeftCount = 0;
        edgeRightCount = 0;
      }
    };
    if (pageInputFocused && document.activeElement !== input) {
      input.focus();
      input.setSelectionRange(input.value.length, input.value.length);
    }
  }
}

function listPage(): MiniHtmlString {
  const isTx = logTab === "txlog";
  const total = isTx ? txlogRows().length : tabRows().length;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  if (logPage > pages) logPage = pages;
  if (logPage < 1) logPage = 1;
  const start = (logPage - 1) * PAGE_SIZE;
  const items = isTx
    ? txlogRows()
        .slice(start, start + PAGE_SIZE)
        .map(txlogItem)
    : tabRows()
        .slice(start, start + PAGE_SIZE)
        .map((row) => {
          const id = `row-${row.invocationId}`;
          const el = document.getElementById(id);
          if (el) {
            el.onclick = () => {
              pageInputFocused = false;
              router.navigate("/invo/:invocationId", {
                invocationId: row.invocationId,
              });
            };
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
  attachListHandlers(pages);
  return html`<div class="log-page">
    ${styles}
    <div class="log-top">
      <div class="log-title">action log</div>
      <div class="log-pager">
        <input class="log-page-input" id="log-page" value="${logPage}" maxlength="3" inputmode="numeric" />
        <div class="log-page-btn" id="log-prev">&lt;</div>
        <div class="log-page-btn" id="log-next">&gt;</div>
      </div>
    </div>
    ${total
      ? flatten(items)
      : html`<div class="log-empty">${isTx ? "no sends" : "no tool calls"}</div>`}
    <div class="log-tabs">
      <div class="log-tab${logTab === "history" ? " log-tab-active" : ""}" id="log-tab-history">history</div>
      <div class="log-tab${logTab === "success" ? " log-tab-active" : ""}" id="log-tab-success">success</div>
      <div class="log-tab${logTab === "discarded" ? " log-tab-active" : ""}" id="log-tab-discarded">discarded</div>
      <div class="log-tab${logTab === "txlog" ? " log-tab-active" : ""}" id="log-tab-txlog">txlog</div>
    </div>
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
  document.onkeydown = null;
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
