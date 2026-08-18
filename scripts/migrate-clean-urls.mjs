#!/usr/bin/env node
/**
 * Convert site pages from page.html → page/index.html so GitHub Pages
 * serves clean URLs (e.g. /report-calgary-cambridge/ instead of .html).
 *
 * Leaves thin redirect stubs at the old .html paths for bookmarks.
 * index.html stays at the site root.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, "..");
const excludedDirs = new Set([".git", "node_modules", "scripts", "report-images"]);

function isSpecialUrl(url) {
    if (!url || typeof url !== "string") return true;
    const trimmed = url.trim();
    if (!trimmed) return true;
    if (trimmed.startsWith("#")) return true;
    if (trimmed.startsWith("/")) return true;
    if (/^(https?:|\/\/|data:|mailto:|tel:|javascript:|blob:)/i.test(trimmed)) return true;
    return false;
}

function cleanPagePath(pathPart) {
    if (!pathPart.endsWith(".html")) {
        return pathPart;
    }

    const withoutExt = pathPart.slice(0, -".html".length);

    // index.html → directory form (./ or ../ or ../../)
    if (withoutExt === "index" || withoutExt.endsWith("/index")) {
        const dir = withoutExt.slice(0, -"index".length);
        return dir === "" ? "./" : dir;
    }

    return `${withoutExt}/`;
}

function rewriteUrl(url, deepen) {
    if (isSpecialUrl(url)) {
        return url;
    }

    const match = url.match(/^([^?#]*)([?#][\s\S]*)?$/);
    let pathPart = match[1];
    const suffix = match[2] || "";

    if (deepen) {
        if (pathPart === "" || pathPart === ".") {
            pathPart = "../";
        } else {
            pathPart = `../${pathPart}`;
        }
    }

    pathPart = cleanPagePath(pathPart);
    return pathPart + suffix;
}

function rewriteAttributeUrls(html, deepen) {
    // href="...", src='...', data-home-href="..."
    let next = html.replace(
        /\b(href|src|data-home-href|action|poster|formaction)=(["'])([^"']*)\2/gi,
        (full, attr, quote, value) => {
            const rewritten = rewriteUrl(value, deepen);
            return `${attr}=${quote}${rewritten}${quote}`;
        }
    );

    // meta refresh: content="0;url=index.html"
    next = next.replace(
        /\bcontent=(["'])([^"']*)\1/gi,
        (full, quote, value) => {
            const rewritten = value.replace(
                /(url=)([^;\s]+)/i,
                (m, prefix, target) => `${prefix}${rewriteUrl(target, deepen)}`
            );
            return `content=${quote}${rewritten}${quote}`;
        }
    );

    // JS string paths that point at local .html pages (denomination map, etc.)
    next = next.replace(
        /(["'])((?:\.\.\/)*(?:[\w.-]+\/)*[\w.-]+)\.html(\1)/g,
        (full, quote, base, endQuote) => {
            if (base.includes("://") || base.startsWith("//")) {
                return full;
            }
            const rewritten = rewriteUrl(`${base}.html`, deepen);
            return `${quote}${rewritten}${endQuote}`;
        }
    );

    return next;
}

function collectHtmlFiles(dirPath, acc = []) {
    for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
        if (entry.name.startsWith(".")) continue;
        const fullPath = path.join(dirPath, entry.name);
        if (entry.isDirectory()) {
            if (!excludedDirs.has(entry.name)) {
                collectHtmlFiles(fullPath, acc);
            }
            continue;
        }
        if (entry.isFile() && entry.name.toLowerCase().endsWith(".html")) {
            acc.push(fullPath);
        }
    }
    return acc;
}

function buildRedirectStub(targetDirUrl) {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta http-equiv="refresh" content="0;url=${targetDirUrl}">
    <link rel="canonical" href="${targetDirUrl}">
    <title>Redirecting…</title>
    <script>location.replace(${JSON.stringify(targetDirUrl)} + location.search + location.hash);</script>
</head>
<body>
    <p>This page has moved to <a href="${targetDirUrl}">${targetDirUrl}</a>.</p>
</body>
</html>
`;
}

function migratePage(filePath) {
    const rel = path.relative(root, filePath);
    const baseName = path.basename(filePath, ".html");
    const parentDir = path.dirname(filePath);

    // Keep root index.html in place (only rewrite internal links later)
    if (rel === "index.html") {
        return { type: "root-index", filePath };
    }

    // Skip files already living as directory index pages
    if (baseName === "index") {
        return { type: "skip-index", filePath };
    }

    const destDir = path.join(parentDir, baseName);
    const destFile = path.join(destDir, "index.html");

    if (fs.existsSync(destDir) && !fs.statSync(destDir).isDirectory()) {
        throw new Error(`Cannot create directory; path exists as file: ${destDir}`);
    }

    fs.mkdirSync(destDir, { recursive: true });

    const original = fs.readFileSync(filePath, "utf8");
    const nested = rewriteAttributeUrls(original, true);
    fs.writeFileSync(destFile, nested, "utf8");

    // Replace old .html file with a redirect stub to the clean URL
    const stubTarget = `./${baseName}/`;
    fs.writeFileSync(filePath, buildRedirectStub(stubTarget), "utf8");

    return { type: "moved", from: rel, to: path.relative(root, destFile) };
}

function rewriteInPlace(filePath, deepen = false) {
    const original = fs.readFileSync(filePath, "utf8");
    const next = rewriteAttributeUrls(original, deepen);
    if (next !== original) {
        fs.writeFileSync(filePath, next, "utf8");
        return true;
    }
    return false;
}

function main() {
    const htmlFiles = collectHtmlFiles(root);
    const results = [];

    // First pass: migrate leaf pages (not already index.html)
    for (const filePath of htmlFiles) {
        const rel = path.relative(root, filePath);
        // Only migrate original leaf pages; ignore any already nested indexes
        if (path.basename(filePath) === "index.html") {
            continue;
        }
        // Don't migrate redirect stubs if re-run — detect by tiny size + "Redirecting"
        const source = fs.readFileSync(filePath, "utf8");
        if (source.includes("This page has moved to") && source.length < 800) {
            console.log(`Skip redirect stub: ${rel}`);
            continue;
        }
        const result = migratePage(filePath);
        results.push(result);
        if (result.type === "moved") {
            console.log(`Moved ${result.from} → ${result.to}`);
        }
    }

    // Second pass: rewrite remaining root index.html links (no deepen)
    const rootIndex = path.join(root, "index.html");
    if (fs.existsSync(rootIndex)) {
        const changed = rewriteInPlace(rootIndex, false);
        console.log(changed ? "Updated links in index.html" : "index.html links unchanged");
    }

    // Rewrite any other existing index.html pages that weren't just created
    // (none expected today, but safe)
    const moved = results.filter((r) => r.type === "moved").length;
    console.log(`\nDone. Migrated ${moved} page(s) to clean directory URLs.`);
}

main();
