#!/usr/bin/env node
/**
 * Succession log builder: derives recent leadership changes from leaders.csv
 * (rows whose tenure start has day precision), renders them newest-first into
 * succession-log.html between <!-- log:start --> / <!-- log:end --> markers,
 * and writes an RSS feed (feed.xml) of the 20 most recent changes.
 *
 * Run after editing leaders.csv. Idempotent.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const ORIGIN = "https://vimal.my";
const MONTHS = {
    january: 0, february: 1, march: 2, april: 3, may: 4, june: 5,
    july: 6, august: 7, september: 8, october: 9, november: 10, december: 11,
};

function parseCSV(csvText) {
    const rows = [];
    let row = [];
    let value = "";
    let inQuotes = false;
    for (let i = 0; i < csvText.length; i++) {
        const char = csvText[i];
        const nextChar = csvText[i + 1];
        if (char === '"') {
            if (inQuotes && nextChar === '"') {
                value += '"';
                i++;
            } else {
                inQuotes = !inQuotes;
            }
        } else if (char === "," && !inQuotes) {
            row.push(value);
            value = "";
        } else if ((char === "\n" || char === "\r") && !inQuotes) {
            if (char === "\r" && nextChar === "\n") i++;
            row.push(value);
            if (row.some((cell) => cell !== "")) rows.push(row);
            row = [];
            value = "";
        } else {
            value += char;
        }
    }
    if (value !== "" || row.length > 0) {
        row.push(value);
        if (row.some((cell) => cell !== "")) rows.push(row);
    }
    return rows;
}

function escapeHtml(value) {
    return String(value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

function escapeXml(value) {
    return escapeHtml(value).replace(/'/g, "&apos;");
}

function slugify(value) {
    return String(value)
        .normalize("NFD")
        .replace(/[̀-ͯ]/g, "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
}

function parseExactDate(since) {
    const m = String(since).trim().match(/^([A-Za-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?\s+(\d{4})$/);
    if (!m) return null;
    const month = MONTHS[m[1].toLowerCase()];
    if (month === undefined) return null;
    return new Date(Date.UTC(Number(m[3]), month, Number(m[2]), 12));
}

function formatLeaderRole(leaderValue) {
    const trimmed = (leaderValue || "").trim();
    if (!trimmed || trimmed.toLowerCase() === "n/a") return "";
    const slashCount = (trimmed.match(/\//g) || []).length;
    if (slashCount !== 1) return trimmed;
    const match = trimmed.match(/^([^/]+?)\s*\/\s*(.+)$/);
    if (!match) return trimmed;
    return `${match[2].trim()} ${match[1].trim()}`.replace(/\s+/g, " ");
}

function loadDenominationPagesMap() {
    const trackerSource = fs.readFileSync(path.join(root, "religious-tracker.html"), "utf8");
    const blockMatch = trackerSource.match(/const denominationPages = \{([\s\S]*?)\};/);
    const map = new Map();
    if (blockMatch) {
        for (const pair of blockMatch[1].matchAll(/"((?:[^"\\]|\\.)*)":\s*"([^"]+)"/g)) {
            map.set(pair[1].replace(/\\"/g, '"'), pair[2]);
        }
    }
    map.set("Church of England", "religious-denominations/church-of-england.html");
    return map;
}

function main() {
    const csvRows = parseCSV(fs.readFileSync(path.join(root, "leaders.csv"), "utf8"));
    const pagesMap = loadDenominationPagesMap();
    const denomDir = path.join(root, "religious-denominations");
    const existingFiles = new Set(fs.readdirSync(denomDir).filter((f) => f.endsWith(".html")));

    const headers = csvRows[0].map((h) => h.trim().toLowerCase());
    const idx = {
        religion: headers.indexOf("religion"),
        denomination: headers.indexOf("denomination"),
        sub: headers.indexOf("sub denomination"),
        sub2: headers.indexOf("sub denomination 2"),
        leader: headers.indexOf("leader"),
        since: headers.indexOf("since"),
    };

    const events = [];
    for (const columns of csvRows.slice(1)) {
        const since = (columns[idx.since] || "").trim();
        const date = parseExactDate(since);
        if (!date || date.getTime() > Date.now()) continue;

        const religion = (columns[idx.religion] || "").trim();
        const denomination = (columns[idx.denomination] || "").trim();
        const sub = (columns[idx.sub] || "").trim();
        const sub2 = (columns[idx.sub2] || "").trim();
        const leader = formatLeaderRole(columns[idx.leader] || "");
        if (!leader) continue;

        const entity = sub2.includes("/") ? sub2.split("/")[0].trim() : sub2 || sub || denomination;
        const candidates = [sub2, entity, sub && sub2 ? `${sub} (${sub2})` : "", sub, denomination].filter(Boolean);
        let pagePath = null;
        for (const candidate of candidates) {
            const mapped = pagesMap.get(candidate);
            if (mapped) {
                pagePath = mapped;
                break;
            }
            const slugFile = `${slugify(candidate)}.html`;
            if (existingFiles.has(slugFile)) {
                pagePath = `religious-denominations/${slugFile}`;
                break;
            }
        }

        events.push({ date, since, leader, entity, religion, pagePath });
    }

    events.sort((a, b) => b.date - a.date);

    // ---- HTML log (all day-precision events, grouped by year) ----
    const byYear = new Map();
    for (const event of events) {
        const year = event.date.getUTCFullYear();
        if (!byYear.has(year)) byYear.set(year, []);
        byYear.get(year).push(event);
    }

    const sections = [];
    for (const [year, yearEvents] of byYear) {
        const items = yearEvents
            .map((event) => {
                const name = event.pagePath
                    ? `<a href="${event.pagePath}">${escapeHtml(event.entity)}</a>`
                    : escapeHtml(event.entity);
                return [
                    '                <li class="log-entry">',
                    `                    <span class="log-date">${escapeHtml(event.since)}</span>`,
                    `                    <span class="log-text"><strong>${escapeHtml(event.leader)}</strong> became leader of ${name} <span class="log-religion">(${escapeHtml(event.religion)})</span></span>`,
                    "                </li>",
                ].join("\n");
            })
            .join("\n");
        sections.push(
            [
                `            <section class="log-year">`,
                `                <h2>${year}</h2>`,
                `                <ol class="log-list">`,
                items,
                `                </ol>`,
                `            </section>`,
            ].join("\n"),
        );
    }

    const logBlock = ["        <!-- log:start -->", ...sections, "        <!-- log:end -->"].join("\n");
    const pagePath = path.join(root, "succession-log.html");
    let pageHtml = fs.readFileSync(pagePath, "utf8");
    const existingBlock = pageHtml.match(/[ \t]*<!-- log:start -->[\s\S]*?<!-- log:end -->/);
    if (!existingBlock) {
        console.error("succession-log.html is missing <!-- log:start --> markers");
        process.exit(1);
    }
    pageHtml = pageHtml.replace(existingBlock[0], () => logBlock);
    fs.writeFileSync(pagePath, pageHtml, "utf8");

    // ---- RSS feed of the 20 most recent changes ----
    const feedItems = events.slice(0, 20).map((event) => {
        const link = event.pagePath
            ? `${ORIGIN}/${event.pagePath.replace(/\.html$/, "")}`
            : `${ORIGIN}/religious-tracker`;
        const title = `${event.leader} — ${event.entity}`;
        return [
            "    <item>",
            `      <title>${escapeXml(title)}</title>`,
            `      <link>${escapeXml(link)}</link>`,
            `      <guid isPermaLink="false">${escapeXml(`${slugify(event.entity)}-${event.date.toISOString().slice(0, 10)}`)}</guid>`,
            `      <pubDate>${event.date.toUTCString()}</pubDate>`,
            `      <description>${escapeXml(`${event.leader} became leader of ${event.entity} (${event.religion}) on ${event.since}.`)}</description>`,
            "    </item>",
        ].join("\n");
    });

    const rss = [
        `<?xml version="1.0" encoding="UTF-8"?>`,
        `<rss version="2.0">`,
        `  <channel>`,
        `    <title>Religious Leader Tracker — Succession Log</title>`,
        `    <link>${ORIGIN}/succession-log</link>`,
        `    <description>Leadership changes across 150+ religious denominations, as recorded by the Religious Leader Tracker.</description>`,
        `    <language>en</language>`,
        ...feedItems,
        `  </channel>`,
        `</rss>`,
        ``,
    ].join("\n");
    fs.writeFileSync(path.join(root, "feed.xml"), rss, "utf8");

    console.log(`Succession log: ${events.length} events across ${byYear.size} years; feed.xml has ${feedItems.length} items.`);
}

main();
