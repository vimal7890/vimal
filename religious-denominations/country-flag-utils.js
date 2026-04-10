(function attachCountryFlagUtils(global) {
    "use strict";

    const BASE_STOP_WORDS = ["of", "the", "and", "in"];
    const COUNTRY_FLAG_MATCHER_CACHE = new Map();
    const canUseDisplayNames = typeof Intl !== "undefined" && typeof Intl.DisplayNames === "function";

    function normalizeAscii(value) {
        return String(value).normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
    }

    function buildStopWordSet(extraStopWords) {
        const normalizedExtraWords = Array.isArray(extraStopWords)
            ? extraStopWords
                .map((word) => normalizeAscii(word).toLowerCase().trim())
                .filter(Boolean)
            : [];

        return new Set([...BASE_STOP_WORDS, ...normalizedExtraWords]);
    }

    function tokenize(value, stopWordSet) {
        return normalizeAscii(value)
            .toLowerCase()
            .replace(/&/g, " and ")
            .replace(/[^a-z0-9]+/g, " ")
            .split(/\s+/)
            .filter((token) => token && !stopWordSet.has(token));
    }

    function normalizeCompact(value, stopWordSet) {
        return tokenize(value, stopWordSet).join("");
    }

    function jaccardScore(aTokens, bTokens) {
        const aSet = new Set(aTokens);
        const bSet = new Set(bTokens);
        let intersection = 0;

        for (const token of aSet) {
            if (bSet.has(token)) {
                intersection += 1;
            }
        }

        const union = new Set([...aSet, ...bSet]).size;
        return union === 0 ? 0 : intersection / union;
    }

    function getMatcherCacheKey(stopWordSet) {
        return Array.from(stopWordSet).sort().join("|");
    }

    function buildCountryFlagMatchers(stopWordSet) {
        const cacheKey = getMatcherCacheKey(stopWordSet);

        if (COUNTRY_FLAG_MATCHER_CACHE.has(cacheKey)) {
            return COUNTRY_FLAG_MATCHER_CACHE.get(cacheKey);
        }

        if (!canUseDisplayNames) {
            COUNTRY_FLAG_MATCHER_CACHE.set(cacheKey, []);
            return [];
        }

        const displayNames = new Intl.DisplayNames(["en"], { type: "region" });
        const matchers = [];

        for (let firstCodePoint = 65; firstCodePoint <= 90; firstCodePoint += 1) {
            for (let secondCodePoint = 65; secondCodePoint <= 90; secondCodePoint += 1) {
                const code = String.fromCharCode(firstCodePoint, secondCodePoint);
                const label = displayNames.of(code);

                if (!label || label === code) {
                    continue;
                }

                matchers.push({
                    code,
                    compact: normalizeCompact(label, stopWordSet),
                    tokens: tokenize(label, stopWordSet)
                });
            }
        }

        COUNTRY_FLAG_MATCHER_CACHE.set(cacheKey, matchers);
        return matchers;
    }

    function resolveCountryFlagCode(countryName, options = {}) {
        const normalizedName = String(countryName || "").trim();
        if (!normalizedName) {
            return null;
        }

        const codeOverrides = options.codeOverrides || {};

        if (Object.prototype.hasOwnProperty.call(codeOverrides, normalizedName)) {
            return codeOverrides[normalizedName];
        }

        const stopWordSet = buildStopWordSet(options.extraStopWords);
        const countryFlagMatchers = buildCountryFlagMatchers(stopWordSet);

        if (countryFlagMatchers.length === 0) {
            return null;
        }

        const countryTokens = tokenize(normalizedName, stopWordSet);
        const countryCompact = countryTokens.join("");
        let bestMatch = null;
        let bestScore = 0;

        for (const matcher of countryFlagMatchers) {
            const score = jaccardScore(countryTokens, matcher.tokens);

            if (score > bestScore) {
                bestScore = score;
                bestMatch = matcher;
            }
        }

        if (!bestMatch) {
            return null;
        }

        const compactMatch = bestMatch.compact.includes(countryCompact) || countryCompact.includes(bestMatch.compact);
        const exactThreshold = typeof options.exactThreshold === "number" ? options.exactThreshold : 0.95;
        const compactThreshold = typeof options.compactThreshold === "number" ? options.compactThreshold : 0.3;

        if (bestScore >= exactThreshold || (compactMatch && bestScore >= compactThreshold)) {
            return bestMatch.code;
        }

        return null;
    }

    function createFlagEmoji(countryCode) {
        const normalizedCode = String(countryCode || "").toUpperCase().trim();

        if (!/^[A-Z]{2}$/.test(normalizedCode)) {
            return "";
        }

        return Array.from(normalizedCode, (letter) => String.fromCodePoint(127397 + letter.charCodeAt(0))).join("");
    }

    function getCountryMarker(countryName, options = {}) {
        const normalizedName = String(countryName || "").trim();
        if (!normalizedName) {
            return "";
        }

        const emojiOverrides = options.emojiOverrides || {};

        if (Object.prototype.hasOwnProperty.call(emojiOverrides, normalizedName)) {
            return emojiOverrides[normalizedName];
        }

        const countryCode = resolveCountryFlagCode(normalizedName, options);
        return countryCode ? createFlagEmoji(countryCode) : "";
    }

    function appendCountryWithMarker(targetNode, countryName, options = {}) {
        if (!targetNode) {
            return;
        }

        const normalizedName = String(countryName || "").trim();
        if (!normalizedName) {
            return;
        }

        const marker = getCountryMarker(normalizedName, options);
        targetNode.append(normalizedName);

        if (!marker) {
            return;
        }

        const markerSpan = targetNode.ownerDocument.createElement("span");
        markerSpan.className = options.markerClassName || "country-flag";
        markerSpan.setAttribute("aria-hidden", "true");
        markerSpan.textContent = marker;
        targetNode.append(markerSpan);
    }

    global.CountryFlagUtils = {
        appendCountryWithMarker,
        createFlagEmoji,
        getCountryMarker,
        resolveCountryFlagCode
    };
})(window);
