#!/usr/bin/env python3

from __future__ import annotations

import argparse
import csv
import json
import re
import sys
import time
import urllib.parse
import urllib.request
from dataclasses import dataclass
from html import unescape
from pathlib import Path
from typing import Any
from unicodedata import combining, normalize
from urllib.error import HTTPError


USER_AGENT = "Mozilla/5.0 Codex/1.0"
MONTH_NAMES = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
]
MONTHS = {name: idx + 1 for idx, name in enumerate(MONTH_NAMES)}

EXACT_DATE_RE = re.compile(r"^[A-Z][a-z]+ \d{1,2}(st|nd|rd|th) \d{4}$")
MONTH_YEAR_RE = re.compile(
    r"^(January|February|March|April|May|June|July|August|September|October|November|December) \d{4}$"
)
YEAR_RE = re.compile(r"^\d{4}$")

DATE_FIELD_PRIORITY = [
    "term_start",
    "termstart",
    "start_date",
    "service_start",
    "incumbency_start",
    "assumed_office",
    "installed",
    "enthroned",
    "inaugurated",
    "period",
    "years",
    "reign",
    "began",
    "elected",
    "appointed",
]

STOPWORDS = {
    "the",
    "of",
    "and",
    "all",
    "church",
    "leader",
    "president",
    "patriarch",
    "archbishop",
    "bishop",
    "metropolitan",
    "pope",
    "major",
    "supreme",
    "general",
    "national",
    "international",
    "executive",
    "director",
    "secretary",
    "chairman",
    "moderator",
    "chief",
    "officer",
    "catholicos",
    "imam",
    "abuna",
    "abune",
    "rabbi",
    "king",
    "lama",
    "coordinator",
    "facilitator",
    "ordinary",
    "administrator",
    "apostolic",
    "acting",
    "pastor",
    "primate",
    "minister",
    "council",
    "bishopric",
}

ROLE_HINTS = {
    "president",
    "patriarch",
    "archbishop",
    "bishop",
    "metropolitan",
    "pope",
    "catholicos",
    "imam",
    "rabbi",
    "king",
    "general",
    "moderator",
    "chairman",
    "secretary",
    "director",
    "superintendent",
    "coordinator",
    "officer",
    "facilitator",
    "primate",
    "chief",
}

WIKIPEDIA_API = "https://en.wikipedia.org/w/api.php"
WIKIDATA_API = "https://wikidata.org/w/api.php"
WIKIDATA_ENTITY = "https://wikidata.org/wiki/Special:EntityData/{qid}.json"


