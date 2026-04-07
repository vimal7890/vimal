(function () {
    "use strict";

    var script = document.currentScript;
    var homeHref = (script && script.dataset && script.dataset.homeHref) ? script.dataset.homeHref : "index.html";

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
