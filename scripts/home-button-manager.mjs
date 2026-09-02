#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const workspaceRoot = path.resolve(__dirname, "..");
const loaderName = "home-button-loader.js";
const htmlExtension = ".html";
const excludedDirs = new Set([".git", "node_modules"]);
const debounceTimers = new Map();

function computePrefix(filePath) {
    const relativeDir = path.relative(workspaceRoot, path.dirname(filePath));
    if (!relativeDir || relativeDir === ".") {
        return "";
    }

    const depth = relativeDir.split(path.sep).filter(Boolean).length;
    return "../".repeat(depth);
}

function buildScriptTag(filePath) {
    const prefix = computePrefix(filePath);
    return `<script src="${prefix}${loaderName}" data-home-href="${prefix}index.html" defer></script>`;
}

function injectIntoFile(filePath) {
    if (!filePath.endsWith(htmlExtension)) {
        return false;
    }

    let source;
    try {
        source = fs.readFileSync(filePath, "utf8");
    } catch {
        return false;
    }

    if (source.includes(loaderName)) {
        return false;
    }

    const scriptTag = buildScriptTag(filePath);
    const hasCarriageReturns = source.includes("\r\n");
    const newline = hasCarriageReturns ? "\r\n" : "\n";
    const bodyCloseTag = "</body>";
    const bodyIndex = source.toLowerCase().lastIndexOf(bodyCloseTag);

    let nextSource;
    if (bodyIndex !== -1) {
        nextSource = `${source.slice(0, bodyIndex)}    ${scriptTag}${newline}${source.slice(bodyIndex)}`;
    } else {
        const needsTrailingNewline = source.length > 0 && !source.endsWith("\n") && !source.endsWith("\r");
        const spacer = needsTrailingNewline ? newline : "";
        nextSource = `${source}${spacer}${scriptTag}${newline}`;
    }

    fs.writeFileSync(filePath, nextSource, "utf8");
    return true;
}

function collectHtmlFiles(dirPath, acc = []) {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });

    for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name);

        if (entry.isDirectory()) {
            if (!excludedDirs.has(entry.name)) {
                collectHtmlFiles(fullPath, acc);
            }
            continue;
        }

        if (entry.isFile() && entry.name.toLowerCase().endsWith(htmlExtension)) {
            acc.push(fullPath);
        }
    }

    return acc;
}

function injectAllHtmlFiles() {
    const files = collectHtmlFiles(workspaceRoot);
    let changedCount = 0;

    for (const filePath of files) {
        if (injectIntoFile(filePath)) {
            changedCount += 1;
            console.log(`Injected home button loader into ${path.relative(workspaceRoot, filePath)}`);
        }
    }

    console.log(`Injection pass complete. Updated ${changedCount} HTML file(s).`);
}

function watchForNewHtml() {
    injectAllHtmlFiles();

    console.log("Watching for new/updated HTML files...");

    fs.watch(workspaceRoot, { recursive: true }, (eventType, filename) => {
        if (!filename) {
            return;
        }

        const normalized = filename.split(path.sep).join("/");
        if (!normalized.toLowerCase().endsWith(htmlExtension)) {
            return;
        }

        if (normalized.startsWith(".git/") || normalized.includes("/node_modules/")) {
            return;
        }

        const absolutePath = path.join(workspaceRoot, filename);
        clearTimeout(debounceTimers.get(absolutePath));

        const timer = setTimeout(() => {
            debounceTimers.delete(absolutePath);

            if (!fs.existsSync(absolutePath)) {
                return;
            }

            const changed = injectIntoFile(absolutePath);
            if (changed) {
                console.log(`Auto-injected home button loader into ${normalized}`);
            }
        }, 120);

        debounceTimers.set(absolutePath, timer);
    });
}

const args = new Set(process.argv.slice(2));
if (args.has("--watch")) {
    watchForNewHtml();
} else {
    injectAllHtmlFiles();
}
