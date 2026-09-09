#!/usr/bin/env node
/**
 * Site build. Stamps every root HTML page with two marker-delimited blocks and
 * regenerates sitemap.xml:
 *
 *   <!-- header:start --> … <!-- header:end -->  the shared site header: the
 *                                          name, the Substack / LinkedIn /
 *                                          Email links and the menu bar (in the
 *                                          style of aadi.net.in). Identical on
 *                                          every page apart from the bigger
 *                                          homepage name; always the first
 *                                          thing in <body>.
 *   <!-- seo:start --> … <!-- seo:end -->   description, canonical, Open Graph,
 *                                          Twitter card, theme-color, JSON-LD
 *
 * Idempotent: the content between markers is replaced on every run and nothing
 * else in a page is touched. Canonical URLs are extensionless because GitHub
 * Pages serves /polio for polio.html.
 *
 *   node scripts/build.mjs          # write pages + sitemap.xml
 *   node scripts/build.mjs --check  # exit 1 if anything would change (CI)
 */
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const checkMode = process.argv.includes("--check");

const ORIGIN = "https://vimal.my";
const SITE_NAME = "Vimal Vivegananda";
const OG_IMAGE = `${ORIGIN}/assets/og-card.png`;
// Same file as the @font-face in site.css; preloading starts the fetch alongside the stylesheet.
const FONT_URL = "https://cdn.jsdelivr.net/gh/sebsan/bagnard/Bagnard.otf";
const CONTACT = "mailto:vimal134@pm.me";

const PERSON = {
    "@context": "https://schema.org",
    "@type": "Person",
    name: SITE_NAME,
    url: `${ORIGIN}/`,
    description: "International Politics graduate; MSc Social and Geographic Data Science student at UCL.",
    affiliation: { "@type": "CollegeOrUniversity", name: "University College London" },
    sameAs: ["https://substack.com/@vimal0", "https://www.linkedin.com/in/vimal-v-5004751ba/"],
};

/** Per-page metadata. Every page in the repo root must be listed here. */
const PAGES = {
    "index.html": {
        description:
            "Vimal Vivegananda — International Politics graduate and MSc Social & Geographic Data Science student at UCL. Data-driven research on censorship, privacy law, and political trends.",
        ogType: "website",
        jsonld: PERSON,
    },
    "work.html": {
        description:
            "Selected work by Vimal Vivegananda — data-driven research on censorship, privacy law, and political trends.",
        ogType: "website",
    },
    "polio.html": {
        description:
            "Tracking the global eradication of polio: vaccination campaigns have pushed endemic transmission down to just two countries.",
        ogType: "article",
    },
    "mapping-the-papacy.html": {
        description:
            "A data visualisation tracing where the last eleven popes were born, and how the papacy's centre of gravity has shifted away from Italy.",
        ogType: "article",
    },
    "song-archive.html": {
        description: "An archive of Vimal's Song of the Month picks, with the story behind each one.",
        ogType: "website",
    },
    // Placeholder: drop `noindex` once the blog has content.
    "blog.html": {
        description: "Writing by Vimal Vivegananda — coming soon.",
        ogType: "website",
        noindex: true,
    },
    "resume.html": {
        description: "Vimal Vivegananda's education, experience, projects, leadership and technical skills.",
        ogType: "website",
    },
    "report-calgary-cambridge.html": {
        description:
            "Analysing mobility patterns in Cambridge with street-network routing and stop detection, plus machine-learning sentiment classification of Calgary restaurant reviews.",
        ogType: "article",
        article: true,
    },
    "report-london-house-prices.html": {
        description:
            "Using a GraphSAGE graph neural network on London's LSOA adjacency graph to predict median house prices, beating non-spatial baselines (R² = 0.767).",
        ogType: "article",
        article: true,
    },
    "report-housing-fertility.html": {
        description:
            "Housing constraints contribute to Europe's fertility decline through space, affordability, and tenure insecurity — with three policy recommendations.",
        ogType: "article",
        article: true,
    },
    "404.html": {
        description: "Page not found.",
        ogType: "website",
        noindex: true,
    },
};

/** The homepage is the About Me page, so "About Me" points at the site root. */
const NAV_LINKS = [
    { label: "About Me", href: "/" },
    { label: "My Work", href: "/work" },
    { label: "Resume", href: "/resume" },
    { label: "Blog", href: "/blog" },
    { label: "Song of the Month", href: "/song-archive" },
];

/** File -> menu href, so the menu can mark the current page. */
const NAV_CURRENT = {
    "index.html": "/",
    "work.html": "/work",
    "song-archive.html": "/song-archive",
    "blog.html": "/blog",
    "resume.html": "/resume",
};

