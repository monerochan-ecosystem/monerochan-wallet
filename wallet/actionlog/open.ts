export function actionLogPageUrl(invocationId?: string): string {
  const base = browser.runtime.getURL("actionlog.html");
  if (invocationId) return `${base}#/invo/${invocationId}`;
  return `${base}#/`;
}

async function actionLogTabs() {
  const base = browser.runtime.getURL("actionlog.html");
  return browser.tabs.query({ url: `${base}*` });
}

export async function toggleActionLogPage() {
  const open = await actionLogTabs();
  const ids = open.map((t) => t.id).filter((id): id is number => id != null);
  if (ids.length) {
    await browser.tabs.remove(ids);
    return;
  }
  window.open(actionLogPageUrl());
}

export async function openActionLogPage(invocationId?: string) {
  const url = actionLogPageUrl(invocationId);
  const open = await actionLogTabs();
  const id = open[0]?.id;
  if (id != null) {
    await browser.tabs.update(id, { url, active: true });
    return;
  }
  window.open(url);
}
