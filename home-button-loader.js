(function () {
    "use strict";

    var script = document.currentScript;
    var homeHref = (script && script.dataset && script.dataset.homeHref) ? script.dataset.homeHref : "index.html";
    var scrollStorageKey = "page-scroll:" + window.location.pathname + window.location.search;
    var isRestoringScroll = false;

    function normalizePageUrl(url) {
        try {
            var parsed = new URL(url, window.location.href);
            return parsed.origin + parsed.pathname + parsed.search;
        } catch (error) {
            return String(url || "").split("#")[0];
        }
    }

    function getNavigationType() {
        if (window.performance && typeof window.performance.getEntriesByType === "function") {
            var entries = window.performance.getEntriesByType("navigation");
            if (entries && entries.length && entries[0] && entries[0].type) {
                return entries[0].type;
            }
        }

        if (window.performance && window.performance.navigation) {
            switch (window.performance.navigation.type) {
                case 1:
                    return "reload";
                case 2:
                    return "back_forward";
                default:
                    return "navigate";
            }
        }

        return "navigate";
    }

    function shouldRestoreScroll(savedPosition) {
        if (!savedPosition) {
            return false;
        }

        var navigationType = getNavigationType();
        if (navigationType === "reload" || navigationType === "back_forward") {
            return true;
        }

        // Some browser contexts report reloads as "navigate"; fall back to
        // matching the referrer to the current document in that case.
        return normalizePageUrl(document.referrer) === normalizePageUrl(window.location.href);
    }

    function loadSavedScrollPosition() {
        try {
            var rawValue = window.sessionStorage.getItem(scrollStorageKey);
            if (!rawValue) {
                return null;
            }

            var parsedValue = JSON.parse(rawValue);
            if (!parsedValue || typeof parsedValue.x !== "number" || typeof parsedValue.y !== "number") {
                return null;
            }

            return parsedValue;
        } catch (error) {
            return null;
        }
    }

    function saveScrollPosition() {
        if (isRestoringScroll) {
            return;
        }

        try {
            window.sessionStorage.setItem(scrollStorageKey, JSON.stringify({
                x: window.scrollX,
                y: window.scrollY
            }));
        } catch (error) {
            // Ignore storage errors so page behavior still works normally.
        }
    }

    function setupScrollPersistence() {
        var pendingSaveFrame = 0;

        function scheduleSave() {
            if (pendingSaveFrame || isRestoringScroll) {
                return;
            }

            pendingSaveFrame = window.requestAnimationFrame(function () {
                pendingSaveFrame = 0;
                saveScrollPosition();
            });
        }

        window.addEventListener("scroll", scheduleSave, { passive: true });
        window.addEventListener("beforeunload", saveScrollPosition);
        window.addEventListener("pagehide", saveScrollPosition);
        document.addEventListener("visibilitychange", function () {
            if (document.visibilityState === "hidden") {
                saveScrollPosition();
            }
        });
    }

    function restoreScrollPosition(savedPosition) {
        if (!shouldRestoreScroll(savedPosition)) {
            return;
        }

        if ("scrollRestoration" in window.history) {
            window.history.scrollRestoration = "manual";
        }

        var restoreAttempts = 0;
        var maxRestoreAttempts = 300;
        var restoreTimer = 0;
        var restoreObserver = null;
        var restoreFrame = 0;

        function stopRestoring() {
            if (restoreTimer) {
                window.clearInterval(restoreTimer);
                restoreTimer = 0;
            }

            if (restoreObserver) {
                restoreObserver.disconnect();
                restoreObserver = null;
            }

            if (restoreFrame) {
                window.cancelAnimationFrame(restoreFrame);
                restoreFrame = 0;
            }

            isRestoringScroll = false;
            saveScrollPosition();
        }

        function attemptRestore() {
            restoreFrame = 0;
            restoreAttempts += 1;

            var doc = document.documentElement;
            var maxScrollY = Math.max(0, doc.scrollHeight - window.innerHeight);
            var targetX = Math.max(0, savedPosition.x);
            var targetY = Math.max(0, savedPosition.y);
            var appliedY = Math.min(targetY, maxScrollY);

            window.scrollTo(targetX, appliedY);

            if ((maxScrollY >= targetY && Math.abs(window.scrollY - targetY) <= 2) || restoreAttempts >= maxRestoreAttempts) {
                stopRestoring();
            }
        }

        function scheduleRestoreAttempt() {
            if (restoreFrame || !isRestoringScroll) {
                return;
            }

            restoreFrame = window.requestAnimationFrame(attemptRestore);
        }

        function startRestoreLoop() {
            if (restoreTimer) {
                return;
            }

            isRestoringScroll = true;
            attemptRestore();
            restoreTimer = window.setInterval(attemptRestore, 100);

            if (window.MutationObserver && document.body) {
                restoreObserver = new MutationObserver(scheduleRestoreAttempt);
                restoreObserver.observe(document.body, {
                    childList: true,
                    subtree: true
                });
            }
        }

        if (document.readyState === "complete") {
            startRestoreLoop();
        } else {
            window.addEventListener("load", startRestoreLoop, { once: true });
        }

        window.addEventListener("pageshow", scheduleRestoreAttempt, { once: true });
    }

    setupScrollPersistence();
    restoreScrollPosition(loadSavedScrollPosition());

    // Skip injection if a page-specific home button already exists.
    if (document.querySelector("a.home-button, a.global-home-button, a[aria-label='Go to home page']")) {
        return;
    }

    if (!document.getElementById("global-home-button-style")) {
        var style = document.createElement("style");
        style.id = "global-home-button-style";
        style.textContent = [
            ".global-home-button {",
            "    position: fixed;",
            "    top: 14px;",
            "    left: 14px;",
            "    z-index: 2000;",
            "    display: inline-flex;",
            "    align-items: center;",
            "    gap: 8px;",
            "    padding: 8px 14px;",
            "    border-radius: 999px;",
            "    border: 1px solid rgba(51, 51, 51, 0.2);",
            "    background: rgba(255, 255, 255, 0.92);",
            "    color: #333;",
            "    text-decoration: none;",
            "    font-size: 0.95rem;",
            "    font-weight: 600;",
            "    line-height: 1;",
            "    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);",
            "    backdrop-filter: blur(2px);",
            "    transition: color 0.2s ease, border-color 0.2s ease, transform 0.2s ease, background-color 0.2s ease;",
            "}",
            ".global-home-button svg {",
            "    width: 16px;",
            "    height: 16px;",
            "    flex-shrink: 0;",
            "}",
            ".global-home-button:hover,",
            ".global-home-button:focus-visible {",
            "    color: #d93025;",
            "    border-color: rgba(217, 48, 37, 0.45);",
            "    background: #fff;",
            "    transform: translateY(-1px);",
            "    text-decoration: none;",
            "}",
            ".global-home-button:focus-visible {",
            "    outline: 2px solid rgba(217, 48, 37, 0.55);",
            "    outline-offset: 2px;",
            "}",
            "@media (max-width: 640px) {",
            "    .global-home-button {",
            "        gap: 6px;",
            "        padding: 7px 12px;",
            "        font-size: 0.9rem;",
            "    }",
            "    .global-home-button svg {",
            "        width: 14px;",
            "        height: 14px;",
            "    }",
            "}"
        ].join("\n");
        document.head.appendChild(style);
    }

    var homeButton = document.createElement("a");
    homeButton.href = homeHref;
    homeButton.className = "global-home-button";
    homeButton.setAttribute("aria-label", "Go to home page");
    homeButton.innerHTML = [
        "<svg viewBox='0 0 24 24' aria-hidden='true' focusable='false'>",
        "<path fill='currentColor' d='M12 3l9 8h-3v9h-5v-6H11v6H6v-9H3z'></path>",
        "</svg>",
        "<span>Home</span>"
    ].join("");

    if (document.body) {
        document.body.appendChild(homeButton);
    }
})();
