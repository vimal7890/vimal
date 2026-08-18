#!/usr/bin/env node
/**
 * Quick Facts injector: reads leaders.csv + membership-data.json (the site's
 * sources of truth) and injects a marker-delimited "Quick Facts" card into
 * each matching denomination page, showing tradition breadcrumb, current
 * leader, tenure start, live days-in-office (filled by denomination-facts.js),
 * and membership with source.
 *
 * Idempotent: content between <!-- leader-facts:start --> and
 * <!-- leader-facts:end --> is replaced on every run.
 *
 * Page matching mirrors religious-tracker.html: the denominationPages map is
 * parsed straight out of that file, with a slugified-filename fallback.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const denomDir = path.join(root, "religious-denominations");

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

function slugify(value) {
    return String(value)
        .normalize("NFD")
        .replace(/[̀-ͯ]/g, "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
}

function hasExactDatePrecision(sinceDateStr) {
    if (!sinceDateStr) return false;
    return /^[A-Za-z]+\s+\d{1,2}(st|nd|rd|th)?\s+\d{4}$/.test(sinceDateStr.trim());
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
    const membership = JSON.parse(fs.readFileSync(path.join(root, "membership-data.json"), "utf8"));
    const pagesMap = loadDenominationPagesMap();
    const existingFiles = new Set(fs.readdirSync(denomDir).filter((f) => f.endsWith(".html")));
    const slugToFile = new Map([...existingFiles].map((f) => [f.replace(/\.html$/, ""), f]));

    const headers = csvRows[0].map((h) => h.trim().toLowerCase());
    const idx = {
        religion: headers.indexOf("religion"),
        denomination: headers.indexOf("denomination"),
        sub: headers.indexOf("sub denomination"),
        sub2: headers.indexOf("sub denomination 2"),
        leader: headers.indexOf("leader"),
        since: headers.indexOf("since"),
    };

    const pageFacts = new Map(); // filename -> facts
    let unmatchedRows = 0;

    for (const columns of csvRows.slice(1)) {
        const religion = (columns[idx.religion] || "").trim();
        const denomination = (columns[idx.denomination] || "").trim();
        const sub = (columns[idx.sub] || "").trim();
        const sub2 = (columns[idx.sub2] || "").trim();
        const leader = (columns[idx.leader] || "").trim();
        const since = (columns[idx.since] || "").trim();

        const candidates = [
            sub2,
            sub2.includes("/") ? sub2.split("/")[0].trim() : "",
            sub && sub2 ? `${sub} (${sub2})` : "",
            sub,
            denomination,
        ].filter(Boolean);

        let fileName = null;
        let matchedLabel = null;
        for (const candidate of candidates) {
            const mapped = pagesMap.get(candidate);
            if (mapped) {
                fileName = path.basename(mapped);
                matchedLabel = candidate;
                break;
            }
            const bySlug = slugToFile.get(slugify(candidate));
            if (bySlug) {
                fileName = bySlug;
                matchedLabel = candidate;
                break;
            }
        }

        if (!fileName || !existingFiles.has(fileName)) {
            unmatchedRows += 1;
            continue;
        }
        if (pageFacts.has(fileName)) continue; // first row wins

        let members = null;
        for (const candidate of candidates) {
            if (membership[candidate]) {
                members = membership[candidate];
                break;
            }
        }

        const breadcrumb = [religion, denomination, sub]
            .filter((level) => level && level !== matchedLabel)
            .join(" · ");

        pageFacts.set(fileName, { breadcrumb, leader: formatLeaderRole(leader), since, members });
    }

    let injected = 0;
    for (const [fileName, facts] of pageFacts) {
        const filePath = path.join(denomDir, fileName);
        let html = fs.readFileSync(filePath, "utf8");

        const rows = [];
        if (facts.breadcrumb) {
            rows.push(`<div class="fact"><dt>Tradition</dt><dd>${escapeHtml(facts.breadcrumb)}</dd></div>`);
        }
        if (facts.leader) {
            rows.push(`<div class="fact"><dt>Current leader</dt><dd>${escapeHtml(facts.leader)}</dd></div>`);
        }
        if (facts.since && facts.since.toLowerCase() !== "n/a") {
            rows.push(`<div class="fact"><dt>Leader since</dt><dd>${escapeHtml(facts.since)}</dd></div>`);
            if (hasExactDatePrecision(facts.since)) {
                rows.push(
                    `<div class="fact"><dt>Days in office</dt><dd><span class="days-in-office" data-since="${escapeHtml(facts.since)}">–</span></dd></div>`,
                );
            }
        }
        if (facts.members && facts.members.members && facts.members.members.toLowerCase() !== "n/a") {
            const source = facts.members.source
                ? `<span class="fact-sub">${escapeHtml(facts.members.source)}</span>`
                : "";
            rows.push(`<div class="fact"><dt>Members</dt><dd>${escapeHtml(facts.members.members)}${source}</dd></div>`);
        }
        if (rows.length === 0) continue;

        const card = [
            "        <!-- leader-facts:start -->",
            '        <section class="info-card leader-facts" aria-label="Quick facts">',
            '            <h2 class="section-title">Quick Facts</h2>',
            '            <dl class="facts-grid">',
            ...rows.map((r) => `                ${r}`),
            "            </dl>",
            "        </section>",
            "        <!-- leader-facts:end -->",
        ].join("\n");

        const existingBlock = html.match(/[ \t]*<!-- leader-facts:start -->[\s\S]*?<!-- leader-facts:end -->/);
        if (existingBlock) {
            html = html.replace(existingBlock[0], () => card);
        } else if (html.includes("<!-- leader-image:end -->")) {
            html = html.replace("<!-- leader-image:end -->", () => `<!-- leader-image:end -->\n${card}`);
        } else {
            const titleMatch = html.match(/<h1 class="page-title">[\s\S]*?<\/h1>/);
            if (!titleMatch) continue;
            html = html.replace(titleMatch[0], () => `${titleMatch[0]}\n${card}`);
        }

        if (!html.includes("denomination-facts.js")) {
            html = html.replace(
                /([ \t]*)<script src="\.\.\/home-button-loader\.js"/,
                '$1<script src="denomination-facts.js" defer></script>\n$1<script src="../home-button-loader.js"',
            );
        }

        fs.writeFileSync(filePath, html, "utf8");
        injected += 1;
    }

    console.log(
        `Injected Quick Facts into ${injected} page(s); ${unmatchedRows} CSV row(s) had no matching page; ${existingFiles.size - injected} page(s) without facts.`,
    );
}

main();
