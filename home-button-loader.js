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
        var lastMaxScrollY = -1;
        var stalledRestoreAttempts = 0;

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

            window.removeEventListener("wheel", handleUserScrollIntent);
            window.removeEventListener("touchstart", handleUserScrollIntent);
            window.removeEventListener("touchmove", handleUserScrollIntent);
            window.removeEventListener("keydown", handleUserScrollIntent);
            window.removeEventListener("mousedown", handleUserScrollIntent);
            isRestoringScroll = false;
            saveScrollPosition();
        }

        function handleUserScrollIntent() {
            if (!isRestoringScroll) {
                return;
            }

            stopRestoring();
        }

        function attemptRestore() {
            restoreFrame = 0;
            restoreAttempts += 1;

            var doc = document.documentElement;
            var maxScrollY = Math.max(0, doc.scrollHeight - window.innerHeight);
            var targetX = Math.max(0, savedPosition.x);
            var targetY = Math.max(0, savedPosition.y);
            var appliedY = Math.min(targetY, maxScrollY);

            if (Math.abs(maxScrollY - lastMaxScrollY) <= 2) {
                stalledRestoreAttempts += 1;
            } else {
                stalledRestoreAttempts = 0;
                lastMaxScrollY = maxScrollY;
            }

            window.scrollTo(targetX, appliedY);

            if (
                (maxScrollY >= targetY && Math.abs(window.scrollY - targetY) <= 2) ||
                (appliedY === maxScrollY && stalledRestoreAttempts >= 10) ||
                restoreAttempts >= maxRestoreAttempts
            ) {
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
            window.addEventListener("wheel", handleUserScrollIntent, { passive: true });
            window.addEventListener("touchstart", handleUserScrollIntent, { passive: true });
            window.addEventListener("touchmove", handleUserScrollIntent, { passive: true });
            window.addEventListener("keydown", handleUserScrollIntent);
            window.addEventListener("mousedown", handleUserScrollIntent);
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

    function getNormalizedHeaderLabel(value) {
        return String(value || "").replace(/\s+/g, " ").trim().toLowerCase();
    }

    function parseDaysSortValue(value) {
        var normalized = String(value || "").replace(/,/g, "").trim();
        if (!normalized) {
            return null;
        }

        var matched = normalized.match(/-?\d+(?:\.\d+)?/);
        if (!matched) {
            return null;
        }

        var parsed = Number(matched[0]);
        return Number.isFinite(parsed) ? parsed : null;
    }

    function ensureGlobalDaysSortStyle() {
        if (document.getElementById("global-days-since-sort-style")) {
            return;
        }

        var style = document.createElement("style");
        style.id = "global-days-since-sort-style";
        style.textContent = [
            ".global-days-sort-button {",
            "    display: flex;",
            "    align-items: center;",
            "    justify-content: flex-start;",
            "    gap: 6px;",
            "    width: 100%;",
            "    padding: 0;",
            "    border: 0;",
            "    background: transparent;",
            "    appearance: none;",
            "    -webkit-appearance: none;",
            "    color: inherit;",
            "    font: inherit;",
            "    line-height: inherit;",
            "    letter-spacing: inherit;",
            "    text-transform: inherit;",
            "    text-align: left;",
            "    cursor: pointer;",
            "}",
            ".global-days-sort-button:focus-visible {",
            "    outline: 2px solid rgba(217, 48, 37, 0.55);",
            "    outline-offset: 2px;",
            "}",
            ".global-days-sort-indicator {",
            "    flex-shrink: 0;",
            "    font-size: 1rem;",
            "}"
        ].join("\n");
        document.head.appendChild(style);
    }

    function sortTableRowsByDaysSince(headerCell, direction) {
        var table = headerCell.closest("table");
        if (!table || !table.tBodies || table.tBodies.length === 0) {
            return;
        }

        var tbody = table.tBodies[0];
        var columnIndex = headerCell.cellIndex;
        if (columnIndex < 0) {
            return;
        }

        var rows = Array.prototype.slice.call(tbody.rows);
        if (rows.length < 2) {
            return;
        }

        var rowsWithValues = rows.map(function (row, originalIndex) {
            var cell = row.cells[columnIndex];
            return {
                row: row,
                originalIndex: originalIndex,
                value: parseDaysSortValue(cell ? cell.textContent : "")
            };
        });

        rowsWithValues.sort(function (a, b) {
            var aMissing = a.value === null;
            var bMissing = b.value === null;

            if (aMissing && bMissing) {
                return a.originalIndex - b.originalIndex;
            }

            if (aMissing) {
                return 1;
            }

            if (bMissing) {
                return -1;
            }

            var difference = direction === "desc" ? b.value - a.value : a.value - b.value;
            if (difference !== 0) {
                return difference;
            }

            return a.originalIndex - b.originalIndex;
        });

        rowsWithValues.forEach(function (item) {
            tbody.appendChild(item.row);
        });
    }

    function setupDaysSinceSortHeader(headerCell) {
        if (headerCell.dataset.daysSinceSortManaged === "true") {
            return;
        }

        if (headerCell.querySelector("button")) {
            return;
        }

        var headerLabel = String(headerCell.textContent || "").replace(/\s+/g, " ").trim() || "Days Since";
        headerCell.textContent = "";
        headerCell.dataset.daysSinceSortManaged = "true";
        headerCell.setAttribute("aria-sort", "none");

        var button = document.createElement("button");
        button.type = "button";
        button.className = "sort-button global-days-sort-button";

        var label = document.createElement("span");
        label.textContent = headerLabel;

        var indicator = document.createElement("span");
        indicator.className = "sort-indicator global-days-sort-indicator";
        indicator.textContent = "\u2195";
        indicator.setAttribute("aria-hidden", "true");

        button.appendChild(label);
        button.appendChild(indicator);
        headerCell.appendChild(button);

        button.addEventListener("click", function () {
            var nextDirection = headerCell.dataset.daysSinceSortDirection === "desc" ? "asc" : "desc";
            sortTableRowsByDaysSince(headerCell, nextDirection);
            headerCell.dataset.daysSinceSortDirection = nextDirection;
            headerCell.setAttribute("aria-sort", nextDirection === "desc" ? "descending" : "ascending");
            indicator.textContent = nextDirection === "desc" ? "\u2193" : "\u2191";
        });
    }

    function initializeGlobalDaysSinceSorting() {
        var headerCells = document.querySelectorAll("table th");
        if (!headerCells.length) {
            return;
        }

        ensureGlobalDaysSortStyle();

        Array.prototype.forEach.call(headerCells, function (headerCell) {
            if (headerCell.dataset.daysSinceSortIgnore === "true") {
                return;
            }

            if (getNormalizedHeaderLabel(headerCell.textContent) !== "days since") {
                return;
            }

            setupDaysSinceSortHeader(headerCell);
        });
    }

    setupScrollPersistence();
    restoreScrollPosition(loadSavedScrollPosition());
    initializeGlobalDaysSinceSorting();
    window.addEventListener("load", initializeGlobalDaysSinceSorting);

    function getSiteRootUrl() {
        try {
            if (script && script.src) {
                return new URL("./", new URL(script.src, window.location.href));
            }

            return new URL("./", new URL(homeHref, window.location.href));
        } catch (error) {
            return new URL("./", window.location.href);
        }
    }

    var siteRootUrl = getSiteRootUrl();

    function buildSiteUrl(pathOrHash) {
        var targetUrl = new URL(siteRootUrl.href);

        if (!pathOrHash) {
            return targetUrl.href;
        }

        if (pathOrHash.charAt(0) === "#") {
            targetUrl.hash = pathOrHash;
            return targetUrl.href;
        }

        return new URL(pathOrHash, siteRootUrl).href;
    }

    function normalizePathname(pathname) {
        var normalized = String(pathname || "/").replace(/\/index\.html$/, "/");
        normalized = normalized.replace(/\.html$/, "");
        return normalized.length > 1 ? normalized.replace(/\/$/, "") : normalized;
    }

    function getCurrentAriaValue(href) {
        try {
            var target = new URL(href, window.location.href);
            var isSameDocument = target.origin === window.location.origin &&
                normalizePathname(target.pathname) === normalizePathname(window.location.pathname);

            if (!isSameDocument) {
                return null;
            }

            if (target.hash) {
                return target.hash === window.location.hash ? "location" : null;
            }

            return window.location.hash ? null : "page";
        } catch (error) {
            return null;
        }
    }

    function createMenuGroup(root, title, items, closeMenu) {
        var group = document.createElement("section");
        group.className = "site-menu-group";

        var heading = document.createElement("h2");
        heading.textContent = title;
        group.appendChild(heading);

        var list = document.createElement("ul");

        items.forEach(function (item) {
            var listItem = document.createElement("li");
            var link = document.createElement("a");
            link.href = item.href;
            link.textContent = item.label;

            if (item.external) {
                link.target = "_blank";
                link.rel = "noopener noreferrer";
            }

            var currentValue = getCurrentAriaValue(item.href);
            if (currentValue) {
                link.setAttribute("aria-current", currentValue);
            }

            link.addEventListener("click", function () {
                closeMenu(false);

                try {
                    var target = new URL(link.href, window.location.href);
                    var isSameDocument = target.origin === window.location.origin &&
                        normalizePathname(target.pathname) === normalizePathname(window.location.pathname);

                    if (isSameDocument && target.hash) {
                        window.setTimeout(function () {
                            var destination = document.getElementById(decodeURIComponent(target.hash.slice(1)));
                            if (!destination) {
                                return;
                            }

                            if (!destination.hasAttribute("tabindex")) {
                                destination.setAttribute("tabindex", "-1");
                                destination.addEventListener("blur", function () {
                                    destination.removeAttribute("tabindex");
                                }, { once: true });
                            }

                            destination.focus();
                        }, 0);
                    }
                } catch (error) {
                    // Let ordinary link navigation continue when URL parsing fails.
                }
            });

            listItem.appendChild(link);
            list.appendChild(listItem);
        });

        group.appendChild(list);
        root.appendChild(group);
    }

    function initializeSiteMenu() {
        if (!document.body || document.getElementById("global-site-menu")) {
            return;
        }

        var existingHomeButton = document.querySelector("a.home-button, a.global-home-button, a[aria-label='Go to home page']");
        var host = document.createElement("div");
        host.id = "global-site-menu";
        if (!existingHomeButton) {
            host.setAttribute("data-reserve-space", "true");
        }

        var root = host.attachShadow ? host.attachShadow({ mode: "open" }) : host;
        var style = document.createElement("style");
        style.textContent = [
            ":host {",
            "    --menu-paper: #ffffff;",
            "    --menu-ink: #172033;",
            "    --menu-muted: #677181;",
            "    --menu-accent: #2457a6;",
            "    --menu-soft: #f3f6fa;",
            "    --menu-line: #dce2ea;",
            "    all: initial;",
            "    color-scheme: light dark;",
            "}",
            ":host([data-reserve-space]) {",
            "    display: block;",
            "    height: 52px;",
            "}",
            "*, *::before, *::after { box-sizing: border-box; }",
            ".site-menu-trigger {",
            "    position: fixed;",
            "    top: clamp(14px, 2vw, 22px);",
            "    left: clamp(14px, 2vw, 22px);",
            "    z-index: 2147483000;",
            "    min-height: 44px;",
            "    padding: 0 14px;",
            "    border: 1px solid var(--menu-line);",
            "    border-radius: 3px;",
            "    background: var(--menu-paper);",
            "    background: color-mix(in srgb, var(--menu-paper) 94%, transparent);",
            "    box-shadow: 0 5px 18px rgba(23, 32, 51, 0.08);",
            "    color: var(--menu-ink);",
            "    cursor: pointer;",
            "    font: 700 13px/1 -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;",
            "    letter-spacing: 0.035em;",
            "    -webkit-backdrop-filter: blur(12px);",
            "    backdrop-filter: blur(12px);",
            "}",
            ".site-menu-trigger:hover {",
            "    border-color: var(--menu-accent);",
            "    color: var(--menu-accent);",
            "}",
            ".site-menu-trigger:focus-visible,",
            ".site-menu-close:focus-visible,",
            ".site-menu-panel a:focus-visible {",
            "    outline: 2px solid var(--menu-accent);",
            "    outline-offset: 3px;",
            "}",
            ".site-menu-panel {",
            "    position: fixed;",
            "    top: clamp(66px, calc(2vw + 50px), 76px);",
            "    left: clamp(14px, 2vw, 22px);",
            "    z-index: 2147482999;",
            "    width: min(292px, calc(100vw - 28px));",
            "    max-height: calc(100vh - 84px);",
            "    overflow-y: auto;",
            "    padding: 20px;",
            "    border: 1px solid var(--menu-line);",
            "    border-radius: 4px;",
            "    background: var(--menu-paper);",
            "    box-shadow: 0 22px 60px rgba(23, 32, 51, 0.18);",
            "    color: var(--menu-ink);",
            "    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;",
            "}",
            ".site-menu-panel[hidden] { display: none; }",
            ".site-menu-header {",
            "    display: flex;",
            "    align-items: center;",
            "    justify-content: space-between;",
            "    gap: 18px;",
            "    padding-bottom: 15px;",
            "    border-bottom: 1px solid var(--menu-line);",
            "}",
            ".site-menu-title {",
            "    margin: 0;",
            "    color: var(--menu-ink);",
            "    font-size: 15px;",
            "    font-weight: 750;",
            "    line-height: 1.25;",
            "}",
            ".site-menu-close {",
            "    min-height: 34px;",
            "    padding: 0 4px;",
            "    border: 0;",
            "    background: transparent;",
            "    color: var(--menu-muted);",
            "    cursor: pointer;",
            "    font: 650 12px/1 -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;",
            "}",
            ".site-menu-close:hover { color: var(--menu-accent); }",
            ".site-menu-group { margin-top: 18px; }",
            ".site-menu-group + .site-menu-group {",
            "    padding-top: 18px;",
            "    border-top: 1px solid var(--menu-line);",
            "}",
            ".site-menu-group h2 {",
            "    margin: 0 0 7px;",
            "    color: var(--menu-muted);",
            "    font-size: 10px;",
            "    font-weight: 800;",
            "    letter-spacing: 0.13em;",
            "    line-height: 1.3;",
            "    text-transform: uppercase;",
            "}",
            ".site-menu-group ul { margin: 0; padding: 0; list-style: none; }",
            ".site-menu-group li { margin: 0; padding: 0; }",
            ".site-menu-panel a {",
            "    display: block;",
            "    margin: 0 -10px;",
            "    padding: 8px 10px;",
            "    border-radius: 2px;",
            "    color: var(--menu-ink);",
            "    font-size: 13px;",
            "    font-weight: 570;",
            "    line-height: 1.35;",
            "    text-decoration: none;",
            "}",
            ".site-menu-panel a:hover {",
            "    background: var(--menu-soft);",
            "    color: var(--menu-accent);",
            "}",
            ".site-menu-panel a[aria-current] {",
            "    background: var(--menu-soft);",
            "    color: var(--menu-accent);",
            "    font-weight: 750;",
            "}",
            "@media (max-width: 480px) {",
            "    .site-menu-trigger { padding-inline: 13px; }",
            "    .site-menu-panel { top: 66px; max-height: calc(100vh - 80px); padding: 18px; }",
            "    .site-menu-panel a { padding-block: 9px; }",
            "}",
            "@media (prefers-color-scheme: dark) {",
            "    :host {",
            "        --menu-paper: #1b1915;",
            "        --menu-ink: #f0e8dc;",
            "        --menu-muted: #b5aa9d;",
            "        --menu-accent: #7eacf0;",
            "        --menu-soft: #26231e;",
            "        --menu-line: #3c3730;",
            "    }",
            "    .site-menu-trigger { box-shadow: 0 5px 20px rgba(0, 0, 0, 0.28); }",
            "    .site-menu-panel { box-shadow: 0 24px 64px rgba(0, 0, 0, 0.45); }",
            "}",
            "@media (prefers-reduced-motion: reduce) {",
            "    *, *::before, *::after { scroll-behavior: auto !important; }",
            "}",
            "@media print {",
            "    :host { display: none !important; }",
            "}"
        ].join("\n");
        root.appendChild(style);

        var trigger = document.createElement("button");
        trigger.type = "button";
        trigger.className = "site-menu-trigger";
        trigger.textContent = "Menu";
        trigger.setAttribute("aria-expanded", "false");
        trigger.setAttribute("aria-controls", "site-menu-panel");
        root.appendChild(trigger);

        var panel = document.createElement("nav");
        panel.id = "site-menu-panel";
        panel.className = "site-menu-panel";
        panel.setAttribute("aria-label", "Portfolio navigation");
        panel.hidden = true;

        var header = document.createElement("div");
        header.className = "site-menu-header";

        var title = document.createElement("p");
        title.id = "site-menu-title";
        title.className = "site-menu-title";
        title.textContent = "Vimal Vivegananda";
        header.appendChild(title);

        var closeButton = document.createElement("button");
        closeButton.type = "button";
        closeButton.className = "site-menu-close";
        closeButton.textContent = "Close";
        closeButton.setAttribute("aria-label", "Close website navigation");
        header.appendChild(closeButton);
        panel.appendChild(header);

        function closeMenu(restoreFocus) {
            if (panel.hidden) {
                return;
            }

            panel.hidden = true;
            trigger.setAttribute("aria-expanded", "false");

            if (restoreFocus) {
                trigger.focus();
            }
        }

        function openMenu() {
            panel.hidden = false;
            trigger.setAttribute("aria-expanded", "true");

            var firstLink = panel.querySelector("a");
            if (firstLink) {
                firstLink.focus();
            }
        }

        createMenuGroup(panel, "Explore", [
            { label: "Home", href: buildSiteUrl("") },
            { label: "About", href: buildSiteUrl("#about") },
            { label: "My work", href: buildSiteUrl("#work") },
            { label: "Song of the month", href: buildSiteUrl("#music") },
            { label: "Contact", href: "mailto:vimal134@pm.me" }
        ], closeMenu);

        root.appendChild(panel);

        if (existingHomeButton) {
            existingHomeButton.replaceWith(host);
        } else {
            document.body.insertBefore(host, document.body.firstChild);
        }

        trigger.addEventListener("click", function () {
            if (panel.hidden) {
                openMenu();
            } else {
                closeMenu(true);
            }
        });

        closeButton.addEventListener("click", function () {
            closeMenu(true);
        });

        document.addEventListener("keydown", function (event) {
            if (event.key === "Escape" && !panel.hidden) {
                event.preventDefault();
                closeMenu(true);
            }
        });

        document.addEventListener("pointerdown", function (event) {
            if (panel.hidden) {
                return;
            }

            var path = typeof event.composedPath === "function" ? event.composedPath() : [];
            if (path.indexOf(host) === -1) {
                closeMenu(false);
            }
        });

        window.addEventListener("hashchange", function () {
            var links = panel.querySelectorAll("a");
            Array.prototype.forEach.call(links, function (link) {
                link.removeAttribute("aria-current");
                var currentValue = getCurrentAriaValue(link.href);
                if (currentValue) {
                    link.setAttribute("aria-current", currentValue);
                }
            });
        });
    }

    initializeSiteMenu();
})();
