#!/usr/bin/env python3

from __future__ import annotations

import argparse
import csv
import html
import json
import re
import time
import urllib.parse
import urllib.request
from dataclasses import dataclass
from html import unescape
from pathlib import Path
from typing import Any
from urllib.error import HTTPError

from enrich_leader_dates import STOPWORDS, dedupe, normalise_text, parse_leader_field, tokens


USER_AGENT = "Mozilla/5.0 Codex/1.0"
WIKIPEDIA_API = "https://en.wikipedia.org/w/api.php"
WIKIDATA_API = "https://www.wikidata.org/w/api.php"
COMMONS_API = "https://commons.wikimedia.org/w/api.php"

GENERIC_LEADER_PATTERNS = [
    r"\bgoverning body\b",
    r"\bgeneral superintendents\b",
    r"\btri-ordinariate\b",
    r"\bvacant\b",
]

TITLE_PREFIXES = [
    "Ecumenical Patriarch",
    "Major Archbishop",
    "Apostolic Exarch",
    "Grand Mufti",
    "Presiding Bishop",
    "Supreme Patriarch",
    "General Superintendent",
    "Executive Minister",
    "General Secretary",
    "President",
    "Patriarch",
    "Metropolitan",
    "Catholicos",
    "Archbishop",
    "Bishop",
    "Abbot",
    "Pope",
    "Imam",
    "Rabbi",
    "Sultan",
    "King",
]

ROLE_PRIORITY = [
    ("catholicos of all armenians", 140),
    ("pope", 130),
    ("ecumenical patriarch", 120),
    ("catholicos", 118),
    ("patriarch", 116),
    ("major archbishop", 112),
    ("grand mufti", 108),
    ("imam", 104),
    ("rabbi", 102),
    ("presiding bishop", 96),
    ("archbishop", 94),
    ("metropolitan", 92),
    ("bishop", 90),
    ("abbot", 88),
    ("president", 84),
    ("moderator", 82),
    ("executive minister", 80),
    ("general superintendent", 76),
    ("primate", 74),
    ("sultan", 44),
    ("general secretary", 20),
]

NON_PORTRAIT_HINTS = [
    "coat of arms",
    "arms of",
    "flag of",
    "seal of",
    "logo of",
    "emblem of",
    "signature",
    "crest",
    "insignia",
]
ROMAN_NUMERAL_RE = re.compile(r"\b[IVXLCDM]+\b", re.I)


@dataclass
class TargetPage:
    page_path: Path
    page_label: str
    row: dict[str, str]
    caption_name: str
    start_year: str
    query_name: str
    stripped_query_name: str


@dataclass
class ImageAsset:
    commons_title: str
    image_url: str
    width: int
    height: int
    description_url: str
    license_name: str
    license_url: str
    artist: str
    source_kind: str
    source_title: str


