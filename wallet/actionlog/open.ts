if (typeof chrome !== "undefined" && typeof browser === "undefined") {
  (globalThis as unknown as { browser: typeof chrome }).browser = chrome;
}

export function actionLogPageUrl(invocationId?: string): string {
  const rt = (
    globalThis as unknown as {
      browser?: { runtime?: { getURL: (p: string) => string } };
    }
  ).browser?.runtime;
  const base = rt?.getURL("actionlog.html") ?? "actionlog.html";
  if (invocationId) return `${base}#/invo/${invocationId}`;
  return `${base}#/`;
}

const ACTION_LOG_WINDOW = "monerochan-actionlog";
let actionLogWin: Window | null = null;

export function toggleActionLogPage() {
  if (actionLogWin && !actionLogWin.closed) {
    actionLogWin.close();
    actionLogWin = null;
    return;
  }
  actionLogWin = window.open(actionLogPageUrl(), ACTION_LOG_WINDOW);
}

export function openActionLogPage(invocationId?: string) {
  const url = actionLogPageUrl(invocationId);
  if (actionLogWin && !actionLogWin.closed) {
    actionLogWin.location.href = url;
    actionLogWin.focus();
    return;
  }
  actionLogWin = window.open(url, ACTION_LOG_WINDOW);
}
