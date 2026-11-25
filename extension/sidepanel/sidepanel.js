// Finds a side panel element by its HTML id.
const $ = (id) => document.getElementById(id);
const chat = $("chat"), chips = $("chips"), question = $("question");
document.documentElement.dataset.theme = "cred";
question.classList.add("question-input");
let page = null, pageIncludesMoreReviews = false, currentTabId = null, activeUrl = "", busy = false, controller = null, lastQuestion = "";
let startupReady = Promise.resolve();
let messages = [];
const defaultBackend = "http://localhost:8000";

// Escapes HTML characters so page or model text is rendered safely.
const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
// Converts the small supported Markdown subset into displayable HTML.
const formatMarkdown = (value) => {
  const lines = escapeHtml(value).split("\n");
  let inList = false, html = "";
  for (const line of lines) {
    const match = line.match(/^\s*[-*]\s+(.*)$/);
    if (match) {
      if (!inList) { html += "<ul>"; inList = true; }
      html += `<li>${match[1].replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")}</li>`;
    } else {
      if (inList) { html += "</ul>"; inList = false; }
      if (line.trim()) html += `<p>${line.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")}</p>`;
    }
  }
  if (inList) html += "</ul>";
  return html;
};
// Keeps the newest chat message visible.
const scrollBottom = () => { chat.scrollTop = chat.scrollHeight; };
// Removes the welcome message when the first real message is added.
const removeEmpty = () => chat.querySelector(".empty-state")?.remove();
// Creates a separate session-storage key for each page URL.
const storageKey = () => `pagechat:${activeUrl}`;

// Adds a user or assistant message to the chat and returns its elements.
function addMessage(role, content, { error = false, retry = false } = {}) {
  removeEmpty();
  const row = document.createElement("div");
  row.className = `message-row ${role} ${error ? "error" : ""}`;
  const bubble = document.createElement("div");
  bubble.className = "bubble";
  bubble.innerHTML = formatMarkdown(content);
  row.append(bubble);
  if (role === "bot") {
    const tools = document.createElement("div");
    tools.className = "message-tools";
    const copy = document.createElement("button");
    copy.className = "tool-button";
    copy.textContent = "Copy";
    copy.addEventListener("click", async () => {
      await navigator.clipboard.writeText(content);
      copy.textContent = "Copied ✓";
      setTimeout(() => { copy.textContent = "Copy"; }, 1000);
    });
    tools.append(copy);
    if (retry) {
      const retryButton = document.createElement("button");
      retryButton.className = "retry-button";
      retryButton.textContent = "Retry";
      retryButton.addEventListener("click", () => ask(lastQuestion));
      tools.append(retryButton);
    }
    row.append(tools);
  }
  chat.append(row);
  scrollBottom();
  return { row, bubble };
}

// Saves the current page's recent chat messages in this browser session.
async function saveMessages() {
  if (!activeUrl) return;
  await chrome.storage.session.set({ [storageKey()]: messages.slice(-60) });
}
// Loads this page's saved conversation or shows the welcome message.
async function loadMessages() {
  messages = activeUrl ? (await chrome.storage.session.get(storageKey()))[storageKey()] || [] : [];
  chat.replaceChildren();
  if (!messages.length) {
    chat.innerHTML = '<div class="empty-state"><strong>What is going on here?</strong><p>Ask about the page you have open. Page text stays on this computer until you ask a question.</p><ul><li>Give me the short version</li><li>What should I pay attention to?</li><li>What are the pros and cons?</li></ul></div>';
  } else {
    for (const item of messages) addMessage(item.role, item.content, { error: item.error });
  }
}
// Updates the small page-status label in the panel header.
function setStatus(text) { $("page-chip").textContent = text; }
// Reads the saved backend address or uses the local default.
async function backendUrl() {
  const value = (await chrome.storage.local.get("backendUrl")).backendUrl;
  return (value || defaultBackend).replace(/\/$/, "");
}
// Shows quick-question buttons suited to the detected page type.
function updateChips() {
  const type = page?.page_type || "other";
  setStatus(page ? `${page.site} · ${type}` : (activeUrl ? "Ready when you are" : "No active page"));
  const labels = type === "shopping"
    ? ["What's going on here?", "Pros & Cons", "Reviews summary", "Worth buying?", "Compare"]
    : type === "movie"
      ? ["Spoiler-free summary", "Critics vs audience", "What are the pros and cons?"]
      : ["What's going on here?", "Summarize this page", "What should I pay attention to?"];
  chips.replaceChildren();
  for (const label of labels) {
    const button = document.createElement("button");
    button.className = "chip";
    button.textContent = label;
    button.addEventListener("click", () => label === "Compare" ? compareCurrent() : ask(label));
    chips.append(button);
  }
}