class Fetcher:
    def __init__(self) -> None:
        self.cache: dict[str, Any] = {}
        self.text_cache: dict[str, str] = {}

    def get_json(self, url: str) -> Any:
        if url in self.cache:
            return self.cache[url]

        last_error: Exception | None = None
        for attempt in range(5):
            request = urllib.request.Request(
                url,
                headers={
                    "User-Agent": USER_AGENT,
                    "Accept-Language": "en",
                },
            )
            try:
                with urllib.request.urlopen(request, timeout=30) as response:
                    payload = json.load(response)
                self.cache[url] = payload
                time.sleep(0.25)
                return payload
            except HTTPError as exc:
                last_error = exc
                if exc.code not in {429, 500, 502, 503, 504} or attempt == 4:
                    break
                time.sleep(4 * (attempt + 1))
        if last_error is not None:
            raise last_error
        raise RuntimeError(f"Failed to fetch {url}")

    def get_text(self, url: str) -> str:
        if url in self.text_cache:
            return self.text_cache[url]

        last_error: Exception | None = None
        for attempt in range(5):
            request = urllib.request.Request(
                url,
                headers={
                    "User-Agent": USER_AGENT,
                    "Accept-Language": "en",
                },
            )
            try:
                with urllib.request.urlopen(request, timeout=30) as response:
                    payload = response.read().decode("utf-8", errors="ignore")
                self.text_cache[url] = payload
                time.sleep(0.25)
                return payload
            except HTTPError as exc:
                last_error = exc
                if exc.code not in {429, 500, 502, 503, 504} or attempt == 4:
                    break
                time.sleep(4 * (attempt + 1))
        if last_error is not None:
            raise last_error
        raise RuntimeError(f"Failed to fetch {url}")

    def wikipedia_search(self, query: str) -> list[dict[str, Any]]:
        url = (
            "https://en.wikipedia.org/w/index.php?title=Special:Search&ns0=1"
            f"&search={urllib.parse.quote(query)}"
        )
        text = self.get_text(url)
        pattern = re.compile(
            r'<div class="mw-search-result-heading"><a href="[^"]+" title="([^"]+)"[^>]*>(.*?)</a>.*?</div>'
            r'\s*<div class="searchresult">(.*?)</div>',
            re.S,
        )
        results: list[dict[str, Any]] = []
        for match in pattern.finditer(text):
            title, _heading_html, snippet_html = match.groups()
            results.append(
                {
                    "title": title.replace("_", " "),
                    "snippet": strip_html(snippet_html),
                }
            )
            if len(results) >= 5:
                break
        return results

    def wikipedia_page_meta(self, title: str) -> dict[str, Any] | None:
        url = f'https://en.wikipedia.org/wiki/{urllib.parse.quote(title.replace(" ", "_"))}'
        text = self.get_text(url)
        file_candidates = dedupe(
            [
                urllib.parse.unquote(match).replace("_", " ")
                for match in re.findall(r'/wiki/File:([^"#?<>]+)', text)
            ]
        )
        if not file_candidates:
            return None
        return {
            "title": title,
            "file_candidates": file_candidates[:6],
        }

    def wikidata_claims(self, qid: str) -> dict[str, Any]:
        url = (
            f"{WIKIDATA_API}?action=wbgetentities&format=json"
            f"&ids={urllib.parse.quote(qid)}&props=claims"
        )
        return self.get_json(url).get("entities", {}).get(qid, {}).get("claims", {})

    def commons_file_info(self, file_title: str) -> dict[str, Any] | None:
        if not file_title:
            return None
        file_title = file_title.removeprefix("File:")
        file_url = f'https://commons.wikimedia.org/wiki/File:{urllib.parse.quote(file_title.replace(" ", "_"))}'
        text = self.get_text(file_url)

        json_ld_match = re.search(r'<script type="application/ld\+json">(.*?)</script>', text, re.S)
        json_ld: dict[str, Any] = {}
        if json_ld_match:
            try:
                json_ld = json.loads(unescape(json_ld_match.group(1)))
            except json.JSONDecodeError:
                json_ld = {}

        license_name_match = re.search(r'licensetpl&#95;short"[^>]*>(.*?)<', text, re.S)
        license_url_match = re.search(r'licensetpl&#95;link"[^>]*>(.*?)<', text, re.S)
        attribution_match = re.search(
            r'<div class="rlicense-attr"[^>]*>Attribution:\s*<div[^>]*class="licensetpl&#95;attr"[^>]*>(.*?)</div>',
            text,
            re.S,
        )
        categories_match = re.search(r'"wgCategories":(\[[^\]]*\])', text, re.S)
        og_image_match = re.search(r'<meta property="og:image" content="([^"]+)"', text)
        og_width_match = re.search(r'<meta property="og:image:width" content="([^"]+)"', text)
        og_height_match = re.search(r'<meta property="og:image:height" content="([^"]+)"', text)

        categories_text = ""
        if categories_match:
            try:
                categories_text = " | ".join(json.loads(categories_match.group(1)))
            except json.JSONDecodeError:
                categories_text = ""

        width = parse_dimension(str(json_ld.get("width", ""))) or parse_dimension(og_width_match.group(1) if og_width_match else "")
        height = parse_dimension(str(json_ld.get("height", ""))) or parse_dimension(og_height_match.group(1) if og_height_match else "")
        image_url = json_ld.get("contentUrl") or (og_image_match.group(1) if og_image_match else "")
        license_url = strip_html(license_url_match.group(1) if license_url_match else json_ld.get("license", ""))
        license_name = strip_html(license_name_match.group(1) if license_name_match else "")
        attribution = attribution_match.group(1) if attribution_match else ""

        if not image_url or not license_url:
            return None

        return {
            "title": f"File:{file_title}",
            "imageinfo": [
                {
                    "url": image_url,
                    "width": width,
                    "height": height,
                    "descriptionurl": file_url,
                    "extmetadata": {
                        "LicenseShortName": {"value": license_name},
                        "LicenseUrl": {"value": license_url},
                        "Attribution": {"value": attribution},
                        "Artist": {"value": attribution},
                        "ImageDescription": {"value": ""},
                        "Categories": {"value": categories_text},
                        "ObjectName": {"value": file_title},
                    },
                }
            ],
        }

    def commons_search(self, query: str) -> list[dict[str, Any]]:
        url = (
            f"{COMMONS_API}?action=query&format=json&formatversion=2"
            f"&generator=search&gsrnamespace=6&gsrlimit=5"
            f"&gsrsearch={urllib.parse.quote(query)}"
            "&prop=imageinfo&iiprop=url|extmetadata|size&iiurlwidth=1280"
        )
        pages = self.get_json(url).get("query", {}).get("pages", [])
        return pages if isinstance(pages, list) else []


