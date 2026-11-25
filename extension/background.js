const BLOCKED_PATTERNS = [
  /(^|\.)chrome:\/\//i, /bank|banking|wallet|paypal|venmo|stripe/i, /mail|email|inbox|gmail|outlook|protonmail/i,
  /password|sign-?in|log-?in|auth/i, /payment|checkout|billing|credit.?card/i
];
const ACTIVE_TAB_KEY = "pagechatActiveTabId";

// Injects the page-reading scripts into a tab and returns extracted data.
async function extractFromTab(tabId, options = {}) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["lib/Readability.js", "selectors.js", "content.js"]
    });
    const [result] = await chrome.scripting.executeScript({
      target: { tabId },
      func: async (extractOptions) => await window.getPageData(extractOptions),
      args: [options]
    });
    if (!result?.result) return { error: "Page extraction returned no data." };
    return result.result;
  } catch (error) {
    return { error: error?.message || "Could not inject the page extractor." };
  }
}

// Opens the side panel for the clicked tab and remembers that tab's id.
chrome.action.onClicked.addListener(async (tab) => {
  if (!tab?.id) return;
  const openPanel = chrome.sidePanel.open({ tabId: tab.id });
  const rememberTab = chrome.storage.session.set({ [ACTIVE_TAB_KEY]: tab.id });
  await Promise.all([openPanel, rememberTab]);
});

// Remembers whichever browser tab the user most recently selected.
chrome.tabs.onActivated.addListener(({ tabId }) => {
  chrome.storage.session.set({ [ACTIVE_TAB_KEY]: tabId });
});

// Handles page URL notifications and side-panel page-info/extraction requests.
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log("[PageChat] incoming message", message);
  if (message?.type === "URL_CHANGED") {
    const tabId = sender.tab?.id;
    if (!tabId || !message.url) return;
    chrome.storage.session.set({ [ACTIVE_TAB_KEY]: tabId });
    chrome.runtime.sendMessage({ type: "ACTIVE_PAGE_CHANGED", tabId, url: message.url }).catch(() => {});
    sendResponse({ ok: true });
    return;
  }
  if (!["EXTRACT", "PAGE_INFO"].includes(message?.type)) return;
  (async () => {
    const reply = (value) => {
      console.log("[PageChat] response", message.type, value);
      sendResponse(value);
    };
    try {
      const saved = await chrome.storage.session.get(ACTIVE_TAB_KEY);
      const tabId = message.tabId || saved[ACTIVE_TAB_KEY];
      let tab = null;
      if (tabId) {
        try { tab = await chrome.tabs.get(tabId); } catch { /* The remembered tab may have been closed. */ }
      }
      if (!tab) tab = (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0];
      console.log("[PageChat] selected tab", tab);
      if (!tab?.id) return reply({ blocked: true, reason: "No active page is available." });
      let pageUrl = tab.url;
      if (!pageUrl) {
        const [pageInfo] = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: () => ({ url: window.location.href, documentUrl: document.URL })
        });
        pageUrl = pageInfo?.result?.url || pageInfo?.result?.documentUrl;
      }
      if (!pageUrl) return reply({ blocked: true, reason: "Chrome did not provide access to the active page." });
      if (message.type === "PAGE_INFO") return reply({ tabId: tab.id, url: pageUrl, title: tab.title || "" });
      const url = new URL(pageUrl);
      if (["chrome:", "chrome-extension:", "edge:", "about:"].includes(url.protocol) || BLOCKED_PATTERNS.some((pattern) => pattern.test(url.href))) {
        return reply({ blocked: true, reason: "PageChat is paused on browser, sign-in, banking, email, and payment pages." });
      }
      reply(await extractFromTab(tab.id, {
        moreReviews: Boolean(message.moreReviews),
        debug: Boolean(message.debug)
      }));
    } catch (error) {
      reply({ error: error?.message || "Could not read this page." });
    }
  })();
  return true;
});