// Requests readable page data from the background script and caches it.
async function extract(force = false, tabId = null, includeMoreReviews = $("more-reviews").checked) {
  await syncActivePage(tabId);
  if (page && !force && (!includeMoreReviews || pageIncludesMoreReviews)) return page;
  setStatus("Reading page…");
  const result = await chrome.runtime.sendMessage({ type: "EXTRACT", tabId: currentTabId, moreReviews: includeMoreReviews });
  if (result?.blocked) throw new Error(result.reason || "PageChat cannot read this page.");
  if (result?.error) throw new Error(result.error);
  page = result;
  pageIncludesMoreReviews = includeMoreReviews;
  if (!page.fallback_text?.trim() && !Object.values(page.structured || {}).some((value) => Array.isArray(value) ? value.length : value)) {
    page = null;
    throw new Error("This page has no readable text. Try refreshing the page or opening a different page.");
  }
  page.fallback_text = (page.fallback_text || "").slice(0, 20000);
  page.jsonld = Array.isArray(page.jsonld) ? page.jsonld : [page.jsonld].filter(Boolean);
  const serialized = JSON.stringify(page);
  if (serialized.length > 30000) {
    page.fallback_text = page.fallback_text.slice(0, Math.max(0, 30000 - (serialized.length - page.fallback_text.length)));
  }
  updateChips();
  return page;
}

