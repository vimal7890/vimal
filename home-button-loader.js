(function () {
    "use strict";

    var script = document.currentScript;
    var homeHref = (script && script.dataset && script.dataset.homeHref) ? script.dataset.homeHref : "index.html";
    var scrollStorageKey = "page-scroll:" + window.location.pathname + window.location.search;
    var isRestoringScroll = false;
    var lastEditedOwner = "vimal7890";
    var lastEditedRepo = "vimal";
    var lastEditedBranch = "main";
    var lastEditedFormatter = new Intl.DateTimeFormat("en", {
        month: "short",
        day: "numeric",
        year: "numeric",
        timeZone: "UTC"
    });

    function getDenominationPageRepoPath() {
        var pathname = window.location.pathname || "";
        var marker = "/religious-denominations/";
        var markerIndex = pathname.lastIndexOf(marker);
        var repoPath = "";

        if (markerIndex === -1) {
            return "";
        }

        repoPath = pathname.slice(markerIndex + 1);

        try {
            return decodeURIComponent(repoPath);
        } catch (error) {
            return repoPath;
        }
    }

    function buildLastEditedCommitsUrl(badge) {
        var owner = badge.dataset.lastEditedOwner;
        var repo = badge.dataset.lastEditedRepo;
        var branch = badge.dataset.lastEditedBranch || "main";
        var path = badge.dataset.lastEditedPath;

        if (!owner || !repo || !path) {
            return null;
        }

        var params = new URLSearchParams({
            sha: branch,
            path: path,
            per_page: "1"
        });

        return "https://api.github.com/repos/" + encodeURIComponent(owner) + "/" + encodeURIComponent(repo) + "/commits?" + params.toString();
    }

    function renderLastEditedBadge(badge, isoDate) {
        var timeElement = badge.querySelector("time");
        var parsedDate = new Date(isoDate);

        if (!timeElement || Number.isNaN(parsedDate.getTime())) {
            return;
        }

        timeElement.dateTime = parsedDate.toISOString();
        timeElement.textContent = lastEditedFormatter.format(parsedDate);
        badge.hidden = false;
    }

    function loadLastEditedDate(badge) {
        var commitsUrl = buildLastEditedCommitsUrl(badge);

        if (!commitsUrl) {
            return;
        }

        fetch(commitsUrl, {
            headers: {
                Accept: "application/vnd.github+json"
            }
        })
            .then(function (response) {
                if (!response.ok) {
                    throw new Error("Unable to load last edited date");
                }

                return response.json();
            })
            .then(function (commits) {
                var latestCommit = Array.isArray(commits) ? commits[0] : null;
                var isoDate = latestCommit && latestCommit.commit && latestCommit.commit.committer && latestCommit.commit.committer.date;

                if (isoDate) {
                    renderLastEditedBadge(badge, isoDate);
                }
            })
            .catch(function () {
                // Leave the badge hidden when the commit date cannot be loaded.
            });
    }

    function createLastEditedBadge(repoPath) {
        var badge = document.createElement("p");
        var label = document.createElement("span");
        var time = document.createElement("time");

        badge.className = "last-edited-badge";
        badge.hidden = true;
        badge.dataset.lastEditedOwner = lastEditedOwner;
        badge.dataset.lastEditedRepo = lastEditedRepo;
        badge.dataset.lastEditedBranch = lastEditedBranch;
        badge.dataset.lastEditedPath = repoPath;

        label.className = "last-edited-label";
        label.textContent = "Last edited";

        badge.appendChild(label);
        badge.appendChild(time);

        return badge;
    }

    function ensureDenominationLastEditedBadge() {
        var repoPath = getDenominationPageRepoPath();
        var container = null;
        var meta = null;
        var badge = null;
        var child = null;

        if (!repoPath) {
            return null;
        }

        container = document.querySelector(".container");
        if (!container) {
            return null;
        }

        badge = container.querySelector(".last-edited-badge");
        if (badge) {
            if (!badge.dataset.lastEditedOwner) {
                badge.dataset.lastEditedOwner = lastEditedOwner;
            }
            if (!badge.dataset.lastEditedRepo) {
                badge.dataset.lastEditedRepo = lastEditedRepo;
            }
            if (!badge.dataset.lastEditedBranch) {
                badge.dataset.lastEditedBranch = lastEditedBranch;
            }
            if (!badge.dataset.lastEditedPath) {
                badge.dataset.lastEditedPath = repoPath;
            }

            return badge;
        }

        child = container.firstElementChild;
        while (child) {
            if (child.classList && child.classList.contains("page-top-meta")) {
                meta = child;
                break;
            }
            child = child.nextElementSibling;
        }

        if (!meta) {
            meta = document.createElement("div");
            meta.className = "page-top-meta";
            container.insertBefore(meta, container.firstChild);
        }

        badge = createLastEditedBadge(repoPath);
        meta.appendChild(badge);
        return badge;
    }

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

    var lastEditedBadge = ensureDenominationLastEditedBadge();
    if (lastEditedBadge) {
        loadLastEditedDate(lastEditedBadge);
    }

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