/** The social links that sit under the name in the header. */
const SOCIAL_LINKS = [
    {
        label: "Substack",
        href: "https://substack.com/@vimal0?",
        className: "social-link",
        external: true,
        path: "M22.539 8.242H1.46V5.406h21.08v2.836zM1.46 10.812V24L12 18.11 22.54 24V10.812H1.46zM22.54 0H1.46v2.836h21.08V0z",
    },
    {
        label: "LinkedIn",
        href: "https://www.linkedin.com/in/vimal-v-5004751ba/",
        className: "social-link linkedin-link",
        external: true,
        path: "M20.45 20.45h-3.56v-5.57c0-1.33-.03-3.04-1.85-3.04-1.85 0-2.13 1.45-2.13 2.95v5.66H9.35V9h3.42v1.56h.05c.48-.9 1.64-1.85 3.38-1.85 3.61 0 4.27 2.38 4.27 5.48v6.26ZM5.34 7.43a2.07 2.07 0 1 1 0-4.14 2.07 2.07 0 0 1 0 4.14ZM7.12 20.45H3.56V9h3.56v11.45Z",
    },
    {
        label: "Email",
        href: CONTACT,
        className: "social-link email-link",
        path: "M20 4H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2zm0 4-8 5-8-5V6l8 5 8-5v2z",
    },
];

function escapeAttr(value) {
    return String(value)
        .replace(/&/g, "&amp;")
        .replace(/"/g, "&quot;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
}

function decodeEntities(value) {
    return String(value)
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&ndash;/g, "–")
        .replace(/&mdash;/g, "—");
}

function extractTitle(html) {
    const match = html.match(/<title>([\s\S]*?)<\/title>/i);
    return match ? decodeEntities(match[1].replace(/\s+/g, " ").trim()) : SITE_NAME;
}

function canonicalFor(file) {
    return file === "index.html" ? `${ORIGIN}/` : `${ORIGIN}/${file.replace(/\.html$/, "")}`;
}

/** Replace the block between `<!-- marker:start/end -->`, or insert it at `insertAt(html)`.
 *  An existing block keeps its current indentation (pages differ: some indent
 *  the whole body, some do not); `indent` is only used when inserting. */
function stamp(html, marker, lines, indent, insertAt) {
    const found = html.match(new RegExp(`([ \\t]*)<!-- ${marker}:start -->[\\s\\S]*?<!-- ${marker}:end -->`));
    if (found) {
        const at = found[1] || indent;
        const block = [
            `${at}<!-- ${marker}:start -->`,
            ...lines.map((line) => at + line),
            `${at}<!-- ${marker}:end -->`,
        ].join("\n");
        return html.replace(found[0], () => block);
    }
    const block = [
        `${indent}<!-- ${marker}:start -->`,
        ...lines.map((line) => indent + line),
        `${indent}<!-- ${marker}:end -->`,
    ].join("\n");
    const at = insertAt(html);
    if (at === -1) throw new Error(`Could not place the ${marker} block`);
    return `${html.slice(0, at)}${block}\n${html.slice(at)}`;
}

function seoLines(file, html, meta) {
    const title = extractTitle(html);
    const canonical = canonicalFor(file);
    const description = meta.description;
    let jsonld = meta.jsonld || null;
    if (!jsonld && meta.article) {
        jsonld = {
            "@context": "https://schema.org",
            "@type": "Article",
            headline: title,
            description,
            url: canonical,
            image: OG_IMAGE,
            author: { "@type": "Person", name: SITE_NAME, url: `${ORIGIN}/` },
        };
    }
    const lines = [
        `<link rel="preload" href="${FONT_URL}" as="font" type="font/otf" crossorigin>`,
        `<meta name="description" content="${escapeAttr(description)}">`,
        `<link rel="canonical" href="${canonical}">`,
        `<meta property="og:site_name" content="${escapeAttr(SITE_NAME)}">`,
        `<meta property="og:type" content="${meta.ogType}">`,
        `<meta property="og:title" content="${escapeAttr(title)}">`,
        `<meta property="og:description" content="${escapeAttr(description)}">`,
        `<meta property="og:url" content="${canonical}">`,
        `<meta property="og:image" content="${OG_IMAGE}">`,
        `<meta property="og:image:width" content="1200">`,
        `<meta property="og:image:height" content="630">`,
        `<meta name="twitter:card" content="summary_large_image">`,
        `<meta name="twitter:title" content="${escapeAttr(title)}">`,
        `<meta name="twitter:description" content="${escapeAttr(description)}">`,
        `<meta name="twitter:image" content="${OG_IMAGE}">`,
        `<meta name="theme-color" content="#ffffff" media="(prefers-color-scheme: light)">`,
        `<meta name="theme-color" content="#15130f" media="(prefers-color-scheme: dark)">`,
    ];
    if (meta.noindex) lines.push(`<meta name="robots" content="noindex">`);
    if (jsonld) lines.push(`<script type="application/ld+json">${JSON.stringify(jsonld)}</script>`);
    return lines;
}

