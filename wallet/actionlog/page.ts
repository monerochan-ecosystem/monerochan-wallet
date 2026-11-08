import {
  getToolUiByPermissions,
  type ActionLogEvent,
  type InvocationState,
  type TxLog,
} from "@spirobel/monero-wallet-api/unpacked";
import { flatten, html, type MiniHtmlString } from "../../mininext/mininext";
import { actionLog, actionLogHeight, actionLogWallets } from "./init";
import { router } from "./router";
import { formatConfirmationEta, minedSpendHeight, txLogConfirmationEta } from "../sidebar/segments/toolInfo";

export type LogWallet = {
  primary_address: string;
  wallet_route?: string;
  wallet_name?: string;
};

type InvocationWallet = Pick<
  InvocationState,
  "toolId" | "wallet_to_send_from_pa" | "wallet_slot" | "context_domain"
>;

export function matchesWallet(
  row: InvocationWallet,
  selectedWallet: string,
  wallets: LogWallet[],
  txWallet?: string,
): boolean {
  if (!selectedWallet) return true;
  const source = row.wallet_to_send_from_pa || txWallet;
  if (source) return source === selectedWallet;
  if (row.toolId !== "002" || row.context_domain === undefined) return false;

  // share calls use the main wallet for the page domain and slot
  const route = `main/${row.context_domain}/single/${row.wallet_slot ?? 0}`;
  return wallets.some(
    (wallet) =>
      wallet.primary_address === selectedWallet && wallet.wallet_route === route,
  );
}

export function walletFilterOptions(wallets: LogWallet[]) {
  const routes = new Map<string, string>();
  for (const wallet of wallets) {
    const route = wallet.wallet_route?.trim();
    if (wallet.primary_address && route) routes.set(wallet.primary_address, route);
  }
  return [
    { value: "", label: "all wallets" },
    ...[...routes].map(([value, label]) => ({ value, label })),
  ];
}

let walletFilter = new URLSearchParams(globalThis.window?.location?.search).get("wallet") ?? "";

type LogTab = "history" | "success" | "discarded" | "txlog";
let logTab: LogTab = "history";
let logPage = 1;
let pageInputFocused = false;
let edgeLeftCount = 0;
let edgeRightCount = 0;
const PAGE_SIZE = 5;

type TxLogRow = {
  wallet: string;
  log: TxLog & { index: number };
  minedHeight?: number;
};