// Finds the selected browser tab, preferring the last focused window.
async function getActiveTab() {
  let [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tab?.id) [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

// Gets the active page URL and loads its page-specific chat history.
async function syncActivePage(tabId = null) {
  const tab = tabId ? await chrome.tabs.get(tabId) : await getActiveTab();
  if (!tab?.id) throw new Error("I can’t find the active tab. Open a webpage, then reopen PageChat from that tab.");
  let info = tab.url ? { tabId: tab.id, url: tab.url, title: tab.title || "" } : null;
  if (!info) {
    try {
      info = await chrome.runtime.sendMessage({ type: "PAGE_INFO", tabId: tab.id });
      console.log("[PageChat] PAGE_INFO fallback response", info);
    } catch (error) {
      console.error("[PageChat] PAGE_INFO fallback failed", error);
      throw new Error(`Could not get page information: ${error.message}`);
    }
  }
  console.log("[PageChat] active page info", info);
  if (!info) throw new Error("Chrome returned no information for the active tab.");
  if (info?.error) throw new Error(info.error);
  if (info?.blocked) throw new Error(info.reason || "PageChat cannot access this tab.");
  if (!/^https?:\/\//i.test(info?.url || "")) {
    const detected = info?.url ? ` Chrome detected: ${info.url}` : " Chrome did not return a page URL.";
    throw new Error(`Open a regular http or https webpage before asking PageChat.${detected}`);
  }
  currentTabId = info.tabId;
  if (info.url !== activeUrl) {
    activeUrl = info.url;
    page = null;
    pageIncludesMoreReviews = false;
    await loadMessages();
    updateChips();
  }
}

// Prepares a short recent conversation history to send with a question.
function historyForRequest() {
  return messages.slice(0, -1).slice(-6).map(({ role, content }) => ({ role, content: content.slice(0, 3000) }));
}
// Sends the user's question and extracted page context to the backend.
async function ask(rawQuestion) {
  const asked = String(rawQuestion || "").trim();
  if (!asked || busy) return;
  try {
    await startupReady;
    await syncActivePage();
  } catch (error) {
    lastQuestion = asked;
    question.value = "";
    resizeInput();
    addMessage("user", asked);
    messages.push({ role: "user", content: asked });
    await saveMessages();
    addMessage("bot", error.message, { error: true });
    return;
  }
  lastQuestion = asked;
  question.value = "";
  resizeInput();
  addMessage("user", asked);
  messages.push({ role: "user", content: asked });
  await saveMessages();
  busy = true; controller = new AbortController();
  $("send").hidden = true; $("stop").hidden = false;
  let answer = "", timedOut = false, timeoutId = null;
  const pending = addMessage("bot", "");
  pending.bubble.innerHTML = '<span class="dots" aria-label="Thinking"><i></i><i></i><i></i></span>';
  try {
    const wantsReviews = /\b(?:reviews?|complaints?)\b/i.test(asked);
    const data = await extract(wantsReviews && !pageIncludesMoreReviews, null, $("more-reviews").checked || wantsReviews);
    const backend = await backendUrl();
    const payload = { ...data, question: asked, history: historyForRequest() };
    payload.structured = { ...payload.structured };
    let body = JSON.stringify(payload);
    while (body.length > 30000) {
      if (payload.fallback_text.length) {
        payload.fallback_text = payload.fallback_text.slice(0, Math.max(0, payload.fallback_text.length - Math.max(100, body.length - 30000)));
      } else if (payload.structured.reviews?.length) {
        payload.structured.reviews = payload.structured.reviews.slice(0, -1);
      } else if (payload.structured.specs?.length) {
        payload.structured.specs = payload.structured.specs.slice(0, -1);
      } else if (payload.structured.synopsis?.length) {
        payload.structured.synopsis = payload.structured.synopsis.slice(0, Math.max(0, payload.structured.synopsis.length - Math.max(100, body.length - 30000)));
      } else if (payload.structured.title?.length) {
        payload.structured.title = payload.structured.title.slice(0, Math.max(0, payload.structured.title.length - Math.max(100, body.length - 30000)));
      } else if (payload.jsonld?.length && typeof payload.jsonld[0] === "string" && payload.jsonld[0].length) {
        payload.jsonld[0] = payload.jsonld[0].slice(0, Math.max(0, payload.jsonld[0].length - Math.max(100, body.length - 30000)));
      } else if (payload.jsonld?.length) {
        payload.jsonld = [];
      } else break;
      body = JSON.stringify(payload);
    }
    if (body.length > 30000) throw new Error("This page has too much structured data to send. Try a page with less content.");
    timeoutId = setTimeout(() => { timedOut = true; controller?.abort(); }, 180000);
    const response = await fetch(`${backend}/chat`, { method: "POST", headers: { "Content-Type": "application/json" }, body, signal: controller.signal });
    if (!response.ok) {
      let reason = `The assistant returned an error (${response.status}).`;
      try { reason = (await response.json()).error || reason; } catch {}
      throw new Error(reason);
    }
    if (!response.body) throw new Error("The server returned an empty response.");
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      answer += decoder.decode(value, { stream: true });
      pending.bubble.innerHTML = formatMarkdown(answer);
      scrollBottom();
    }
    answer += decoder.decode();
    clearTimeout(timeoutId);
    if (!answer.trim()) throw new Error("The server returned an empty answer. Try again.");
    pending.row.remove();
    addMessage("bot", answer);
    messages.push({ role: "assistant", content: answer });
    await saveMessages();
  } catch (error) {
    clearTimeout(timeoutId);
    pending.row.remove();
    if (error.name === "AbortError" && timedOut) {
      const reason = "That took too long (3 minutes). Try again with fewer page details or reviews.";
      addMessage("bot", reason, { error: true, retry: true });
    } else if (error.name === "AbortError") {
      if (answer.trim()) { addMessage("bot", answer); messages.push({ role: "assistant", content: answer }); await saveMessages(); }
    } else {
      const friendly = /Failed to fetch|NetworkError/i.test(error.message) ? "PageChat could not reach the backend. Start it with uvicorn main:app --reload --port 8000, then retry." : /timed out|timeout/i.test(error.message) ? "That took too long. Try again with fewer page details or reviews." : error.message;
      addMessage("bot", friendly, { error: true, retry: true });
    }
  } finally {
    busy = false; controller = null; $("send").hidden = false; $("stop").hidden = true; $("send").disabled = !question.value.trim();
    if (deferredAutoRefreshTab) {
      const { tabId, force } = deferredAutoRefreshTab;
      deferredAutoRefreshTab = null;
      refreshPageForTab(tabId, force);
    }
  }
}

// Saves the current product and displays it alongside the previous one.
async function compareCurrent() {
  try {
    const data = await extract();
    const saved = (await chrome.storage.local.get("savedProducts")).savedProducts || [];
    const current = { url: data.url, title: data.title, price: data.structured?.price || "Not found", rating: data.structured?.rating || "Not found", specs: data.structured?.specs || [] };
    const list = [...saved.filter((item) => item.url !== current.url), current].slice(-6);
    await chrome.storage.local.set({ savedProducts: list });
    if (list.length < 2) { addMessage("bot", "Product saved. Open another product and choose Compare to see them side by side."); return; }
    removeEmpty();
    const row = document.createElement("div"); row.className = "message-row bot";
    const bubble = document.createElement("div"); bubble.className = "bubble";
    const table = document.createElement("table");
    table.style.cssText = "border-collapse:collapse;font-size:12px;max-width:100%;";
    const rows = [["Product", ...list.slice(-2).map((x) => x.title)], ["Price", ...list.slice(-2).map((x) => x.price)], ["Rating", ...list.slice(-2).map((x) => x.rating)], ["Specs", ...list.slice(-2).map((x) => (x.specs || []).slice(0, 4).join(", ") || "Not found")]];
    for (const values of rows) {
      const tr = document.createElement("tr");
      for (const value of values) {
        const cell = document.createElement(values[0] === "Product" ? "th" : "td");
        cell.textContent = value;
        cell.style.cssText = "border:1px solid #888;padding:5px;vertical-align:top;text-align:left;";
        tr.append(cell);
      }
      table.append(tr);
    }
    bubble.append(table); row.append(bubble); chat.append(row); scrollBottom();
  } catch (error) { addMessage("bot", error.message, { error: true }); }
}

// Resizes the question box to fit its text, up to a fixed maximum height.
function resizeInput() { question.style.height = "auto"; question.style.height = `${Math.min(question.scrollHeight, 120)}px`; }
// Updates the send button and input height as the user types.
question.addEventListener("input", () => {
  resizeInput();
  $("send").disabled = !question.value.trim() || busy;
});
// Sends the question when Enter is pressed without Shift.
question.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); ask(question.value); }
});
// Starts a chat request when the user clicks Send.
$("send").addEventListener("click", () => ask(question.value));
// Cancels the current backend request when Stop is clicked.
$("stop").addEventListener("click", () => controller?.abort());
// Re-extracts the current page when the refresh button is clicked.
$("refresh").addEventListener("click", async () => {
  page = null;
  try { await extract(true); addMessage("bot", "Page data refreshed. Ask away."); }
  catch (error) { setStatus("Could not read page"); addMessage("bot", error.message, { error: true }); }
});
// Opens settings and displays the currently configured backend address.
$("settings").addEventListener("click", async () => {
  $("settings-row").hidden = !$("settings-row").hidden;
  $("backend-url").value = await backendUrl();
});
// Saves the backend address entered in the settings row.
$("save-settings").addEventListener("click", async () => {
  const value = $("backend-url").value.trim().replace(/\/$/, "");
  if (value) await chrome.storage.local.set({ backendUrl: value });
  $("settings-row").hidden = true;
});
// Clears this page's saved chat and restores the welcome display.
$("clear-chat").addEventListener("click", async () => { messages = []; await chrome.storage.session.remove(storageKey()); await loadMessages(); });

