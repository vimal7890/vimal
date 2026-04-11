#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const workspaceRoot = path.resolve(__dirname, "..");
const denominationsDir = path.join(workspaceRoot, "religious-denominations");

function readUtf8(filePath) {
    return fs.readFileSync(filePath, "utf8");
}

function loadWindowScript(filePath) {
    const context = { Intl, window: {} };
    vm.createContext(context);
    vm.runInContext(readUtf8(filePath), context, { filename: filePath });
    return context.window;
}

function unique(values) {
    return [...new Set(values)];
}

function parseDelimitedRows(raw) {
    return String(raw || "")
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => line.split("|"));
}

function getWorldMethodistCountrySegments(countryName) {
    if (!countryName || ["Global", "International", "Caribbean"].includes(countryName)) {
        return [countryName];
    }

    const commaParts = countryName.split(",").map((part) => part.trim()).filter(Boolean);
    const segments = [];

    commaParts.forEach((part) => {
        if (part === "Trinidad and Tobago" || part === "Bosnia and Herzegovina") {
            segments.push(part);
            return;
        }

        const andParts = part.split(/\s+and\s+/).map((segment) => segment.trim()).filter(Boolean);
        if (andParts.length > 1) {
            segments.push(...andParts);
            return;
        }

        segments.push(part);
    });

    return segments;
}

function canonicalRegionCode(regionCode) {
    const normalizedCode = String(regionCode || "").toUpperCase().trim();
    if (!/^[A-Z]{2}$/.test(normalizedCode)) {
        return "";
    }

    try {
        return new Intl.Locale(`und-${normalizedCode}`).region || normalizedCode;
    } catch {
        return normalizedCode;
    }
}

function getHtmlPagesUsingCountryFlagUtils() {
    const htmlFiles = fs.readdirSync(denominationsDir)
        .filter((name) => name.toLowerCase().endsWith(".html"));

    return htmlFiles
        .filter((fileName) => readUtf8(path.join(denominationsDir, fileName)).includes("country-flag-utils.js"));
}

const scenarioDefinitions = [
    {
        id: "world-methodist-council",
        htmlFile: "world-methodist-council.html",
        dataFile: "world-methodist-council-data.js",
        getCountries: (windowData) => {
            const rows = parseDelimitedRows(windowData.wmcMemberRowsRaw);
            return unique(rows.flatMap((row) => getWorldMethodistCountrySegments(row[0])));
        },
        options: {
            codeOverrides: {
                "China (People's Republic of China)": "CN",
                "Congo (Democratic Republic of Congo)": "CD",
                "South Korea": "KR",
                "Taiwan (Republic of China)": "TW",
                "United Kingdom": "GB",
                "United States of America": "US"
            },
            compactThreshold: 0.3,
            emojiOverrides: {
                Caribbean: "🌴"
            },
            exactThreshold: 0.95,
            extraStopWords: ["republic", "people"]
        },
        allowedUnresolved: ["Global", "International"]
    },
    {
        id: "lutheran-world-federation",
        htmlFile: "lutheran-world-federation.html",
        dataFile: "lutheran-world-federation-data.js",
        getCountries: (windowData) => {
            const rows = parseDelimitedRows(windowData.lwfMemberRowsRaw);
            return unique(rows.map((row) => row[0]));
        },
        options: {
            codeOverrides: {
                "China (Hong Kong SAR)": "HK",
                "Congo, Democratic Republic of": "CD",
                Czechia: "CZ",
                "Korea, Republic": "KR",
                Palestine: "PS",
                Russia: "RU",
                "Slovak Republic": "SK",
                "Taiwan (Republic of China)": "TW",
                "United States of America": "US"
            },
            compactThreshold: 0.3,
            exactThreshold: 0.95,
            extraStopWords: ["republic", "democratic", "sar"]
        }
    },
    {
        id: "baptist-world-alliance",
        htmlFile: "baptist-world-alliance.html",
        dataFile: "baptist-world-alliance-data.js",
        getCountries: (windowData) => {
            const rows = parseDelimitedRows(windowData.bwaMemberRowsRaw);
            return unique(rows.map((row) => row[0]));
        },
        options: {
            codeOverrides: {
                "Cote d'Ivoire": "CI",
                "Czech Republic": "CZ",
                "Democratic Republic of the Congo": "CD",
                "Hong Kong": "HK",
                Korea: "KR",
                Macau: "MO",
                Myanmar: "MM",
                "Palestinian Territories": "PS",
                "Republic of the Congo": "CG",
                "Russian Federation": "RU",
                "Saint Kitts and Nevis": "KN",
                "Saint Vincent and the Grenadines": "VC",
                "The Gambia": "GM",
                Turkey: "TR",
                "United States of America": "US"
            },
            compactThreshold: 0.3,
            emojiOverrides: {
                World: "🌍"
            },
            exactThreshold: 0.95,
            extraStopWords: ["inc", "usa"]
        }
    },
    {
        id: "anglican-communion",
        htmlFile: "anglican-communion.html",
        dataFile: "anglican-communion-data.js",
        getCountries: (windowData) => {
            const ignoredMapTerritories = new Set(["Crown Dependencies", "Europe"]);
            return unique(
                String(windowData.acMapTerritoriesRaw || "")
                    .split("\n")
                    .map((line) => line.trim())
                    .filter((line) => line && !ignoredMapTerritories.has(line))
            );
        },
        options: {
            codeOverrides: {
                England: "GB",
                Scotland: "GB",
                Wales: "GB",
                "Republic of Ireland": "IE",
                "Northern Ireland": "GB",
                "Democratic Republic of the Congo": "CD",
                "Republic of Congo": "CG",
                "South Korea": "KR",
                "North Korea": "KP",
                Palestine: "PS",
                Macau: "MO",
                "Hong Kong": "HK",
                "British Virgin Islands": "VG",
                "United States Virgin Islands": "VI",
                "Northern Mariana Islands": "MP",
                "Puerto Rico": "PR",
                "Saint Barthelemy": "BL",
                "Saint Kitts and Nevis": "KN",
                "Saint Vincent and the Grenadines": "VC",
                "Saint Lucia": "LC",
                "Saint Martin": "MF",
                "Turks and Caicos Islands": "TC",
                "Cayman Islands": "KY",
                "Cape Verde": "CV",
                "Sint Eustatius": "BQ",
                Saba: "BQ",
                "Saint Helena": "SH"
            },
            compactThreshold: 0.3,
            exactThreshold: 0.95,
            extraStopWords: ["islands", "saint"]
        }
    }
];