/** The header block: name, social links, menu — identical on every page, down to
 *  the name's size and its Latin/Tamil cross-fade (site.js). The only difference
 *  is the markup of the name itself: the homepage's <h1>, or a link home so the
 *  other pages keep their own <h1>. */
function headerLines(file) {
    const home = file === "index.html";
    const name = home
        ? `    <h1 class="site-name">Vimal</h1>`
        : `    <a class="site-name" href="/">Vimal</a>`;

    const socials = SOCIAL_LINKS.flatMap((link) => {
        const target = link.external ? ` target="_blank" rel="noopener noreferrer"` : "";
        return [
            `        <a href="${escapeAttr(link.href)}" class="${link.className}"${target}>`,
            `            <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="${link.path}"/></svg>`,
            `            ${link.label}`,
            `        </a>`,
        ];
    });

    const items = NAV_LINKS.map((link) => {
        const current = NAV_CURRENT[file] === link.href ? ' aria-current="page"' : "";
        return `            <li><a href="${link.href}"${current}>${link.label}</a></li>`;
    });

    return [
        `<header class="site-header">`,
        name,
        `    <div class="social-links">`,
        ...socials,
        `    </div>`,
        `    <nav class="site-nav" aria-label="Site navigation">`,
        `        <ul>`,
        ...items,
        `        </ul>`,
        `    </nav>`,
        `</header>`,
        `<script src="/site.js" defer></script>`,
    ];
}

/** Root HTML pages to stamp. Untracked scratch files are skipped with a note;
 *  a tracked page missing from PAGES is an error so no page ships without metadata. */
function listPages() {
    const all = fs.readdirSync(root).filter((name) => name.toLowerCase().endsWith(".html")).sort();
    let tracked = null;
    try {
        tracked = new Set(
            execSync("git ls-files -- '*.html'", { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] })
                .split("\n")
                .filter(Boolean),
        );
    } catch {
        tracked = null; // not a git checkout: treat every file as tracked
    }

    const pages = [];
    const missing = [];
    for (const file of all) {
        if (PAGES[file]) pages.push(file);
        else if (tracked && !tracked.has(file)) console.log(`Skipping untracked ${file} (no entry in PAGES)`);
        else missing.push(file);
    }
    if (missing.length) {
        console.error(`No metadata for: ${missing.join(", ")} — add them to PAGES in scripts/build.mjs`);
        process.exit(1);
    }
    return pages;
}

function main() {
    const files = listPages();

    let changed = 0;
    const sitemapUrls = [];

    for (const file of files) {
        const filePath = path.join(root, file);
        const html = fs.readFileSync(filePath, "utf8");
        const meta = PAGES[file];

        const headIndent = (html.match(/\n([ \t]+)<meta charset/i) || [, "    "])[1];
        let next = stamp(html, "seo", seoLines(file, html, meta), headIndent, (h) => h.search(/[ \t]*<\/head>/i));

        const bodyIndent = (next.match(/<body[^>]*>\n([ \t]*)\S/) || [, "    "])[1];
        next = stamp(next, "header", headerLines(file), bodyIndent, (h) => {
            const open = h.match(/<body[^>]*>\n?/i);
            return open ? open.index + open[0].length : -1;
        });

        if (next !== html) {
            changed += 1;
            if (!checkMode) fs.writeFileSync(filePath, next, "utf8");
        }
        if (!meta.noindex) sitemapUrls.push(canonicalFor(file));
    }

    const sitemap = [
        `<?xml version="1.0" encoding="UTF-8"?>`,
        `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">`,
        ...sitemapUrls.sort().map((url) => `  <url><loc>${url}</loc></url>`),
        `</urlset>`,
        ``,
    ].join("\n");
    const sitemapPath = path.join(root, "sitemap.xml");
    if (!fs.existsSync(sitemapPath) || fs.readFileSync(sitemapPath, "utf8") !== sitemap) {
        changed += 1;
        if (!checkMode) fs.writeFileSync(sitemapPath, sitemap, "utf8");
    }

    console.log(
        checkMode
            ? `Check complete: ${changed} file(s) out of date (${sitemapUrls.length} URLs in sitemap).`
            : `Stamped ${files.length} page(s); ${changed} file(s) updated; sitemap has ${sitemapUrls.length} URLs.`,
    );
    if (checkMode && changed > 0) process.exit(1);
}

main();