def strip_html(value: str) -> str:
    value = unescape(value or "")
    value = re.sub(r"<[^>]+>", " ", value)
    value = value.replace("\xa0", " ")
    return re.sub(r"\s+", " ", value).strip()


def parse_dimension(value: str) -> int:
    match = re.search(r"\d+", value or "")
    return int(match.group(0)) if match else 0


def extract_year(value: str) -> str:
    match = re.search(r"\b(1[89]\d{2}|20\d{2})\b", value or "")
    return match.group(1) if match else ""


def clean_person_name(value: str) -> str:
    person, _role = parse_leader_field(value)
    return re.sub(r"\s+", " ", person).strip()


def strip_leading_titles(name: str) -> str:
    stripped = name.strip()
    for prefix in sorted(TITLE_PREFIXES, key=len, reverse=True):
        pattern = rf"^{re.escape(prefix)}\s+"
        next_value = re.sub(pattern, "", stripped, flags=re.I)
        if next_value != stripped:
            return next_value.strip()
    return stripped


def is_generic_leader(name: str) -> bool:
    lowered = (name or "").strip().lower()
    if not lowered:
        return True
    return any(re.search(pattern, lowered) for pattern in GENERIC_LEADER_PATTERNS)


def role_priority_score(leader: str) -> int:
    lowered = (leader or "").lower()
    for needle, score in ROLE_PRIORITY:
        if needle in lowered:
            return score
    return 40


def load_denomination_pages(tracker_path: Path) -> dict[str, str]:
    text = tracker_path.read_text(encoding="utf-8")
    match = re.search(r"const denominationPages = \{(.*?)\n        \};", text, re.S)
    if not match:
        raise RuntimeError("Could not locate denominationPages map in religious-tracker.html")
    block = match.group(1)
    return {
        key: value
        for key, value in re.findall(r'"([^"]+)":\s*"([^"]+)"', block)
    }


def match_page(mapping: dict[str, str], row: dict[str, str]) -> tuple[str, str] | None:
    denomination = row["Denomination"].strip()
    sub = row["sub denomination"].strip()
    sub2 = row["sub denomination 2"].strip()

    candidates = [
        sub2,
        f"{sub} ({sub2})" if sub and sub2 else "",
        sub,
        denomination,
    ]
    for label in candidates:
        if label and label in mapping:
            return label, mapping[label]
    return None


def group_targets(
    mapping: dict[str, str],
    rows: list[dict[str, str]],
    repo_root: Path,
) -> dict[Path, list[tuple[str, dict[str, str]]]]:
    groups: dict[Path, list[tuple[str, dict[str, str]]]] = {}
    for row in rows:
        matched = match_page(mapping, row)
        if not matched:
            continue
        label, page = matched
        page_path = repo_root / page
        groups.setdefault(page_path, []).append((label, row))
    return groups


def choose_target(page_path: Path, entries: list[tuple[str, dict[str, str]]]) -> TargetPage | None:
    ranked = sorted(
        entries,
        key=lambda item: (
            role_priority_score(item[1]["leader"]),
            bool(extract_year(item[1]["since"])),
        ),
        reverse=True,
    )

    for label, row in ranked:
        caption_name = clean_person_name(row["leader"])
        if is_generic_leader(caption_name):
            continue
        return TargetPage(
            page_path=page_path,
            page_label=label,
            row=row,
            caption_name=caption_name,
            start_year=extract_year(row["since"]),
            query_name=caption_name,
            stripped_query_name=strip_leading_titles(caption_name),
        )
    return None


def build_queries(target: TargetPage) -> list[str]:
    org = (
        target.row["sub denomination 2"].strip()
        or target.row["sub denomination"].strip()
        or target.row["Denomination"].strip()
        or target.row["religion"].strip()
    )
    queries = [
        target.row["leader"].strip(),
        f"{target.query_name} {org}",
        f"{target.stripped_query_name} {org}" if target.stripped_query_name and target.stripped_query_name != target.query_name else "",
        target.stripped_query_name if should_try_plain_name(target.stripped_query_name) else "",
    ]
    return dedupe([query for query in queries if query])


