export function actionLogPageUrl(invocationId?: string, wallet?: string): string {
  const url = new URL(browser.runtime.getURL("actionlog.html"));
  if (wallet) url.searchParams.set("wallet", wallet);
  url.hash = invocationId ? `/invo/${invocationId}` : "/";
  return url.href;
}

async function actionLogTabs() {
  const base = browser.runtime.getURL("actionlog.html");
  return browser.tabs.query({ url: `${base}*` }) as Promise<
    { id?: number; url?: string }[]
  >;
}

export async function toggleActionLogPage(wallet?: string) {
  const open = await actionLogTabs();
  const ids = open.map((t) => t.id).filter((id): id is number => id != null);
  if (ids.length) {
    await browser.tabs.remove(ids);
    return;
  }
  window.open(actionLogPageUrl(undefined, wallet));
}

export async function openActionLogPage(invocationId?: string, wallet?: string) {
  const open = await actionLogTabs();
  const tab = open[0];
  if (tab?.id != null) {
    // Change only the route. Keep the open page and its in-memory filter.
    const url = new URL(tab.url ?? actionLogPageUrl(undefined, wallet));
    url.hash = invocationId ? `/invo/${invocationId}` : "/";
    await browser.tabs.update(tab.id, {
      ...(url.href !== tab.url ? { url: url.href } : {}),
      active: true,
    });
    return;
  }
  window.open(actionLogPageUrl(invocationId, wallet));
}
