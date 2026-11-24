(() => {
  if (!globalThis.__pageChatUrlWatcherInstalled) {
    globalThis.__pageChatUrlWatcherInstalled = true;
    let observedUrl = location.href, urlCheckTimer = null;
    const notifyIfUrlChanged = () => {
      clearTimeout(urlCheckTimer);
      urlCheckTimer = setTimeout(() => {
        const nextUrl = location.href;
        if (nextUrl === observedUrl) return;
        observedUrl = nextUrl;
        chrome.runtime.sendMessage({ type: "URL_CHANGED", url: nextUrl }).catch(() => {});
      }, 80);
    };
    new MutationObserver(notifyIfUrlChanged).observe(document.documentElement, { childList: true, subtree: true });
    addEventListener("popstate", notifyIfUrlChanged);
    addEventListener("hashchange", notifyIfUrlChanged);
  }

  const clean = (text) => String(text || "")
    .replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, "[email]")
    .replace(/(?:\+?\d[\d ().-]{7,}\d)/g, "[phone]")
    .replace(/\b(?:\d[ -]*?){13,19}\b/g, "[card]")
    .slice(0, 20000);
  const text = (selector) => {
    try { return [...document.querySelectorAll(selector)].map((node) => node.innerText?.trim()).filter(Boolean); }
    catch { return []; }
  };
  const value = (selector) => text(selector)[0] || "";
  const select = (sels, key) => sels?.[key] ? text(sels[key]) : [];
  const jsonData = () => [...document.querySelectorAll('script[type="application/ld+json"]')].flatMap((node) => {
    try {
      const parsed = JSON.parse(node.textContent);
      return Array.isArray(parsed) ? parsed : [parsed];
    } catch { return []; }
  }).slice(0, 30);
  const flatten = (data) => data.flatMap((item) => Array.isArray(item?.['@graph']) ? item['@graph'] : [item]);
  const waitFor = (selector, timeout = 2500) => new Promise((resolve) => {
    if (document.querySelector(selector)) return resolve(true);
    const observer = new MutationObserver(() => {
      if (document.querySelector(selector)) { observer.disconnect(); resolve(true); }
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
    setTimeout(() => { observer.disconnect(); resolve(false); }, timeout);
  });
  const detectSite = () => {
    const host = location.hostname.toLowerCase();
    if (host.includes("amazon.")) return "amazon";
    if (host.includes("flipkart.")) return "flipkart";
    if (host.includes("imdb.")) return "imdb";
    if (host.includes("rottentomatoes.")) return "rottentomatoes";
    return host.replace(/^www\./, "") || "other";
  };
  const detectPageType = (site, data, sels) => {
    const all = flatten(data);
    if (all.some((x) => /product/i.test(String(x['@type'] || ""))) || (site === "amazon" || site === "flipkart") && (value(sels?.price) && (value(sels?.addToCart) || all.length))) return "shopping";
    if (all.some((x) => /movie|tvseries/i.test(String(x['@type'] || ""))) || ["imdb", "rottentomatoes"].includes(site)) return "movie";
    if (all.some((x) => /article|newsarticle/i.test(String(x['@type'] || ""))) || (document.querySelector("article, main")?.innerText?.length || 0) > 1000) return "article";
    return "other";
  };
  const loadMoreReviews = async (sels) => {
    const candidates = [...document.querySelectorAll("button, a")].filter((el) => /see more reviews|more reviews|load more/i.test(el.innerText || "")).slice(0, 2);
    for (const el of candidates) { el.scrollIntoView({ block: "center" }); el.click(); await new Promise((r) => setTimeout(r, 700)); }
    const links = [...document.querySelectorAll("a[href]")].filter((el) => /reviews/i.test(el.innerText || "")).slice(0, 3);
    for (const link of links) {
      try {
        const response = await fetch(link.href, { credentials: "include" });
        const html = await response.text();
        const parsed = new DOMParser().parseFromString(html, "text/html");
        const selector = sels?.reviews;
        if (selector) {
          const more = [...parsed.querySelectorAll(selector)].map((node) => node.innerText?.trim()).filter(Boolean);
          window.__pageChatMoreReviews = [...(window.__pageChatMoreReviews || []), ...more];
        }
      } catch { /* Some sites prevent review-page requests. */ }
      await new Promise((r) => setTimeout(r, 1000));
    }
  };
  window.getPageData = async ({ moreReviews = false, debug = false } = {}) => {
    const site = detectSite();
    const sels = globalThis.PAGECHAT_SELECTORS?.[site] || {};
    if (sels.title) await waitFor(sels.title, 1200);
    const jsonld = jsonData();
    if (moreReviews) await loadMoreReviews(sels);
    const entries = flatten(jsonld);
    const product = entries.find((x) => /product/i.test(String(x['@type'] || ""))) || {};
    const movie = entries.find((x) => /movie|tvseries/i.test(String(x['@type'] || ""))) || {};
    const article = entries.find((x) => /article|newsarticle/i.test(String(x['@type'] || ""))) || {};
    const structured = {
      title: value(sels.title) || product.name || movie.name || article.headline || document.title,
      price: value(sels.price) || product.offers?.price || product.offers?.[0]?.price || "",
      rating: value(sels.rating) || product.aggregateRating?.ratingValue || movie.aggregateRating?.ratingValue || "",
      critic_score: value(sels.criticScore), synopsis: value(sels.synopsis) || movie.description || "",
      specs: select(sels, "bullets").concat(select(sels, "specs")),
      reviews: select(sels, "reviews").concat(window.__pageChatMoreReviews || []).slice(0, 30)
    };
    const pageType = detectPageType(site, jsonld, sels) || (article && "article") || "other";
    const parsed = globalThis.Readability ? new globalThis.Readability(document.cloneNode(true)).parse() : null;
    const fallback = parsed?.textContent || document.body?.innerText || "";
    const result = {
      url: location.href, title: structured.title, site, page_type: article && pageType === "other" ? "article" : pageType,
      structured: Object.fromEntries(Object.entries(structured).map(([k, v]) => [k, Array.isArray(v) ? v.map(clean) : clean(v)])),
      jsonld: clean(JSON.stringify(jsonld).slice(0, 5000)), fallback_text: clean(fallback),
      chars_extracted: clean(fallback).length + clean(JSON.stringify(structured)).length
    };
    if (debug) console.log("PageChat extracted data", result);
    return result;
  };
})();
