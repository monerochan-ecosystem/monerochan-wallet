import {
  getToolUiByPermissions,
  type ActionLogEvent,
  type InvocationState,
} from "@spirobel/monero-wallet-api";
import { flatten, html, type MiniHtmlString } from "../../mininext/mininext";
import { cachedBranch, ensureBranch, openRows } from "./init";
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
  .log-row {
    border: 2px solid rgba(255, 255, 255, 0.2);
    border-radius: 4px;
    padding: 8px;
    margin-bottom: 8px;
    cursor: pointer;
  }
  .log-row:hover {
    border-color: rgba(255, 255, 255, 0.45);
  }
  .log-meta {
    color: rgba(255, 255, 255, 0.55);
    font-size: 12px;
    margin-top: 4px;
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
  }
</style>`;

function listPage(): MiniHtmlString {
  const rows = openRows();
  const items = rows.map((row) => {
    const id = `row-${row.invocationId}`;
    const el = document.getElementById(id);
    if (el) {
      el.onclick = () =>
        router.navigate("/invo/:invocationId", {
          invocationId: row.invocationId,
        });
    }
    const status = row.lastType === "execute_error" ? "failed" : "in progress";
    return html`<div class="log-row" id="${id}">
      <div class="log-status">${status}</div>
      <div>${titleFor(row)} · ${row.stage} · ${row.lastType}</div>
      <div class="log-meta">
        ${row.error ?? ""} ${row.amount ?? ""} ${row.address ?? ""}
        ${row.context_domain ?? ""} ${formatTime(row.timestamp)}
      </div>
    </div>`;
  });
  return html`<div class="log-page">
    ${styles}
    <div class="log-title">action log</div>
    ${rows.length
      ? flatten(items)
      : html`<div class="log-empty">no tool calls in progress</div>`}
  </div>`;
}

function eventLine(ev: ActionLogEvent): MiniHtmlString {
  return html`<div class="log-event">
    ${formatTime(ev.timestamp)} ${ev.type} ${ev.stage}
    ${ev.valid ?? ""} ${ev.ok === undefined ? "" : ev.ok ? "ok" : "fail"}
    ${ev.error ? ` · ${ev.error}` : ""}
  </div>`;
}

function detailPage(invocationId: string): MiniHtmlString {
  ensureBranch(invocationId);
  const inProgress = openRows().some((r) => r.invocationId === invocationId);
  const branch = cachedBranch(invocationId);
  const home = document.getElementById("log-home");
  if (home) home.onclick = () => router.navigate("/");

  const head: InvocationState | ActionLogEvent | null =
    openRows().find((r) => r.invocationId === invocationId) ??
    branch.at(-1) ??
    null;
  const last = branch.at(-1);
  const status =
    last?.type === "execute_error" || (!inProgress && last?.ok === false)
      ? "failed"
      : inProgress
        ? "in progress"
        : branch.length
          ? "done"
          : "";

  return html`<div class="log-page">
    ${styles}
    <div class="log-home" id="log-home">action log</div>
    <div class="log-title">${head ? titleFor(head) : "tool call"}</div>
    <div class="log-status">${status}</div>
    <div class="log-meta">${formatTime(head?.timestamp)} ${invocationId}</div>
    ${branch.length
      ? flatten(branch.map(eventLine))
      : html`<div class="log-empty">loading events</div>`}
  </div>`;
}

export function actionLogList() {
  return listPage();
}

export function actionLogDetail(params: { invocationId: string }) {
  return detailPage(params.invocationId);
}