def should_try_plain_name(name: str) -> bool:
    stripped = (name or "").strip()
    if ROMAN_NUMERAL_RE.search(stripped):
        return True
    return len(tokens(stripped)) >= 3


def role_context_tokens(target: TargetPage) -> list[str]:
    person, role = parse_leader_field(target.row["leader"])
    raw_name_tokens = set(tokens(person))
    stripped_name_tokens = set(tokens(target.stripped_query_name))
    title_tokens = [token for token in raw_name_tokens - stripped_name_tokens if token not in STOPWORDS]
    role_tokens = [token for token in tokens(role) if token not in STOPWORDS]
    return dedupe(title_tokens + role_tokens)


def page_context_tokens(target: TargetPage) -> list[str]:
    banned = {"church", "catholic", "orthodox", "anglican", "australia", "america", "canada"}
    return [
        token
        for token in tokens(target.page_label)
        if token not in STOPWORDS and token not in banned and len(token) > 3
    ][:4]


def score_wikipedia_result(target: TargetPage, result: dict[str, Any]) -> int:
    title = result.get("title", "")
    snippet = strip_html(result.get("snippet", ""))
    haystack = normalise_text(f"{title} {snippet}")
    title_text = normalise_text(title)

    name_variants = [
        normalise_text(target.query_name),
        normalise_text(target.stripped_query_name),
    ]
    name_tokens = [token for token in tokens(target.stripped_query_name or target.query_name) if len(token) > 1]
    role_tokens = [token for token in role_context_tokens(target) if len(token) > 2]
    page_tokens = page_context_tokens(target)

    score = 0
    role_hits = 0
    page_hits = 0
    for variant in name_variants:
        if variant and variant in title_text:
            score += 30
        elif variant and variant in haystack:
            score += 12

    for token in name_tokens:
        if token in title_text:
            score += 8
        elif token in haystack:
            score += 3

    for token in role_tokens:
        if token in title_text:
            score += 5
            role_hits += 1
        elif token in haystack:
            score += 2
            role_hits += 1
    for token in page_tokens:
        if token in haystack:
            score += 1
            page_hits += 1

    lowered_title = title.lower()
    if lowered_title.startswith("list of"):
        score -= 18
    for bad_title in ("disambiguation", "family of", "inauguration of", "childhood home"):
        if bad_title in lowered_title:
            score -= 16
    if role_tokens and role_hits == 0:
        score -= 22
    if len(name_tokens) <= 1 and page_tokens and page_hits == 0:
        score -= 18
    return score


def extract_file_title_from_claims(claims: dict[str, Any]) -> str:
    for claim in claims.get("P18", []):
        file_name = claim.get("mainsnak", {}).get("datavalue", {}).get("value")
        if isinstance(file_name, str) and file_name:
            return file_name
    return ""


def is_human(claims: dict[str, Any]) -> bool:
    for claim in claims.get("P31", []):
        entity_id = claim.get("mainsnak", {}).get("datavalue", {}).get("value", {}).get("id")
        if entity_id == "Q5":
            return True
    return False


