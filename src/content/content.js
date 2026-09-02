(() => {
  "use strict";

  const ROOT_ID = "twitter-focus-root";
  const HOME_ATTRIBUTE = "data-twitter-focus-home";
  const HIDDEN_ATTRIBUTE = "data-twitter-focus-feed-hidden";
  const AWAITING_PRIMARY_ATTRIBUTE = "data-twitter-focus-awaiting-primary";
  const FALLBACK_READY_ATTRIBUTE = "data-twitter-focus-fallback-ready";
  const URL_POLL_MS = 250;
  const PULSE_MS = 1_000;
  const STALE_PULSE_MS = 2_500;
  const VALID_HOSTS = new Set(["x.com", "www.x.com", "twitter.com", "www.twitter.com"]);
  const CORE = globalThis.TwitterFocusCore || {};
  const MESSAGE_TYPES = CORE.MESSAGE_TYPES || {};
  const MINIMAL_SHADOW_CSS = ":host{display:block;min-height:100vh;padding:32px;color:#1d1c19;background:#f4f1e8;font:16px/1.5 system-ui,sans-serif}:host .shell{display:block}:host button,:host a{font:inherit}";

  const instanceId = globalThis.crypto?.randomUUID?.()
    || `twitter-focus-${Date.now()}-${Math.random().toString(36).slice(2)}`;

  let currentHref = location.href;
  let onHome = isHomeUrl(currentHref);
  let snapshot = null;
  let view = "loading";
  let errorMessage = "";
  let host = null;
  let shadow = null;
  let stylesPromise = null;
  let leaseId = null;
  let leaseBeginInFlight = false;
  let pulseTimer = null;
  let pulseInFlight = false;
  let lastPulseAt = 0;
  let routeGeneration = 0;
  let actionPending = false;
  let mutationFrame = 0;
  let waitingForPrimary = onHome;

  // This runs at document_start. The stylesheet's gate is already registered by
  // Chrome, so setting these attributes before X paints prevents a feed flash.
  if (onHome) {
    setDocumentGate(true, true);
    document.documentElement?.setAttribute(AWAITING_PRIMARY_ATTRIBUTE, "true");
  }

  function isHomeUrl(value) {
    if (typeof CORE.isHomeUrl === "function") {
      try {
        return CORE.isHomeUrl(value);
      } catch {
        // Fall through to the deliberately narrow local classifier.
      }
    }

    try {
      const url = new URL(value, location.origin);
      return url.protocol === "https:"
        && VALID_HOSTS.has(url.hostname.toLowerCase())
        && (url.pathname === "/home" || url.pathname === "/home/");
    } catch {
      return false;
    }
  }

  function messageType(name) {
    return MESSAGE_TYPES[name] || name;
  }

  function setDocumentGate(isHome, hideFeed) {
    const root = document.documentElement;
    if (!root) return;

    if (isHome) {
      root.setAttribute(HOME_ATTRIBUTE, "true");
      if (hideFeed) root.setAttribute(HIDDEN_ATTRIBUTE, "true");
      else root.removeAttribute(HIDDEN_ATTRIBUTE);
    } else {
      root.removeAttribute(HOME_ATTRIBUTE);
      root.removeAttribute(HIDDEN_ATTRIBUTE);
      root.removeAttribute(AWAITING_PRIMARY_ATTRIBUTE);
      root.removeAttribute(FALLBACK_READY_ATTRIBUTE);
    }
  }

  function shouldBeActive() {
    return onHome
      && document.visibilityState === "visible"
      && document.hasFocus();
  }

  function send(type, payload = {}) {
    return new Promise((resolve, reject) => {
      if (!globalThis.chrome?.runtime?.sendMessage) {
        reject(new Error("The extension runtime is unavailable."));
        return;
      }

      chrome.runtime.sendMessage({ type: messageType(type), ...payload }, (response) => {
        const runtimeError = chrome.runtime.lastError;
        if (runtimeError) {
          reject(new Error(runtimeError.message));
          return;
        }
        resolve(response);
      });
    });
  }

  function responseError(response, fallback) {
    if (response?.error && typeof response.error === "object") {
      return response.error.message || response.error.code || fallback;
    }
    return response?.error || fallback;
  }

  async function loadShadowStyles() {
    if (stylesPromise) return stylesPromise;
    const targetShadow = shadow;

    stylesPromise = fetch(chrome.runtime.getURL("src/content/content.css"))
      .then((response) => {
        if (!response.ok) throw new Error(`Styles failed to load (${response.status}).`);
        return response.text();
      })
      .then((css) => {
        if (!targetShadow) return;
        installShadowStyles(targetShadow, css);
      })
      .catch(() => {
        // The document-level stylesheet still keeps the native feed hidden. A
        // tiny fallback makes recovery controls usable after an extension update.
        if (!targetShadow) return;
        installShadowStyles(
          targetShadow,
          ":host{display:block;padding:48px 32px;color:#111;background:#f4f0e7}:host button,:host a{font:inherit}",
        );
      });

    return stylesPromise;
  }

  function installShadowStyles(targetShadow, css) {
    if ("adoptedStyleSheets" in targetShadow && typeof CSSStyleSheet === "function") {
      try {
        const sheet = new CSSStyleSheet();
        sheet.replaceSync(css);
        targetShadow.adoptedStyleSheets = [...targetShadow.adoptedStyleSheets, sheet];
        return;
      } catch {
        // Fall through for older Chromium builds with partial constructable-sheet support.
      }
    }

    const style = document.createElement("style");
    style.textContent = css;
    targetShadow.prepend(style);
  }

  function findPrimaryColumn() {
    return document.querySelector('main [data-testid="primaryColumn"]')
      || document.querySelector('[data-testid="primaryColumn"]');
  }

  function createHost(parent, placement) {
    const nextHost = document.createElement("div");
    nextHost.id = ROOT_ID;
    nextHost.setAttribute("data-twitter-focus-owned", "true");
    nextHost.dataset.placement = placement;
    const nextShadow = nextHost.attachShadow({ mode: "open" });
    parent.prepend(nextHost);
    host = nextHost;
    shadow = nextShadow;
    installShadowStyles(nextShadow, MINIMAL_SHADOW_CSS);
    stylesPromise = null;
    void loadShadowStyles();
    return nextHost;
  }

  function isUsableOwnedHost(candidate) {
    return candidate?.getAttribute("data-twitter-focus-owned") === "true"
      && !!candidate.shadowRoot;
  }

  function ensureHost() {
    if (!onHome) return null;
    const primary = findPrimaryColumn();
    if (!primary) {
      waitingForPrimary = true;
      document.documentElement?.setAttribute(AWAITING_PRIMARY_ATTRIBUTE, "true");
      setDocumentGate(true, true);
      if (leaseId) {
        view = "loading";
        void endLease();
      }

      const fallbackParent = document.body;
      if (!fallbackParent) return null;

      if (!host || !host.isConnected || !shadow) {
        host?.remove();
        createHost(fallbackParent, "fallback");
      } else if (host.parentElement !== fallbackParent) {
        fallbackParent.prepend(host);
        host.dataset.placement = "fallback";
      }
      host.dataset.placement = "fallback";
      host.hidden = false;
      document.documentElement?.setAttribute(FALLBACK_READY_ATTRIBUTE, "true");
      render();
      return host;
    }

    const recoveredPrimary = waitingForPrimary;
    waitingForPrimary = false;
    document.documentElement?.removeAttribute(AWAITING_PRIMARY_ATTRIBUTE);
    document.documentElement?.removeAttribute(FALLBACK_READY_ATTRIBUTE);

    if (host && host.isConnected && host.parentElement === primary && isUsableOwnedHost(host)) {
      host.dataset.placement = "primary";
      return host;
    }

    if (host && host.isConnected && host.parentElement === primary) {
      host.remove();
      host = null;
      shadow = null;
    }

    const existing = primary.querySelector(`:scope > #${ROOT_ID}[data-twitter-focus-owned="true"]`);
    if (existing && isUsableOwnedHost(existing)) {
      host?.remove();
      host = existing;
      shadow = host.shadowRoot;
    } else if (existing) {
      existing.remove();
      createHost(primary, "primary");
    } else if (host && host.isConnected && shadow) {
      primary.prepend(host);
    } else {
      createHost(primary, "primary");
    }

    host.dataset.placement = "primary";
    host.hidden = false;
    host.dataset.view = view;
    render();
    if (recoveredPrimary && snapshot && view !== "active") {
      queueMicrotask(() => {
        if (onHome && !waitingForPrimary) void applySnapshot(routeGeneration);
      });
    }
    return host;
  }

  function showBlocker(nextView, message = "") {
    view = nextView;
    errorMessage = message;
    setDocumentGate(true, true);
    const blocker = ensureHost();
    if (blocker) {
      blocker.hidden = false;
      blocker.dataset.view = nextView;
    }
    render();
  }

  function hasFocusedNativeHomeElement() {
    const activeElement = document.activeElement;
    const primary = findPrimaryColumn();
    return onHome && view === "active" && !!primary && !!activeElement
      && primary.contains(activeElement) && activeElement !== host
      && activeElement !== document.body && activeElement !== document.documentElement;
  }

  function focusBlockerHeading() {
    if (!onHome || view === "active" || !shadow || !host || host.hidden) return;
    const heading = shadow.querySelector("h1");
    if (!heading) return;
    try {
      heading.focus({ preventScroll: true });
    } catch {
      heading.focus();
    }
  }

  function revealFeed() {
    if (!onHome || !shouldBeActive() || snapshot?.status !== "unlocked" || !leaseId) {
      return;
    }
    const sessionBar = ensureHost();
    if (!sessionBar || sessionBar.dataset.placement !== "primary" || !isUsableOwnedHost(sessionBar)) {
      showBlocker("unlocked");
      void endLease();
      return;
    }
    view = "active";
    sessionBar.hidden = false;
    sessionBar.dataset.view = "active";
    setDocumentGate(true, false);
    render();
  }

  function formatTime(milliseconds) {
    const totalSeconds = Math.max(0, Math.ceil((Number(milliseconds) || 0) / 1_000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }

  function remainingFraction() {
    const limit = Number(snapshot?.limitMs) || 0;
    const remaining = Number(snapshot?.remainingMs) || 0;
    if (!limit) return 0;
    return Math.max(0, Math.min(1, remaining / limit));
  }

  function makeIcon() {
    return `
      <svg class="mark" aria-hidden="true" viewBox="0 0 48 48">
        <circle cx="24" cy="24" r="20.5"></circle>
        <path d="M15 25.5h18M24 16.5v18"></path>
        <circle class="mark-dot" cx="24" cy="24" r="3.25"></circle>
      </svg>`;
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function viewModel() {
    if (view === "loading") {
      return {
        eyebrow: "HOME, ON PURPOSE",
        title: "Holding the feed…",
        copy: "Checking today’s session before anything appears.",
        primary: "",
      };
    }

    if (view === "error") {
      return {
        eyebrow: "HOME, ON PURPOSE",
        title: "The feed is still paused.",
        copy: errorMessage || "Session status could not be checked. Nothing has been counted.",
        primary: '<button class="button button-primary" data-action="retry">Try again</button>',
      };
    }

    if (snapshot?.status === "always_block") {
      return {
        eyebrow: "ALWAYS BLOCK",
        title: "Home stays quiet.",
        copy: "Messages, direct posts, profiles, replies, and search are all still available.",
        primary: "",
      };
    }

    if (snapshot?.status === "exhausted") {
      return {
        eyebrow: "TODAY’S SESSION IS COMPLETE",
        title: "Today’s Home time is complete.",
        copy: "Your Home allowance returns with the next calendar day. Everything else on X remains open.",
        primary: "",
      };
    }

    if (snapshot?.status === "unlocked") {
      const primaryUnavailable = host?.dataset.placement === "fallback";
      return {
        eyebrow: "SESSION PAUSED",
        title: "Home is waiting.",
        copy: primaryUnavailable
          ? "X is still loading its Home column. The feed remains hidden and no time is being counted."
          : "Return focus to this tab to continue; time away is not counted.",
        primary: '<button class="button button-secondary" data-action="pause">Pause session</button>',
        timer: true,
      };
    }

    return {
      eyebrow: "HOME, ON PURPOSE",
      title: "Your Home feed is paused.",
      copy: `Open it deliberately for up to ${snapshot?.dailyLimitMinutes || 15} focused minutes today. Direct posts and messages never count.`,
      primary: '<button class="button button-primary" data-action="start">Start today’s session</button>',
    };
  }

  function render() {
    if (!shadow || !host || host.hidden || !onHome) return;

    if (view === "active" && snapshot?.status === "unlocked"
        && host.dataset.placement === "primary") {
      shadow.querySelector(".shell")?.remove();
      const existingStrip = shadow.querySelector(".session-strip");
      if (existingStrip) {
        const time = existingStrip.querySelector(".session-time");
        if (time) time.textContent = formatTime(snapshot.remainingMs);
        const pause = existingStrip.querySelector('[data-action="pause"]');
        if (pause) {
          pause.disabled = actionPending;
          if (actionPending) pause.setAttribute("aria-disabled", "true");
          else pause.removeAttribute("aria-disabled");
        }
        return;
      }
      const strip = document.createElement("section");
      strip.className = "session-strip";
      strip.setAttribute("aria-label", "Home feed session");
      strip.innerHTML = `
        <span class="session-signal" aria-hidden="true"></span>
        <span class="session-name">Home is open</span>
        <span class="session-time" aria-live="off">${formatTime(snapshot.remainingMs)}</span>
        <span class="session-remaining">remaining</span>
        <button class="strip-button" data-action="pause"${actionPending ? " disabled aria-disabled=\"true\"" : ""}>Pause</button>`;
      strip.addEventListener("click", handleBlockerClick);
      shadow.append(strip);
      return;
    }

    const model = viewModel();
    const timer = model.timer ? `
      <div class="timer" aria-label="${formatTime(snapshot?.remainingMs)} remaining">
        <span class="timer-value">${formatTime(snapshot?.remainingMs)}</span>
        <span class="timer-label">remaining today</span>
      </div>
      <div class="meter" aria-hidden="true"><span style="transform:scaleX(${remainingFraction()})"></span></div>` : "";
    const busy = actionPending ? " disabled aria-disabled=\"true\"" : "";
    const primary = model.primary.replace("<button ", `<button${busy} `);

    shadow.querySelector(".session-strip")?.remove();
    shadow.querySelector(".shell")?.remove();
    const shell = document.createElement("section");
    shell.className = "shell";
    shell.setAttribute("aria-live", "polite");
    shell.innerHTML = `
      <div class="rule" aria-hidden="true"></div>
      <div class="content">
        ${makeIcon()}
        <p class="eyebrow">${escapeHtml(model.eyebrow)}</p>
        <h1 tabindex="-1">${escapeHtml(model.title)}</h1>
        <p class="copy">${escapeHtml(model.copy)}</p>
        ${timer}
        <div class="actions">${primary}</div>
        <nav class="shortcuts" aria-label="X shortcuts">
          <a href="/messages">Messages</a>
          <span aria-hidden="true">·</span>
          <a href="/explore">Search</a>
          <span aria-hidden="true">·</span>
          <button class="text-button" data-action="settings">Settings</button>
        </nav>
      </div>
      <p class="aside">The rest of X is untouched.</p>`;
    shadow.append(shell);

    shell.addEventListener("click", handleBlockerClick);
  }

  async function handleBlockerClick(event) {
    const control = event.target.closest("[data-action]");
    if (!control || actionPending) return;
    const action = control.dataset.action;

    if (action === "settings") {
      chrome.runtime.openOptionsPage();
      return;
    }

    actionPending = true;
    render();
    if (action === "start") await startSession();
    else if (action === "pause") await pauseSession();
    else if (action === "retry") await refreshSnapshot();
    actionPending = false;
    render();
  }

  function acceptSnapshot(nextSnapshot) {
    if (nextSnapshot && typeof nextSnapshot === "object") snapshot = nextSnapshot;
  }

  async function startSession() {
    const generation = routeGeneration;
    showBlocker("loading");
    try {
      const response = await send("START_SESSION");
      if (!onHome || generation !== routeGeneration) return;
      acceptSnapshot(response?.snapshot);
      if (!response?.ok) throw new Error(responseError(response, "The session could not be started."));
      await applySnapshot(generation);
    } catch (error) {
      if (onHome && generation === routeGeneration) showBlocker("error", error.message);
    }
  }

  async function pauseSession() {
    const generation = routeGeneration;
    showBlocker("loading");
    await endLease();
    try {
      const response = await send("PAUSE_SESSION");
      if (!onHome || generation !== routeGeneration) return;
      acceptSnapshot(response?.snapshot);
      if (!response?.ok) throw new Error(responseError(response, "The session could not be paused."));
      showBlocker(snapshot?.status === "exhausted" ? "exhausted" : "locked");
    } catch (error) {
      if (onHome && generation === routeGeneration) showBlocker("error", error.message);
    }
  }

  async function refreshSnapshot() {
    const generation = routeGeneration;
    showBlocker("loading");
    try {
      const response = await send("GET_SNAPSHOT");
      if (!onHome || generation !== routeGeneration) return;
      acceptSnapshot(response?.snapshot);
      if (!response?.ok) throw new Error(responseError(response, "Session status could not be checked."));
      await applySnapshot(generation);
    } catch (error) {
      if (onHome && generation === routeGeneration) showBlocker("error", error.message);
    }
  }

  async function applySnapshot(generation = routeGeneration) {
    if (!onHome || generation !== routeGeneration) return;
    if (snapshot?.status !== "unlocked") {
      await endLease();
      showBlocker(snapshot?.status || "locked");
      return;
    }

    const currentHost = ensureHost();
    if (!currentHost || currentHost.dataset.placement !== "primary") {
      await endLease();
      showBlocker("unlocked");
      return;
    }

    if (!shouldBeActive()) {
      await endLease();
      showBlocker("unlocked");
      return;
    }

    if (leaseId) {
      revealFeed();
      return;
    }

    await beginLease(generation);
  }

  async function beginLease(generation = routeGeneration) {
    if (leaseId || leaseBeginInFlight || !onHome || !shouldBeActive()
        || snapshot?.status !== "unlocked" || host?.dataset.placement !== "primary") return;
    leaseBeginInFlight = true;
    showBlocker("loading");

    try {
      const response = await send("ACTIVITY_BEGIN", { instanceId });
      if (!onHome || generation !== routeGeneration || !shouldBeActive()) {
        if (response?.leaseId) void send("ACTIVITY_END", { leaseId: response.leaseId }).catch(() => {});
        return;
      }
      acceptSnapshot(response?.snapshot);
      if (!response?.ok || !response.leaseId) {
        throw new Error(responseError(response, "Active time could not be started."));
      }
      leaseId = response.leaseId;
      lastPulseAt = performance.now();
      startPulseLoop();
      revealFeed();
    } catch (error) {
      if (onHome && generation === routeGeneration) showBlocker("error", error.message);
    } finally {
      leaseBeginInFlight = false;
    }
  }

  function startPulseLoop() {
    clearInterval(pulseTimer);
    pulseTimer = setInterval(() => void pulseLease(), PULSE_MS);
  }

  async function pulseLease() {
    if (!leaseId || pulseInFlight) return;
    if (!shouldBeActive()) {
      hideAndRevalidate();
      return;
    }

    const now = performance.now();
    const stale = now - lastPulseAt > STALE_PULSE_MS;
    if (stale) showBlocker("loading");
    const activeLease = leaseId;
    const generation = routeGeneration;
    pulseInFlight = true;

    try {
      const response = await send("ACTIVITY_PULSE", { leaseId: activeLease });
      if (generation !== routeGeneration || !onHome || activeLease !== leaseId) return;
      acceptSnapshot(response?.snapshot);
      if (!response?.ok) {
        const code = typeof response?.error === "object" ? response.error.code : response?.error;
        if (code === "LEASE_INVALID") {
          clearLeaseLocally();
          await applySnapshot(generation);
          return;
        }
        throw new Error(responseError(response, "Active time could not be updated."));
      }

      lastPulseAt = performance.now();
      if (snapshot?.status !== "unlocked" || (snapshot?.remainingMs ?? 0) <= 0) {
        const shouldFocusBlocker = hasFocusedNativeHomeElement();
        clearLeaseLocally();
        showBlocker(snapshot?.status || "exhausted");
        if (shouldFocusBlocker) focusBlockerHeading();
        return;
      }
      if (stale) revealFeed();
      else render();
    } catch (error) {
      clearLeaseLocally();
      if (onHome && generation === routeGeneration) showBlocker("error", error.message);
    } finally {
      pulseInFlight = false;
    }
  }

  function clearLeaseLocally() {
    leaseId = null;
    clearInterval(pulseTimer);
    pulseTimer = null;
    lastPulseAt = 0;
  }

  async function endLease() {
    const endingLease = leaseId;
    clearLeaseLocally();
    if (!endingLease) return;
    try {
      const response = await send("ACTIVITY_END", { leaseId: endingLease });
      acceptSnapshot(response?.snapshot);
    } catch {
      // The background lease expires independently, so losing this best-effort
      // message cannot cause unbounded charging.
    }
  }

  function hideAndRevalidate() {
    if (!onHome) return;
    showBlocker("loading");
    void endLease().finally(() => {
      if (!onHome) return;
      if (shouldBeActive()) void refreshSnapshot();
      else {
        view = snapshot?.status === "unlocked" ? "unlocked" : (snapshot?.status || "locked");
        render();
      }
    });
  }

  function enterHome() {
    routeGeneration += 1;
    onHome = true;
    snapshot = null;
    showBlocker("loading");
    void refreshSnapshot();
  }

  function leaveHome() {
    routeGeneration += 1;
    onHome = false;
    setDocumentGate(false, false);
    const oldHost = host;
    host = null;
    shadow = null;
    stylesPromise = null;
    oldHost?.remove();
    void endLease();
  }

  function checkUrl() {
    if (location.href === currentHref) {
      if (onHome) {
        setDocumentGate(true, view !== "active");
        ensureHost();
      }
      return;
    }

    currentHref = location.href;
    const nextIsHome = isHomeUrl(currentHref);
    if (nextIsHome && !onHome) enterHome();
    else if (!nextIsHome && onHome) leaveHome();
    else if (nextIsHome) {
      setDocumentGate(true, view !== "active");
      ensureHost();
    } else {
      setDocumentGate(false, false);
    }
  }

  function handleHomeLinkCapture(event) {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const link = event.target.closest?.("a[href]");
    if (!link || link.target === "_blank" || !isHomeUrl(link.href) || onHome) return;

    // Navigation API/current-entry handling performs the synchronous gate once
    // the URL changes; this microtask covers routers that update immediately.
    queueMicrotask(checkUrl);
  }

  function observeNavigationApi() {
    const navigationApi = globalThis.navigation;
    if (!navigationApi?.addEventListener) return;
    try {
      navigationApi.addEventListener("currententrychange", checkUrl);
      navigationApi.addEventListener("navigate", () => queueMicrotask(checkUrl));
    } catch {
      // Older Chromium builds expose no usable Navigation API; URL polling and
      // DOM observation remain the safe fallback.
    }
  }

  function scheduleMutationCheck() {
    if (mutationFrame) return;
    mutationFrame = requestAnimationFrame(() => {
      mutationFrame = 0;
      checkUrl();
      if (onHome) ensureHost();
    });
  }

  addEventListener("popstate", checkUrl);
  addEventListener("hashchange", checkUrl);
  addEventListener("pageshow", () => {
    checkUrl();
    if (onHome) hideAndRevalidate();
  });
  addEventListener("focus", () => {
    if (onHome) hideAndRevalidate();
  });
  addEventListener("blur", () => {
    if (onHome) hideAndRevalidate();
  });
  addEventListener("pagehide", () => {
    if (onHome) void endLease();
  });
  document.addEventListener("visibilitychange", () => {
    if (onHome) hideAndRevalidate();
  });
  document.addEventListener("click", handleHomeLinkCapture, true);
  observeNavigationApi();
  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type !== messageType("STATE_CHANGED") || !message.snapshot) return;
    acceptSnapshot(message.snapshot);
    if (!onHome) return;

    // External changes (popup/options/another Home tab) fail closed first, then
    // reacquire only if this document is still the focused Home tab.
    const generation = routeGeneration;
    const shouldFocusBlocker = hasFocusedNativeHomeElement();
    showBlocker("loading");
    void applySnapshot(generation).finally(() => {
      if (shouldFocusBlocker && onHome && generation === routeGeneration) focusBlockerHeading();
    });
  });

  new MutationObserver(scheduleMutationCheck).observe(document, {
    childList: true,
    subtree: true,
  });
  setInterval(checkUrl, URL_POLL_MS);

  if (onHome) enterHome();
})();