const utilsWindow = loadWindowScript(path.join(denominationsDir, "country-flag-utils.js"));
const countryFlagUtils = utilsWindow.CountryFlagUtils;

if (!countryFlagUtils) {
    console.error("Could not load CountryFlagUtils from religious-denominations/country-flag-utils.js");
    process.exit(1);
}

const scenarioByHtmlFile = new Map(scenarioDefinitions.map((scenario) => [scenario.htmlFile, scenario]));
const htmlPagesUsingUtility = getHtmlPagesUsingCountryFlagUtils();
const uncoveredPages = htmlPagesUsingUtility.filter((htmlFile) => !scenarioByHtmlFile.has(htmlFile));
const staleScenarioFiles = scenarioDefinitions
    .map((scenario) => scenario.htmlFile)
    .filter((htmlFile) => !htmlPagesUsingUtility.includes(htmlFile));

let hasFailures = false;

if (uncoveredPages.length > 0) {
    hasFailures = true;
    console.error("Coverage failure: add audit scenarios for these pages using country-flag-utils.js:");
    uncoveredPages.forEach((htmlFile) => {
        console.error(`  - ${htmlFile}`);
    });
}

if (staleScenarioFiles.length > 0) {
    hasFailures = true;
    console.error("Coverage failure: these audited pages no longer include country-flag-utils.js:");
    staleScenarioFiles.forEach((htmlFile) => {
        console.error(`  - ${htmlFile}`);
    });
}

for (const scenario of scenarioDefinitions) {
    const dataWindow = loadWindowScript(path.join(denominationsDir, scenario.dataFile));
    const countryNames = unique(scenario.getCountries(dataWindow).map((value) => String(value || "").trim()).filter(Boolean));
    const allowedUnresolved = new Set(scenario.allowedUnresolved || []);
    const failures = [];
    const unresolvedCountries = [];

    countryNames.forEach((countryName) => {
        if (Object.prototype.hasOwnProperty.call(scenario.options.emojiOverrides || {}, countryName)) {
            return;
        }

        const code = countryFlagUtils.resolveCountryFlagCode(countryName, scenario.options);
        if (!code) {
            unresolvedCountries.push(countryName);
            return;
        }

        const canonicalCode = canonicalRegionCode(code);
        if (canonicalCode && code !== canonicalCode) {
            failures.push(`${countryName} resolved to non-canonical code ${code} (expected ${canonicalCode})`);
        }

        const emoji = countryFlagUtils.createFlagEmoji(code);
        if (!emoji) {
            failures.push(`${countryName} resolved to ${code} but produced an empty emoji`);
        }
    });

    unresolvedCountries
        .filter((countryName) => !allowedUnresolved.has(countryName))
        .forEach((countryName) => {
            failures.push(`${countryName} did not resolve to a country code`);
        });

    if (failures.length > 0) {
        hasFailures = true;
        console.error(`\n[FAIL] ${scenario.id}`);
        failures.forEach((message) => {
            console.error(`  - ${message}`);
        });
    } else {
        const unresolvedSummary = unresolvedCountries.length > 0
            ? `, unresolved allowed: ${unresolvedCountries.length}`
            : "";
        console.log(`[PASS] ${scenario.id} (${countryNames.length} names checked${unresolvedSummary})`);
    }
}

if (hasFailures) {
    process.exit(1);
}

console.log("\nCountry flag audit passed.");
