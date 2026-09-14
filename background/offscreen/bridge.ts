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
chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((error) => console.error(error));

// chrome: actionlog msg bus handling may run in offscreen document (openwallets results in mco with al instance);
// sidebar open event has to be handled from this service worker. (sidepanel open only available here as per chrome rules)
chrome.runtime.onMessage.addListener(
  (msg: { kind?: string }, sender) => {
    if (msg.kind !== "openSidebar") return;
    const windowId = sender.tab?.windowId;
    if (!windowId) return;
    chrome.sidePanel.open({ windowId });
  },
);