@dataclass
class CandidateDate:
    precision: str
    year: int
    month: int | None
    day: int | None
    basis: str
    source_type: str
    source_url: str
    notes: str


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
                    data = json.load(response)
                self.cache[url] = data
                time.sleep(0.2)
                return data
            except HTTPError as exc:
                last_error = exc
                if exc.code != 429 or attempt == 4:
                    break
                time.sleep(10 * (attempt + 1))
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
                    text = response.read().decode("utf-8", errors="ignore")
                self.text_cache[url] = text
                time.sleep(0.2)
                return text
            except HTTPError as exc:
                last_error = exc
                if exc.code != 429 or attempt == 4:
                    break
                time.sleep(10 * (attempt + 1))
        if last_error is not None:
            raise last_error
        raise RuntimeError(f"Failed to fetch {url}")

    def search_wikipedia(self, query: str) -> list[dict[str, Any]]:
        url = (
            "https://en.wikipedia.org/w/index.php?title=Special:Search&ns0=1"
            f"&search={urllib.parse.quote(query)}"
        )
        html = self.get_text(url)
        pattern = re.compile(
            r'<div class="mw-search-result-heading"><a href="([^"]+)" title="([^"]+)"[^>]*>(.*?)</a>.*?</div>'
            r'\s*<div class="searchresult">(.*?)</div>',
            re.S,
        )
        results: list[dict[str, Any]] = []
        for match in pattern.finditer(html):
            href, title, heading_html, snippet_html = match.groups()
            if not href.startswith("/wiki/"):
                continue
            href_title = urllib.parse.unquote(href[len("/wiki/") :]).split("#", 1)[0]
            href_title = href_title.replace("_", " ")
            snippet = clean_markup(re.sub(r"<[^>]+>", " ", snippet_html))
            results.append(
                {
                    "title": href_title or title,
                    "snippet": snippet,
                }
            )
            if len(results) >= 6:
                break
        return results

    def wikipedia_page_bundle(self, title: str) -> dict[str, Any]:
        wikitext = self.get_text(
            "https://en.wikipedia.org/w/index.php"
            f"?title={urllib.parse.quote(title)}&action=raw"
        )
        return {
            "title": title,
            "wikitext": wikitext,
            "extract_text": extract_lead_text(wikitext),
            "qid": "",
        }

    def wikidata_entity(self, qid: str) -> dict[str, Any]:
        return self.get_json(WIKIDATA_ENTITY.format(qid=qid))["entities"][qid]

    def wikidata_labels(self, qids: list[str]) -> dict[str, str]:
        qids = [qid for qid in qids if qid]
        if not qids:
            return {}
        joined = "|".join(sorted(set(qids)))
        url = (
            f"{WIKIDATA_API}?action=wbgetentities&ids={joined}"
            "&props=labels&languages=en&format=json"
        )
        entities = self.get_json(url)["entities"]
        labels: dict[str, str] = {}
        for qid, payload in entities.items():
            labels[qid] = payload.get("labels", {}).get("en", {}).get("value", "")
        return labels


def strip_accents(value: str) -> str:
    decomposed = normalize("NFKD", value)
    return "".join(ch for ch in decomposed if not combining(ch))