def assess_commons_page(
    target: TargetPage,
    source_kind: str,
    source_title: str,
    page: dict[str, Any] | None,
    min_dimension: int,
) -> ImageAsset | None:
    if not page or not page.get("imageinfo"):
        return None

    info = page["imageinfo"][0]
    metadata = info.get("extmetadata", {})
    license_name = strip_html(metadata.get("LicenseShortName", {}).get("value", ""))
    license_url = strip_html(metadata.get("LicenseUrl", {}).get("value", ""))
    license_url_lower = license_url.lower()
    license_name_lower = license_name.lower()
    if license_name_lower:
        is_cc_license = license_name_lower.startswith("cc") or "creative commons" in license_name_lower
    else:
        is_cc_license = "/licenses/" in license_url_lower or "/publicdomain/zero/" in license_url_lower
    if not is_cc_license:
        return None

    width = int(info.get("thumbwidth") or info.get("width") or 0)
    height = int(info.get("thumbheight") or info.get("height") or 0)
    if max(width, height) < min_dimension:
        return None

    title = page.get("title", "")
    descriptor = " ".join(
        [
            title,
            metadata.get("ObjectName", {}).get("value", ""),
            metadata.get("ImageDescription", {}).get("value", ""),
            metadata.get("Categories", {}).get("value", ""),
        ]
    ).lower()
    if title.lower().endswith(".svg") or any(hint in descriptor for hint in NON_PORTRAIT_HINTS):
        return None

    name_tokens = [token for token in tokens(target.stripped_query_name or target.query_name) if len(token) > 1]
    descriptor_tokens = normalise_text(strip_html(descriptor))
    required_hits = 1 if len(name_tokens) <= 1 else 2
    name_hits = sum(1 for token in name_tokens if token in descriptor_tokens)
    if name_hits < required_hits:
        return None

    artist = strip_html(metadata.get("Artist", {}).get("value", ""))
    if not artist:
        artist = strip_html(metadata.get("Attribution", {}).get("value", ""))
    if not artist:
        artist = strip_html(metadata.get("Credit", {}).get("value", ""))
    if not artist:
        artist = "Unknown author"

    image_url = info.get("thumburl") or info.get("url") or ""
    if not image_url:
        return None

    return ImageAsset(
        commons_title=title,
        image_url=image_url,
        width=width,
        height=height,
        description_url=info.get("descriptionurl", ""),
        license_name=license_name,
        license_url=license_url,
        artist=artist,
        source_kind=source_kind,
        source_title=source_title,
    )


def image_from_wikipedia(
    fetcher: Fetcher,
    target: TargetPage,
    min_dimension: int,
) -> tuple[ImageAsset | None, str]:
    best_scores: dict[str, int] = {}
    for query in build_queries(target):
        results = fetcher.wikipedia_search(query)
        for result in results[:3]:
            title = result["title"]
            score = score_wikipedia_result(target, result)
            previous = best_scores.get(title, -10**9)
            if score > previous:
                best_scores[title] = score

    for title, score in sorted(best_scores.items(), key=lambda item: item[1], reverse=True)[:2]:
        if score < 22:
            continue

        page = fetcher.wikipedia_page_meta(title)
        if not page:
            continue

        for file_title in page.get("file_candidates", []):
            asset = assess_commons_page(
                target,
                source_kind="wikipedia",
                source_title=page.get("title", title),
                page=fetcher.commons_file_info(file_title),
                min_dimension=min_dimension,
            )
            if asset:
                return asset, page.get("title", title)

    return None, ""


def score_commons_result(target: TargetPage, page: dict[str, Any]) -> int:
    info = (page.get("imageinfo") or [{}])[0]
    metadata = info.get("extmetadata", {})
    descriptor = " ".join(
        [
            page.get("title", ""),
            metadata.get("ObjectName", {}).get("value", ""),
            metadata.get("ImageDescription", {}).get("value", ""),
            metadata.get("Categories", {}).get("value", ""),
        ]
    )
    haystack = normalise_text(strip_html(descriptor))
    name_variants = [
        normalise_text(target.query_name),
        normalise_text(target.stripped_query_name),
    ]
    name_tokens = [token for token in tokens(target.stripped_query_name or target.query_name) if len(token) > 1]
    role_tokens = [token for token in role_context_tokens(target) if len(token) > 2]
    page_tokens = page_context_tokens(target)

    score = 0
    role_hits = 0
    for variant in name_variants:
        if variant and variant in haystack:
            score += 18
    for token in name_tokens:
        if token in haystack:
            score += 4
    for token in role_tokens:
        if token in haystack:
            score += 2
            role_hits += 1
    for token in page_tokens:
        if token in haystack:
            score += 1
    if role_tokens and role_hits == 0:
        score -= 18
    return score


def image_from_commons(
    fetcher: Fetcher,
    target: TargetPage,
    min_dimension: int,
) -> tuple[ImageAsset | None, str]:
    queries = dedupe([target.query_name, target.stripped_query_name])
    for query in queries:
        pages = fetcher.commons_search(query)
        ranked = sorted(
            ((score_commons_result(target, page), page) for page in pages),
            key=lambda item: item[0],
            reverse=True,
        )
        for score, page in ranked[:5]:
            if score < 16:
                continue
            asset = assess_commons_page(
                target,
                source_kind="commons",
                source_title=page.get("title", ""),
                page=page,
                min_dimension=min_dimension,
            )
            if asset:
                return asset, page.get("title", "")
    return None, ""


