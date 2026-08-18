(function () {
    "use strict";

    // Fills .days-in-office spans with a live day count computed from their
    // data-since attribute (only present when the date has day precision).
    function parseSinceDate(value) {
        var cleaned = String(value || "").replace(/(\d+)(st|nd|rd|th)/, "$1");
        var parsed = new Date(cleaned + " 12:00:00 UTC");
        return isNaN(parsed.getTime()) ? null : parsed;
    }

    function updateDayCounts() {
        var spans = document.querySelectorAll(".days-in-office[data-since]");
        Array.prototype.forEach.call(spans, function (span) {
            var since = parseSinceDate(span.getAttribute("data-since"));
            if (!since) {
                return;
            }
            var days = Math.floor((Date.now() - since.getTime()) / 86400000);
            if (days >= 0) {
                span.textContent = days.toLocaleString();
            }
        });
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", updateDayCounts);
    } else {
        updateDayCounts();
    }
})();