function txLogs(): TxLogRow[] {
  return actionLogWallets().flatMap((wallet) => {
    const cache = wallet.cache;
    return wallet.tx_logs.map((log, index) => {
      const inputs = (log.inputs_index ?? []).flatMap((id) => {
        const input = cache.outputs[id];
        const owner = cache.pending_spent_utxos?.[id];
        return input && (owner === undefined || owner === index) ? [input] : [];
      });
      return {
        wallet: wallet.primary_address,
        log: { ...log, index },
        minedHeight: minedSpendHeight(inputs),
      };
    });
  });
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
    margin: 0 auto;
    padding: 0 16px 32px;
  }
  .log-tx-controls {
    display: flex;
    gap: 12px;
    flex: 1 1 290px;
    min-width: 0;
  }
  .log-wallet-filter {
    min-width: 0;
    flex: 1;
    padding: 10px 8px;
    border: 2px solid rgba(255, 255, 255, 0.3);
    border-radius: 4px;
    background: #333;
    color: white;
    font: inherit;
    font-size: 16px;
    color-scheme: dark;
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
  .log-jump {
    cursor: pointer;
    user-select: none;
    display: inline-block;
    margin-top: 8px;
    margin-right: 8px;
    border: 2px solid rgba(255, 255, 255, 0.3);
    border-radius: 4px;
    padding: 2px 8px;
    color: rgba(255, 255, 255, 0.85);
  }
  .log-jump:hover {
    color: white;
    border-color: rgba(255, 255, 255, 0.6);
  }
  .log-info .log-jump {
    margin-bottom: 4px;
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
  a.log-info-value {
    color: white;
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

function tabRows(logs: TxLogRow[]): InvocationState[] {
  const all = (actionLog()?.invocations() ?? [])
    .filter((row) =>
      matchesWallet(
        row,
        walletFilter,
        actionLogWallets(),
        txlogForInvocation(row.invocationId, logs)?.wallet,
      ),
    )
    .sort((a, b) => (b.timestamp ?? "").localeCompare(a.timestamp ?? ""));
  if (logTab === "success")
    return all.filter((r) => r.status === "done");
  if (logTab === "discarded")
    return all.filter(
      (r) => r.status === "dismissed" || r.status === "aborted",
    );
  return all;
}

function txlogRows(logs: TxLogRow[]): TxLogRow[] {
  return logs
    .filter((row) => !walletFilter || row.wallet === walletFilter)
    .sort((a, b) => b.log.timestamp - a.log.timestamp);
}

function txlogForInvocation(invocationId: string, logs: TxLogRow[]): TxLogRow | null {
  const rows = logs.filter(
    (row) => row.log.invocationId === invocationId,
  );
  rows.sort((a, b) => b.log.timestamp - a.log.timestamp);
  return rows[0] ?? null;
}

function openToolCall(invocationId: string) {
  pageInputFocused = false;
  router.navigate("/invo/:invocationId", { invocationId });
}

function openTxRow(row: TxLogRow) {
  pageInputFocused = false;
  router.navigate("/tx/:wallet/:index", {
    wallet: row.wallet,
    index: String(row.log.index),
  });
}

function txStatus(log: TxLogRow["log"]): string {
  if (!log.sendResult && !log.error) return "sent tx to node";
  if (log.sendResult?.status) return log.sendResult.status;
  if (log.error) return "failed";
  return "no result";
}

function txEtaLine(row: TxLogRow) {
  const eta = txLogConfirmationEta(row.log, actionLogHeight(), row.minedHeight);
  return eta
    ? html`<div class="log-meta">confirmation ETA: ${formatConfirmationEta(eta)}</div>`
    : "";
}

function txlogItem(row: TxLogRow) {
  const log = row.log;
  const id = `txlog-${row.wallet.slice(0, 8)}-${log.index}`;
  const toolBtn = `toolbtn-${row.wallet.slice(0, 8)}-${log.index}`;
  const payments = (log.payments ?? [])
    .map((p) => `${p.amount ?? ""} ${p.address ?? ""}`)
    .join(" | ");
  const jump = document.getElementById(toolBtn);
  if (jump && log.invocationId) {
    const invocationId = log.invocationId;
    jump.onclick = (ev) => {
      ev.stopPropagation();
      openToolCall(invocationId);
    };
  }
  return html`<div class="log-row" id="${id}">
    <div class="log-status">${txStatus(log)}</div>
    <div>${formatTime(log.timestamp)}</div>
    <div class="log-meta">
      ${log.error ?? ""} ${payments}
      ${log.inputs_index?.length
        ? html`<span class="log-address">inputs: ${log.inputs_index.join(", ")}</span>`
        : ""}
      <span class="log-address">wallet: ${row.wallet.slice(0, 12)}… height: ${log.height ?? ""}</span>
    </div>
    ${txEtaLine(row)}
    ${log.invocationId
      ? html`<div class="log-jump" id="${toolBtn}">tool call</div>`
      : ""}
  </div>`;
}

function walletDropdown(): MiniHtmlString {
  const select = document.getElementById("log-wallet") as HTMLSelectElement | null;
  if (select) {
    const options = walletFilterOptions(actionLogWallets());
    // Set native options directly. The renderer uses spans for dynamic text.
    if (
      select.options.length !== options.length ||
      options.some((option, index) =>
        select.options[index]?.value !== option.value ||
        select.options[index]?.text !== option.label,
      )
    ) {
      select.replaceChildren(
        ...options.map((option) => new Option(option.label, option.value)),
      );
    }
    if (select.value !== walletFilter) select.value = walletFilter;
    select.title = select.selectedOptions[0]?.text ?? "";
    select.onfocus = () => {
      pageInputFocused = false;
    };
    select.onchange = () => {
      walletFilter = select.value;
      logPage = 1;
      pageInputFocused = false;
    };
  }
  return html`<select class="log-wallet-filter" id="log-wallet" aria-label="wallet"></select>`;
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
      };
  }
  const prev = document.getElementById("log-prev");
  if (prev)
    prev.onclick = () => {
      pageInputFocused = false;
      logPage = Math.max(1, logPage - 1);
    };
  const next = document.getElementById("log-next");
  if (next)
    next.onclick = () => {
      pageInputFocused = false;
      logPage = Math.min(pages, logPage + 1);
    };
  document.onkeydown = (ev) => {
    const tag = (ev.target as HTMLElement | null)?.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
    if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
    if (ev.key === "ArrowLeft" || ev.key === "ArrowRight") {
      pageInputFocused = false;
      logPage =
        ev.key === "ArrowLeft"
          ? Math.max(1, logPage - 1)
          : Math.min(pages, logPage + 1);
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
  if (walletFilter && !walletFilterOptions(actionLogWallets()).some((option) => option.value === walletFilter)) {
    walletFilter = "";
    logPage = 1;
  }
  const logs = txLogs();
  const isTx = logTab === "txlog";
  const transactions = isTx ? txlogRows(logs) : [];
  const calls = isTx ? [] : tabRows(logs);
  const total = isTx ? transactions.length : calls.length;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  if (logPage > pages) logPage = pages;
  if (logPage < 1) logPage = 1;
  const start = (logPage - 1) * PAGE_SIZE;
  const items = isTx
    ? transactions
        .slice(start, start + PAGE_SIZE)
        .map(txlogItem)
    : calls
        .slice(start, start + PAGE_SIZE)
        .map((row) => {
          const id = `row-${row.invocationId}`;
          const tx = txlogForInvocation(row.invocationId, logs);
          const txBtn = `txbtn-${row.invocationId}`;
          const el = document.getElementById(id);
          if (el) {
            el.onclick = () => {
              pageInputFocused = false;
              router.navigate("/invo/:invocationId", {
                invocationId: row.invocationId,
              });
            };
          }
          const jump = document.getElementById(txBtn);
          if (jump && tx) {
            jump.onclick = (ev) => {
              ev.stopPropagation();
              openTxRow(tx);
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
      ${row.toolId === "001" && tx ? txEtaLine(tx) : ""}
      ${tx ? html`<div class="log-jump" id="${txBtn}">txlog</div>` : ""}
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
    ${walletFilter && !isTx
      ? html`<div class="log-meta">Calls with no wallet are shown under all wallets.</div>`
      : ""}
    <div class="log-tabs">
      <div class="log-tab${logTab === "history" ? " log-tab-active" : ""}" id="log-tab-history">history</div>
      <div class="log-tab${logTab === "success" ? " log-tab-active" : ""}" id="log-tab-success">success</div>
      <div class="log-tab${logTab === "discarded" ? " log-tab-active" : ""}" id="log-tab-discarded">discarded</div>
      <div class="log-tx-controls">
        <div class="log-tab${logTab === "txlog" ? " log-tab-active" : ""}" id="log-tab-txlog">txlog</div>
        ${walletDropdown()}
      </div>
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

function addPageLink(rows: MiniHtmlString[], href?: string) {
  if (!href) return;
  rows.push(html`<div class="log-info-row">
    <div class="log-info-label">page</div>
    <a class="log-info-value" href="${href}" target="_blank" rel="noopener noreferrer">${href}</a>
  </div>`);
}

function invoRows(head?: InvocationState | null): MiniHtmlString[] {
  if (!head) return [];
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
  addPageLink(rows, head.context_href);
  addInfoRow(rows, "found in", head.found_in);
  addInfoRow(rows, "link", head.link);
  addInfoRow(rows, "link text", head.linkText);
  addInfoRow(rows, "time", formatTime(head.timestamp));
  return rows;
}

function invoInfo(
  rows: MiniHtmlString[],
  extra?: MiniHtmlString,
): MiniHtmlString {
  if (!rows.length && !extra) return html``;
  return html`<div class="log-info">${flatten(rows)}${extra ?? ""}</div>`;
}

function txInfoRows(log: TxLog, wallet: string): MiniHtmlString[] {
  const rows: MiniHtmlString[] = [];
  addInfoRow(rows, "time", formatTime(log.timestamp));
  const payments = (log.payments ?? [])
    .map((payment) => `${payment.amount ?? ""} ${payment.address ?? ""}`)
    .join(" | ");
  addInfoRow(rows, "result", [log.error ?? "", payments].filter(Boolean).join(" "));
  addInfoRow(rows, "inputs", (log.inputs_index ?? []).join(", "));
  addInfoRow(rows, "wallet", wallet);
  return rows;
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
  const tx = txlogForInvocation(invocationId, txLogs());
  const txBtn = document.getElementById("open-txlog");
  if (txBtn && tx) txBtn.onclick = () => openTxRow(tx);

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
    ${invoInfo(
      invoRows(head),
      tx ? html`<div class="log-jump" id="open-txlog">txlog</div>` : undefined,
    )}
    ${head?.toolId === "001" && tx ? txEtaLine(tx) : ""}
    ${evs.length
      ? flatten(evs.map(eventLine))
      : html`<div class="log-empty">no events</div>`}
    <div class="log-back" id="log-back">back</div>
  </div>`;
}

function txlogPage(wallet: string, index: string): MiniHtmlString {
  document.onkeydown = null;
  const home = document.getElementById("log-home");
  if (home) home.onclick = goHome;
  const back = document.getElementById("log-back");
  if (back) back.onclick = goHome;
  const row =
    txLogs().find(
      (item) => item.wallet === wallet && String(item.log.index) === index,
    ) ?? null;
  const toolBtn = document.getElementById("open-tool-call");
  if (toolBtn && row?.log.invocationId) {
    const invocationId = row.log.invocationId;
    toolBtn.onclick = () => openToolCall(invocationId);
  }
  const log = row?.log;
  return html`<div class="log-page">
    ${styles}
    <div class="log-home" id="log-home">action log</div>
    <div class="log-title">txlog</div>
    <div class="log-status">${log ? txStatus(log) : ""}</div>
    ${log
      ? invoInfo(
          txInfoRows(log, wallet),
          log.invocationId
            ? html`<div class="log-jump" id="open-tool-call">tool call</div>`
            : undefined,
        )
      : html`<div class="log-empty">no send</div>`}
    ${row ? txEtaLine(row) : ""}
    <div class="log-back" id="log-back">back</div>
  </div>`;
}

export function actionLogList() {
  return listPage();
}

export function actionLogDetail(params: { invocationId: string }) {
  return detailPage(params.invocationId);
}

export function actionLogTx(params: { wallet: string; index: string }) {
  return txlogPage(params.wallet, params.index);
}