def normalise_text(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", strip_accents(value).lower()).strip()


def tokens(value: str) -> list[str]:
    return [token for token in normalise_text(value).split() if token]


def precision_of(value: str) -> str:
    value = value.strip()
    if EXACT_DATE_RE.match(value):
        return "day"
    if MONTH_YEAR_RE.match(value):
        return "month"
    if YEAR_RE.match(value):
        return "year"
    if value.lower() == "present":
        return "present"
    return "unknown"


def precision_rank(value: str) -> int:
    return {
        "unknown": 0,
        "present": 0,
        "year": 1,
        "month": 2,
        "day": 3,
    }.get(value, 0)


def ordinal(day: int) -> str:
    if 10 <= day % 100 <= 20:
        suffix = "th"
    else:
        suffix = {1: "st", 2: "nd", 3: "rd"}.get(day % 10, "th")
    return f"{day}{suffix}"


def format_candidate(candidate: CandidateDate) -> str:
    if candidate.precision == "day":
        return f"{MONTH_NAMES[candidate.month - 1]} {ordinal(candidate.day)} {candidate.year}"
    if candidate.precision == "month":
        return f"{MONTH_NAMES[candidate.month - 1]} {candidate.year}"
    return str(candidate.year)


def clean_markup(value: str) -> str:
    value = unescape(value)
    value = value.replace("&nbsp;", " ")
    value = re.sub(r"<ref[^>]*>.*?</ref>", " ", value, flags=re.S)
    value = re.sub(r"<[^>]+>", " ", value)
    value = re.sub(r"\{\{nowrap\|(.*?)\}\}", r"\1", value)
    value = re.sub(r"\[\[(?:[^\]|]+\|)?([^\]]+)\]\]", r"\1", value)
    value = re.sub(r"\{\{small\|(.*?)\}\}", r"\1", value)
    value = re.sub(r"\{\{plainlist\|(.*?)\}\}", r"\1", value)
    value = re.sub(r"\{\{ubl\|(.*?)\}\}", r"\1", value)
    value = re.sub(r"\{\{hlist\|(.*?)\}\}", r"\1", value)
    value = re.sub(r"\{\{lang\|[^|]+\|(.*?)\}\}", r"\1", value)
    value = re.sub(r"\{\{.*?\}\}", " ", value)
    value = value.replace("–", "-").replace("—", "-")
    return re.sub(r"\s+", " ", value).strip()


def parse_date_value(value: str) -> tuple[str, int, int | None, int | None] | None:
    template_patterns = [
        re.compile(
            r"\{\{(?:start date(?: and age)?|birth based on age as of date|dts)\|(\d{4})\|(\d{1,2})\|(\d{1,2})(?:\|[^}]*)?\}\}",
            re.I,
        ),
        re.compile(
            r"\{\{date\|(\d{1,2})\|(\d{1,2})\|(\d{4})(?:\|[^}]*)?\}\}",
            re.I,
        ),
    ]
    for idx, pattern in enumerate(template_patterns):
        match = pattern.search(value)
        if not match:
            continue
        if idx == 0:
            year, month, day = match.groups()
        else:
            day, month, year = match.groups()
        return ("day", int(year), int(month), int(day))

    cleaned = clean_markup(value)
    cleaned = re.sub(r"\([^)]*\)", " ", cleaned)
    cleaned = re.sub(r"\s+", " ", cleaned).strip()

    day_first = re.search(
        r"\b(\d{1,2})\s+"
        r"(January|February|March|April|May|June|July|August|September|October|November|December)"
        r"\s+(\d{4})\b",
        cleaned,
    )
    if day_first:
        day, month, year = day_first.groups()
        return ("day", int(year), MONTHS[month], int(day))

    month_first = re.search(
        r"\b(January|February|March|April|May|June|July|August|September|October|November|December)"
        r"\s+(\d{1,2}),?\s+(\d{4})\b",
        cleaned,
    )
    if month_first:
        month, day, year = month_first.groups()
        return ("day", int(year), MONTHS[month], int(day))

    month_year = re.search(
        r"\b(January|February|March|April|May|June|July|August|September|October|November|December)"
        r"\s+(\d{4})\b",
        cleaned,
    )
    if month_year:
        month, year = month_year.groups()
        return ("month", int(year), MONTHS[month], None)

    year_only = re.search(r"\b(\d{4})\b", cleaned)
    if year_only:
        return ("year", int(year_only.group(1)), None, None)

    return None


def strip_leading_templates(wikitext: str) -> str:
    text = wikitext.lstrip()
    while text.startswith("{{"):
        depth = 0
        end = None
        for idx in range(len(text) - 1):
            pair = text[idx : idx + 2]
            if pair == "{{":
                depth += 1
            elif pair == "}}":
                depth -= 1
                if depth == 0:
                    end = idx + 2
                    break
        if end is None:
            break
        text = text[end:].lstrip()
    return text


def extract_lead_text(wikitext: str) -> str:
    text = strip_leading_templates(wikitext)
    lead = text.split("\n==", 1)[0]
    lead = re.sub(r"\{\{[^{}]*\}\}", " ", lead)
    lead = clean_markup(lead)
    return lead[:1500]


def extract_infobox_fields(wikitext: str) -> dict[str, str]:
    fields: dict[str, str] = {}
    for line in wikitext.splitlines()[:250]:
        if not line.startswith("|") or "=" not in line:
            continue
        key, value = line[1:].split("=", 1)
        normalised = key.strip().lower().replace(" ", "_")
        fields[normalised] = value.strip()
    return fields


def parse_leader_field(leader: str) -> tuple[str, str]:
    parts = re.split(r"\s*/\s*|\s+-\s+", leader, maxsplit=1)
    if len(parts) == 2:
        return parts[0].strip(), parts[1].strip()
    return leader.strip(), ""


def dedupe(items: list[str]) -> list[str]:
    seen: set[str] = set()
    output: list[str] = []
    for item in items:
        item = item.strip()
        if not item or item in seen:
            continue
        seen.add(item)
        output.append(item)
    return output


def build_queries(row: dict[str, str]) -> list[str]:
    person, role = parse_leader_field(row["leader"])
    person = re.sub(r"\s+\(or\)\s+", " ", person).strip()
    person_no_parens = re.sub(r"\([^)]*\)", " ", person)
    person_no_parens = re.sub(r"\s+", " ", person_no_parens).strip()
    sub2 = row["sub denomination 2"]
    denom = row["Denomination"]
    religion = row["religion"]
    org = sub2 or row["sub denomination"] or denom or religion
    of_query = ""
    if " of " in role.lower():
        after_of = role.split(" of ", 1)[1].strip()
        if after_of:
            of_query = f"{person_no_parens} of {after_of}"
    queries = [
        f'{row["leader"]} {org}',
        f"{person_no_parens} {role} {org}",
        f"{person_no_parens} {org}",
        of_query,
        f"{role} {org}",
        role,
        person_no_parens,
        f"{person_no_parens} {denom}",
    ]
    return dedupe(queries)


def score_search_result(row: dict[str, str], result: dict[str, Any]) -> int:
    person, role = parse_leader_field(row["leader"])
    person = re.sub(r"\s+\(or\)\s+", " ", person).strip()
    person = re.sub(r"\([^)]*\)", " ", person)
    person = re.sub(r"\s+", " ", person).strip()
    title = result["title"]
    snippet = clean_markup(result.get("snippet", ""))
    haystack = normalise_text(f"{title} {snippet}")
    title_text = normalise_text(title)

    person_tokens = [token for token in tokens(person) if token not in STOPWORDS]
    role_tokens = [token for token in tokens(role) if token not in STOPWORDS]
    focus_tokens = dedupe(person_tokens + role_tokens)
    org_tokens = [
        token
        for token in tokens(
            " ".join(
                [
                    row["sub denomination 2"],
                    row["sub denomination"],
                    row["Denomination"],
                    row["religion"],
                ]
            )
        )
        if token not in STOPWORDS
    ]

    score = 0
    full_person = normalise_text(person)
    if full_person and full_person in title_text:
        score += 18
    full_role = normalise_text(role)
    if full_role and full_role in title_text:
        score += 14

    focus_hits = 0
    for token in focus_tokens:
        if token in title_text:
            score += 7
            focus_hits += 1
        elif token in haystack:
            score += 3
            focus_hits += 1

    for token in org_tokens[:6]:
        if token in title_text:
            score += 2
        elif token in haystack:
            score += 1

    if not focus_hits:
        score -= 12

    if title.lower().startswith("list of"):
        score -= 12
    if "disambiguation" in title.lower():
        score -= 8

    if any(hint in haystack for hint in ROLE_HINTS):
        score += 2

    return score


def best_wikipedia_page(fetcher: Fetcher, row: dict[str, str]) -> tuple[dict[str, Any] | None, str]:
    best_result: dict[str, Any] | None = None
    best_query = ""
    best_score = -10**9
    for query in build_queries(row):
        results = fetcher.search_wikipedia(query)
        for result in results[:5]:
            score = score_search_result(row, result)
            if score > best_score:
                best_score = score
                best_query = query
                best_result = result
        if best_score >= 40:
            break
    if not best_result:
        return None, best_query
    best_page = fetcher.wikipedia_page_bundle(best_result["title"])
    best_page["search_title"] = best_result["title"]
    best_page["search_snippet"] = clean_markup(best_result.get("snippet", ""))
    best_page["search_score"] = best_score
    return best_page, best_query


def field_priority(key: str) -> int:
    key = re.sub(r"\d+$", "", key).rstrip("_")
    try:
        return DATE_FIELD_PRIORITY.index(key)
    except ValueError:
        return 10_000


def infobox_candidate(page: dict[str, Any]) -> CandidateDate | None:
    fields = extract_infobox_fields(page.get("wikitext", ""))
    candidates: list[tuple[int, CandidateDate]] = []
    page_url = f'https://en.wikipedia.org/wiki/{page["title"].replace(" ", "_")}'
    for key, raw_value in fields.items():
        priority = field_priority(key)
        if priority == 10_000:
            continue
        parsed = parse_date_value(raw_value)
        if not parsed:
            continue
        precision, year, month, day = parsed
        candidates.append(
            (
                priority,
                CandidateDate(
                    precision=precision,
                    year=year,
                    month=month,
                    day=day,
                    basis=key,
                    source_type="secondary_wikipedia",
                    source_url=page_url,
                    notes=f"Wikipedia infobox field `{key}`",
                ),
            )
        )
    if not candidates:
        return None
    candidates.sort(key=lambda item: (item[0], -precision_rank(item[1].precision)))
    return candidates[0][1]


def extract_candidate(page: dict[str, Any]) -> CandidateDate | None:
    extract = page.get("extract_text", "")
    if not extract:
        return None
    patterns = [
        r"\b(?:since|from)\s+((?:\d{1,2}\s+)?(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+(?:\d{1,2},?\s+)?\d{4})",
        r"\b(?:appointed|elected|enthroned|installed|inaugurated|assumed office)\s+on\s+((?:\d{1,2}\s+)?(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+(?:\d{1,2},?\s+)?\d{4})",
        r"\bbecame\b[^.]{0,80}?\bon\s+((?:\d{1,2}\s+)?(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+(?:\d{1,2},?\s+)?\d{4})",
        r"\bfrom\s+(\d{4})\b",
        r"\bsince\s+(\d{4})\b",
    ]
    matched = None
    for pattern in patterns:
        match = re.search(pattern, extract)
        if match:
            matched = match.group(1)
            break
    if not matched:
        return None
    parsed = parse_date_value(matched)
    if not parsed:
        return None
    precision, year, month, day = parsed
    return CandidateDate(
        precision=precision,
        year=year,
        month=month,
        day=day,
        basis="extract",
        source_type="secondary_wikipedia",
        source_url=f'https://en.wikipedia.org/wiki/{page["title"].replace(" ", "_")}',
        notes="Wikipedia lead extract",
    )


def candidate_from_wikidata(fetcher: Fetcher, row: dict[str, str], qid: str) -> CandidateDate | None:
    entity = fetcher.wikidata_entity(qid)
    claims = entity.get("claims", {}).get("P39", [])
    current_claims = []
    office_ids = []
    for claim in claims:
        qualifiers = claim.get("qualifiers", {})
        if "P580" not in qualifiers:
            continue
        if "P582" in qualifiers:
            continue
        office_id = (
            claim.get("mainsnak", {})
            .get("datavalue", {})
            .get("value", {})
            .get("id", "")
        )
        office_ids.append(office_id)
        current_claims.append(claim)

    if not current_claims:
        return None

    labels = fetcher.wikidata_labels(office_ids)
    role_tokens = set(
        token
        for token in tokens(
            " ".join(
                [
                    row["leader"],
                    row["sub denomination 2"],
                    row["sub denomination"],
                    row["Denomination"],
                ]
            )
        )
        if token not in STOPWORDS
    )

    best: tuple[int, CandidateDate] | None = None
    for claim in current_claims:
        office_id = (
            claim.get("mainsnak", {})
            .get("datavalue", {})
            .get("value", {})
            .get("id", "")
        )
        start_value = claim["qualifiers"]["P580"][0]["datavalue"]["value"]
        precision = {11: "day", 10: "month", 9: "year"}.get(
            start_value.get("precision"),
            "unknown",
        )
        year = int(start_value["time"][1:5])
        month = int(start_value["time"][6:8]) if precision in {"day", "month"} else None
        day = int(start_value["time"][9:11]) if precision == "day" else None

        office_label = labels.get(office_id, "")
        label_tokens = set(tokens(office_label))
        score = len(role_tokens & label_tokens) * 3
        if office_label:
            score += 2

        reference_urls: list[str] = []
        source_type = "secondary_wikidata"
        for reference in claim.get("references", []):
            snaks = reference.get("snaks", {})
            for snak in snaks.get("P854", []):
                url = snak.get("datavalue", {}).get("value")
                if not url:
                    continue
                reference_urls.append(url)
                if "wikipedia.org" not in url and "wikidata.org" not in url:
                    source_type = "official_reference"
        source_url = " | ".join(dedupe(reference_urls)) or f"https://wikidata.org/wiki/{qid}"

        candidate = CandidateDate(
            precision=precision,
            year=year,
            month=month,
            day=day,
            basis=f"wikidata:{office_label or office_id}",
            source_type=source_type,
            source_url=source_url,
            notes="Wikidata current-office P39/P580",
        )
        ranked = (score, candidate)
        if best is None or ranked[0] > best[0] or (
            ranked[0] == best[0]
            and precision_rank(candidate.precision) > precision_rank(best[1].precision)
        ):
            best = ranked

    return best[1] if best else None


def choose_candidate(candidates: list[CandidateDate]) -> CandidateDate | None:
    if not candidates:
        return None

    basis_order = {
        "term_start": 0,
        "termstart": 0,
        "start_date": 1,
        "service_start": 1,
        "incumbency_start": 1,
        "assumed_office": 2,
        "installed": 3,
        "enthroned": 3,
        "inaugurated": 4,
        "reign": 5,
        "began": 6,
        "extract": 7,
        "elected": 8,
        "appointed": 9,
    }

    def key(candidate: CandidateDate) -> tuple[int, int, int, int, int]:
        base = re.sub(r"\d+$", "", candidate.basis.split(":", 1)[0]).rstrip("_")
        return (
            basis_order.get(base, 20),
            -precision_rank(candidate.precision),
            candidate.year,
            candidate.month or 0,
            candidate.day or 0,
        )

    return sorted(candidates, key=key)[0]


def process_row(fetcher: Fetcher, row_number: int, row: dict[str, str]) -> tuple[str, dict[str, str]]:
    current_since = row["since"].strip()
    before_precision = precision_of(current_since)
    page, query = best_wikipedia_page(fetcher, row)

    candidates: list[CandidateDate] = []
    source_url = ""
    notes = ""

    if page:
        source_url = f'https://en.wikipedia.org/wiki/{page["title"].replace(" ", "_")}'
        notes = (
            f'Search query `{query}` matched `{page["title"]}` with score {page.get("search_score", 0)}'
        )
        infobox = infobox_candidate(page)
        if infobox:
            candidates.append(infobox)
        extract = extract_candidate(page)
        if extract:
            candidates.append(extract)
    else:
        notes = f"No Wikipedia match found from queries derived from row {row_number}"

    chosen = choose_candidate(candidates)
    if chosen and precision_rank(chosen.precision) > precision_rank(before_precision):
        new_since = format_candidate(chosen)
        after_precision = chosen.precision
        source_url = chosen.source_url or source_url
        source_type = chosen.source_type
        tenure_basis = chosen.basis
        notes = f"{chosen.notes}; {notes}".strip("; ")
    else:
        new_since = current_since
        after_precision = before_precision
        source_type = chosen.source_type if chosen else ("secondary_wikipedia" if page else "")
        tenure_basis = chosen.basis if chosen else ""
        if chosen:
            notes = (
                f"Best candidate `{format_candidate(chosen)}` did not improve precision over `{current_since}`; "
                f"{chosen.notes}; {notes}"
            )

    log_row = {
        "row_number": str(row_number),
        "religion": row["religion"],
        "denomination": row["Denomination"],
        "sub_denomination": row["sub denomination"],
        "sub_denomination_2": row["sub denomination 2"],
        "leader": row["leader"],
        "old_since": current_since,
        "new_since": new_since,
        "precision_before": before_precision,
        "precision_after": after_precision,
        "tenure_basis": tenure_basis,
        "source_type": source_type,
        "source_url": source_url,
        "notes": notes,
    }
    return new_since, log_row


def read_rows(path: Path) -> tuple[list[str], list[dict[str, str]]]:
    with path.open(newline="", encoding="utf-8") as handle:
        reader = csv.DictReader(handle)
        rows = list(reader)
        return reader.fieldnames or [], rows


def write_leaders_csv(path: Path, fieldnames: list[str], rows: list[dict[str, str]]) -> None:
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames, lineterminator="\n")
        writer.writeheader()
        writer.writerows(rows)


