(function () {
    "use strict";

    var badges = document.querySelectorAll(".last-edited-badge[data-last-edited-owner][data-last-edited-repo][data-last-edited-path]");

    if (!badges.length) {
        return;
    }

    var formatter = new Intl.DateTimeFormat("en", {
        month: "short",
        day: "numeric",
        year: "numeric",
        timeZone: "UTC"
    });

    function buildCommitsUrl(badge) {
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

    function renderBadge(badge, isoDate) {
        var timeElement = badge.querySelector("time");
        var parsedDate = new Date(isoDate);

        if (!timeElement || Number.isNaN(parsedDate.getTime())) {
            return;
        }

        timeElement.dateTime = parsedDate.toISOString();
        timeElement.textContent = formatter.format(parsedDate);
        badge.hidden = false;
    }

    function loadLastEditedDate(badge) {
        var commitsUrl = buildCommitsUrl(badge);

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
                    renderBadge(badge, isoDate);
                }
            })
            .catch(function () {
                // Leave the badge hidden when the commit date cannot be loaded.
            });
    }

    badges.forEach(loadLastEditedDate);
})();
