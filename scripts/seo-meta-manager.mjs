#!/usr/bin/env node
/**
 * SEO meta manager: stamps every HTML page with a marker-delimited head block
 * (meta description, canonical, Open Graph / Twitter cards, theme-color, and
 * JSON-LD structured data) and regenerates sitemap.xml.
 *
 * Idempotent: content between <!-- seo:start --> and <!-- seo:end --> is
 * replaced on every run; everything else in the page is left untouched.
 *
 * Canonical URLs are extensionless (GitHub Pages serves /polio for polio.html).
 *
 * Usage:
 *   node scripts/seo-meta-manager.mjs           # inject + write sitemap.xml
 *   node scripts/seo-meta-manager.mjs --check   # exit 1 if anything would change
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const ORIGIN = "https://vimal.my";
const SITE_NAME = "Vimal Vivegananda";
const OG_IMAGE = `${ORIGIN}/assets/og-card.png`;
const excludedDirs = new Set([".git", "node_modules", "scripts", "report-images", "assets", ".github", ".vscode"]);
const checkMode = process.argv.includes("--check");

const PERSON_JSONLD = {
    "@context": "https://schema.org",
    "@type": "Person",
    name: "Vimal Vivegananda",
    url: `${ORIGIN}/`,
    description: "International Politics graduate; MSc Social and Geographic Data Science student at UCL.",
    affiliation: {
        "@type": "CollegeOrUniversity",
        name: "University College London",
    },
    sameAs: [
        "https://substack.com/@vimal0",
        "https://www.linkedin.com/in/vimal-v-5004751ba/",
    ],
};

const DATASET_JSONLD = {
    "@context": "https://schema.org",
    "@type": "Dataset",
    name: "Religious Leader Tracker",
    description:
        "A hand-researched dataset tracking current leadership across 150+ religious denominations worldwide: leader, tenure start date, membership figures, and sources.",
    url: `${ORIGIN}/religious-tracker`,
    creator: { "@type": "Person", name: "Vimal Vivegananda", url: `${ORIGIN}/` },
    distribution: [
        {
            "@type": "DataDownload",
            encodingFormat: "text/csv",
            contentUrl: `${ORIGIN}/leaders.csv`,
        },
    ],
};

/** Per-page metadata. Pages not listed here fall back to generic handling
 *  (denomination pages derive their description from the intro paragraph). */
const PAGE_META = {
    "index.html": {
        description:
            "Vimal Vivegananda — International Politics graduate and MSc Social & Geographic Data Science student at UCL. Data-driven research on censorship, privacy law, and political trends.",
        ogType: "website",
        jsonld: PERSON_JSONLD,
    },
    "religious-tracker.html": {
        description:
            "A live tracker of leadership across 150+ religious denominations worldwide — leaders, tenure, membership figures, and sources.",
        ogType: "website",
        jsonld: DATASET_JSONLD,
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
    "dataset.html": {
        description:
            "Documentation and download for the Religious Leader Tracker dataset: schema, methodology, and sourcing for 150+ denominations.",
        ogType: "website",
        jsonld: DATASET_JSONLD,
    },
    "succession-log.html": {
        description:
            "A change log of religious leadership successions recorded by the Religious Leader Tracker, newest first.",
        ogType: "website",
    },
    "404.html": {
        description: "Page not found.",
        ogType: "website",
        noindex: true,
    },
};

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

function collectHtmlFiles(dirPath, acc = []) {
    for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
        if (entry.name.startsWith(".")) continue;
        const fullPath = path.join(dirPath, entry.name);
        if (entry.isDirectory()) {
            if (!excludedDirs.has(entry.name)) collectHtmlFiles(fullPath, acc);
            continue;
        }
        if (entry.isFile() && entry.name.toLowerCase().endsWith(".html")) {
            acc.push(fullPath);
        }
    }
    return acc;
}

function canonicalUrlFor(rel) {
    const posix = rel.split(path.sep).join("/");
    if (posix === "index.html") return `${ORIGIN}/`;
    return `${ORIGIN}/${posix.replace(/\.html$/, "")}`;
}

function extractTitle(html) {
    const match = html.match(/<title>([\s\S]*?)<\/title>/i);
    return match ? decodeEntities(match[1].replace(/\s+/g, " ").trim()) : SITE_NAME;
}