def write_log(path: Path, rows: list[dict[str, str]]) -> None:
    fieldnames = [
        "row_number",
        "religion",
        "denomination",
        "sub_denomination",
        "sub_denomination_2",
        "leader",
        "old_since",
        "new_since",
        "precision_before",
        "precision_after",
        "tenure_basis",
        "source_type",
        "source_url",
        "notes",
    ]
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames, lineterminator="\n")
        writer.writeheader()
        writer.writerows(rows)


def append_log(path: Path, rows: list[dict[str, str]]) -> None:
    fieldnames = [
        "row_number",
        "religion",
        "denomination",
        "sub_denomination",
        "sub_denomination_2",
        "leader",
        "old_since",
        "new_since",
        "precision_before",
        "precision_after",
        "tenure_basis",
        "source_type",
        "source_url",
        "notes",
    ]
    exists = path.exists()
    with path.open("a", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames, lineterminator="\n")
        if not exists:
            writer.writeheader()
        writer.writerows(rows)


def main() -> int:
    parser = argparse.ArgumentParser(description="Enrich non-exact leader start dates.")
    parser.add_argument("--csv", default="leaders.csv", help="Path to leaders CSV")
    parser.add_argument(
        "--log",
        default="leaders-research-log.csv",
        help="Path to research log CSV",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=0,
        help="Maximum number of non-exact rows to review in this run",
    )
    parser.add_argument(
        "--start-row",
        type=int,
        default=2,
        help="Absolute CSV row number to start reviewing from",
    )
    parser.add_argument(
        "--append-log",
        action="store_true",
        help="Append to the log file instead of overwriting it",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Preview changes without writing the main CSV",
    )
    args = parser.parse_args()

    csv_path = Path(args.csv)
    log_path = Path(args.log)

    fieldnames, rows = read_rows(csv_path)
    fetcher = Fetcher()
    research_log: list[dict[str, str]] = []

    reviewed = 0
    updated = 0
    last_row = 0

    for idx, row in enumerate(rows, start=2):
        if idx < args.start_row:
            continue
        if EXACT_DATE_RE.match(row["since"].strip()):
            continue
        if args.limit and reviewed >= args.limit:
            break

        new_since, log_row = process_row(fetcher, idx, row)
        if new_since != row["since"]:
            row["since"] = new_since
            updated += 1
        research_log.append(log_row)
        reviewed += 1
        last_row = idx
        print(f"Reviewed row {idx}: {row['leader']} -> {row['since']}", file=sys.stderr)

    if args.dry_run:
        preview_path = log_path.with_suffix(".preview.csv")
        write_log(preview_path, research_log)
        print(
            json.dumps(
                {
                    "reviewed": reviewed,
                    "updated": updated,
                    "last_row": last_row,
                    "preview_log": str(preview_path),
                }
            )
        )
        return 0

    write_leaders_csv(csv_path, fieldnames, rows)
    if args.append_log:
        append_log(log_path, research_log)
    else:
        write_log(log_path, research_log)
    print(json.dumps({"reviewed": reviewed, "updated": updated, "last_row": last_row}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