// Synchronizes the panel's page state when the active tab changes.
async function updateActiveTab() {
  const tab = await getActiveTab();
  currentTabId = tab?.id || null;
  const newUrl = tab?.url || "";
  if (newUrl !== activeUrl) {
    activeUrl = newUrl; page = null; pageIncludesMoreReviews = false;
    await loadMessages();
  }
  updateChips();
}
let deferredAutoRefreshTab = null;
// Refreshes extracted page data when a tab loads or its URL changes.
async function refreshPageForTab(tabId, force = false) {
  if (!tabId) return;
  if (busy) {
    deferredAutoRefreshTab = { tabId, force: force || deferredAutoRefreshTab?.force };
    return;
  }
  currentTabId = tabId;
  try {
    await syncActivePage(tabId);
    if (!force && page?.url === activeUrl) return;
    page = null;
    pageIncludesMoreReviews = false;
    await extract(true, tabId);
    setStatus(`${page.site} · ${page.page_type}`);
  } catch (error) {
    setStatus("Could not read page");
  }
}

// Refreshes the panel after the user activates another browser tab.
chrome.tabs.onActivated.addListener(({ tabId }) => { refreshPageForTab(tabId); });
// Re-extracts page data when the active tab finishes loading.
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (tabId === currentTabId && changeInfo.status === "complete") refreshPageForTab(tabId, true);
});
// Handles notifications that a page changed its URL without reloading.
chrome.runtime.onMessage.addListener((message) => {
  if (message?.type !== "ACTIVE_PAGE_CHANGED" || !message.tabId) return;
  getActiveTab().then((tab) => {
    if (tab?.id === message.tabId) refreshPageForTab(message.tabId, true);
  });
});
// Initializes the selected tab, backend setting, and page extraction.
startupReady = (async () => {
  await updateActiveTab();
  const stored = await chrome.storage.local.get("backendUrl");
  if (!stored.backendUrl) await chrome.storage.local.set({ backendUrl: defaultBackend });
  if (currentTabId) await refreshPageForTab(currentTabId);
})();