function extractIntroDescription(html) {
    const match = html.match(/<p class="intro-text">([\s\S]*?)<\/p>/i);
    if (!match) return null;
    let text = decodeEntities(match[1].replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
    if (text.length > 260) {
        const cut = text.slice(0, 260);
        const lastSentence = cut.lastIndexOf(". ");
        text = lastSentence > 80 ? cut.slice(0, lastSentence + 1) : `${cut.trimEnd()}…`;
    }
    return text;
}

function buildSeoBlock({ title, description, canonical, ogType, noindex, jsonld }) {
    const lines = [
        `<meta name="description" content="${escapeAttr(description)}">`,
        `<link rel="canonical" href="${canonical}">`,
        `<meta property="og:site_name" content="${escapeAttr(SITE_NAME)}">`,
        `<meta property="og:type" content="${ogType}">`,
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
        `<meta name="theme-color" content="#f5f1e8" media="(prefers-color-scheme: light)">`,
        `<meta name="theme-color" content="#15130f" media="(prefers-color-scheme: dark)">`,
    ];
    if (noindex) {
        lines.push(`<meta name="robots" content="noindex">`);
    }
    if (jsonld) {
        lines.push(`<script type="application/ld+json">${JSON.stringify(jsonld)}</script>`);
    }
    return lines;
}

function articleJsonld({ title, description, canonical }) {
    return {
        "@context": "https://schema.org",
        "@type": "Article",
        headline: title,
        description,
        url: canonical,
        image: OG_IMAGE,
        author: { "@type": "Person", name: "Vimal Vivegananda", url: `${ORIGIN}/` },
    };
}

function injectSeoBlock(html, blockLines, indent) {
    const start = `${indent}<!-- seo:start -->`;
    const end = `${indent}<!-- seo:end -->`;
    const block = [start, ...blockLines.map((l) => indent + l), end].join("\n");
    const existing = html.match(/[ \t]*<!-- seo:start -->[\s\S]*?<!-- seo:end -->/);
    if (existing) {
        return html.replace(existing[0], () => block);
    }
    const headClose = html.search(/[ \t]*<\/head>/i);
    if (headClose === -1) return html;
    return `${html.slice(0, headClose)}${block}\n${html.slice(headClose)}`;
}

function main() {
    const files = collectHtmlFiles(root).sort();
    const sitemapUrls = [];
    let changed = 0;

    for (const filePath of files) {
        const rel = path.relative(root, filePath);
        const posix = rel.split(path.sep).join("/");
        const html = fs.readFileSync(filePath, "utf8");

        // Leave redirect stubs alone entirely.
        if (html.includes("This page has moved to") && html.length < 900) continue;
        // Skip the archived redirect (meta refresh straight to home).
        if (/http-equiv="refresh"/i.test(html)) continue;

        const config = PAGE_META[posix] || {};
        const title = extractTitle(html);
        const canonical = canonicalUrlFor(rel);
        const isDenomination = posix.startsWith("religious-denominations/");

        let description = config.description || null;
        if (!description && isDenomination) {
            description = extractIntroDescription(html);
        }
        if (!description) {
            description = `${title} — a project by ${SITE_NAME}.`;
        }

        const ogType = config.ogType || (isDenomination ? "article" : "website");
        let jsonld = config.jsonld || null;
        if (!jsonld && config.article) {
            jsonld = articleJsonld({ title, description, canonical });
        }

        const indentMatch = html.match(/\n([ \t]+)<meta charset/i);
        const indent = indentMatch ? indentMatch[1] : "    ";
        const blockLines = buildSeoBlock({
            title,
            description,
            canonical,
            ogType,
            noindex: config.noindex,
            jsonld,
        });
        const next = injectSeoBlock(html, blockLines, indent);

        if (next !== html) {
            changed += 1;
            if (!checkMode) fs.writeFileSync(filePath, next, "utf8");
        }

        if (!config.noindex) {
            sitemapUrls.push(canonical);
        }
    }

    const sitemap = [
        `<?xml version="1.0" encoding="UTF-8"?>`,
        `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">`,
        ...sitemapUrls.sort().map((url) => `  <url><loc>${url}</loc></url>`),
        `</urlset>`,
        ``,
    ].join("\n");
    const sitemapPath = path.join(root, "sitemap.xml");
    const sitemapChanged = !fs.existsSync(sitemapPath) || fs.readFileSync(sitemapPath, "utf8") !== sitemap;
    if (sitemapChanged) {
        changed += 1;
        if (!checkMode) fs.writeFileSync(sitemapPath, sitemap, "utf8");
    }

    console.log(
        checkMode
            ? `Check complete: ${changed} file(s) out of date (${sitemapUrls.length} URLs in sitemap).`
            : `Stamped SEO metadata on ${files.length} page(s); ${changed} file(s) updated; sitemap has ${sitemapUrls.length} URLs.`,
    );
    if (checkMode && changed > 0) process.exit(1);
}

main();