def render_block(target: TargetPage, asset: ImageAsset) -> str:
    caption = html.escape(target.caption_name)
    year = html.escape(target.start_year)
    artist = html.escape(asset.artist)
    image_url = html.escape(asset.image_url, quote=True)
    description_url = html.escape(asset.description_url, quote=True)
    license_url = html.escape(asset.license_url, quote=True)
    license_name = html.escape(asset.license_name)

    return (
        "        <!-- leader-image:start -->\n"
        '        <figure class="leader-figure">\n'
        f'            <img class="leader-image" src="{image_url}" alt="Portrait of {caption}" loading="lazy" width="{asset.width}" height="{asset.height}">\n'
        f"            <figcaption class=\"leader-caption\">{caption} ({year}-<em>present</em>)</figcaption>\n"
        f'            <p class="source-note leader-source-note">Source: Image from <a href="{description_url}" target="_blank" rel="noopener noreferrer">Wikimedia Commons</a> by {artist}. Licensed under <a href="{license_url}" target="_blank" rel="noopener noreferrer">{license_name}</a>.</p>\n'
        "        </figure>\n"
        "        <!-- leader-image:end -->\n"
    )


def upsert_block(page_path: Path, block: str) -> bool:
    original = page_path.read_text(encoding="utf-8")
    pattern = re.compile(
        r"\n        <!-- leader-image:start -->.*?        <!-- leader-image:end -->\n",
        re.S,
    )
    if pattern.search(original):
        updated = pattern.sub("\n" + block, original, count=1) if block else pattern.sub("\n", original, count=1)
    else:
        marker = "        <section class=\"info-card\">"
        if marker not in original:
            raise RuntimeError(f"Could not find insertion point in {page_path}")
        updated = original.replace(marker, block + marker, 1) if block else original

    if updated == original:
        return False
    page_path.write_text(updated, encoding="utf-8")
    return True


def load_rows(csv_path: Path) -> list[dict[str, str]]:
    with csv_path.open(newline="", encoding="utf-8") as handle:
        return list(csv.DictReader(handle))


def main() -> int:
    parser = argparse.ArgumentParser(description="Insert CC leader images into denomination pages.")
    parser.add_argument("--csv", default="leaders.csv", help="Path to leaders CSV")
    parser.add_argument(
        "--tracker",
        default="religious-tracker.html",
        help="Path to the religious tracker HTML file",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=0,
        help="Maximum number of pages to process",
    )
    parser.add_argument(
        "--page",
        action="append",
        default=[],
        help="Only process a specific denomination page path",
    )
    parser.add_argument(
        "--min-dimension",
        type=int,
        default=1000,
        help="Minimum larger image dimension required",
    )
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Write HTML changes instead of printing a dry-run summary",
    )
    args = parser.parse_args()

    repo_root = Path(__file__).resolve().parent.parent
    mapping = load_denomination_pages(repo_root / args.tracker)
    rows = load_rows(repo_root / args.csv)
    grouped = group_targets(mapping, rows, repo_root)
    selected_pages = {repo_root / page for page in args.page}

    targets: list[TargetPage] = []
    for page_path, entries in grouped.items():
        if selected_pages and page_path not in selected_pages:
            continue
        target = choose_target(page_path, entries)
        if target:
            targets.append(target)

    targets.sort(key=lambda item: str(item.page_path))
    if args.limit:
        targets = targets[: args.limit]

    fetcher = Fetcher()
    updated = 0
    skipped = 0

    for target in targets:
        if not target.start_year:
            print(
                f"SKIP  {target.page_path.relative_to(repo_root)} | no start year | {target.caption_name}",
                flush=True,
            )
            skipped += 1
            continue

        try:
            asset, source_title = image_from_wikipedia(fetcher, target, args.min_dimension)
        except HTTPError as exc:
            print(
                f"ERR   {target.page_path.relative_to(repo_root)} | {target.caption_name} | HTTP {exc.code}",
                flush=True,
            )
            skipped += 1
            continue

        if not asset:
            print(f"MISS  {target.page_path.relative_to(repo_root)} | {target.caption_name}", flush=True)
            skipped += 1
            continue

        if args.apply:
            changed = upsert_block(target.page_path, render_block(target, asset))
            status = "WRITE" if changed else "KEEP "
        else:
            status = "PLAN "
        print(
            f"{status} {target.page_path.relative_to(repo_root)} | {target.caption_name} | "
            f"{asset.commons_title} | {asset.license_name} | {source_title}",
            flush=True,
        )
        if args.apply:
            if changed:
                updated += 1
        else:
            updated += 1

    print(
        f"Processed {len(targets)} pages | updated/planned {updated} | skipped/missed {skipped}",
        flush=True,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
