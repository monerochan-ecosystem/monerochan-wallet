import { deliverToolUrl } from "@spirobel/monero-wallet-api/tools/content";

import { parseToolLink } from "@spirobel/monero-wallet-api/tools";

// chrome MV3: offscreen document hosts the real background bundle
let creating: null | Promise<void> = null;
async function setupOffscreenDocument() {
  const existingContexts = await chrome.runtime.getContexts({
    contextTypes: ["OFFSCREEN_DOCUMENT"],
  });

  if (existingContexts.length > 0) {
    return;
  }

  if (creating) {
    await creating;
  } else {
    creating = chrome.offscreen.createDocument({
      url: "background.html",
      reasons: ["WORKERS"],
      justification: "worker for wallet syncing and scanning utxos.",
    });
    await creating;
    creating = null;
  }
}

chrome.runtime.onStartup.addListener(setupOffscreenDocument);
chrome.runtime.onInstalled.addListener(setupOffscreenDocument);
// chrome.runtime.reload fires neither of the above. 
setupOffscreenDocument();
chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((error) => console.error(error));

// chrome: actionlog msg bus handling may run in offscreen document (openwallets results in mco with al instance);
// sidebar open event has to be handled from this service worker. (sidepanel open only available here as per chrome rules)
chrome.runtime.onMessage.addListener(
  (msg: { kind?: string }, sender) => {
    if (msg.kind !== "openSidebar") return;
    // extension pages (toolconfirm) have no sender.tab. open for the focused window then.
    if (sender.tab?.windowId != null) {
      chrome.sidePanel.open({ windowId: sender.tab.windowId });
      return;
    }
    chrome.windows.getLastFocused().then((win) => {
      if (win.id != null) chrome.sidePanel.open({ windowId: win.id }).catch(() => {});
    }).catch(() => {});
  },
);

// a tool link opened as the tab url is no click, and a content script is too late. catch it before the page loads.
// the worker has no window.confirm, so the confirm page asks. only its OK delivers.
chrome.webNavigation.onBeforeNavigate.addListener((details) => {
  if (details.frameId !== 0) return;
  if (!parseToolLink(details.url)) return;
  chrome.tabs.create({ url: `toolconfirm.html?confirmToolUrl=${encodeURIComponent(details.url)}` });
  chrome.tabs.remove(details.tabId);
});

