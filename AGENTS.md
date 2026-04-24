# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

## Project Overview

A personal static website (vimal.github.io) with a focus on a **Religious Leader Tracker** — a database covering 150+ religious denominations worldwide. No build system; all pages are plain HTML/CSS/JavaScript.

## Commands

### Validation (also runs in CI)
```bash
node scripts/audit-country-flag-codes.mjs
```
Validates country flag emoji codes used across denomination pages. Runs automatically on push/PR to `main` via GitHub Actions (Node 22).

### Home button injection
```bash
node scripts/home-button-manager.mjs          # inject once
node scripts/home-button-manager.mjs --watch  # watch for new HTML files
```
VS Code auto-runs the watcher on folder open (`.vscode/tasks.json`).

### Data enrichment (Python)
```bash
python scripts/enrich_leader_dates.py                    # parse Wikipedia infoboxes for tenure dates
python scripts/enrich_denomination_leader_images.py      # fetch leader images from Wikimedia Commons
```

## Architecture

**Static site** — no framework, no bundler. All pages are self-contained HTML files with inline or linked CSS.

### Key pages
- `index.html` — personal homepage
- `religious-tracker.html` — main tracker with all 150+ denominations, membership data, and leader info
- `religious-denominations/[name].html` — ~155 individual denomination pages
- `polio.html`, `song-archive.html` — standalone tracker pages

### Shared JS loaders (loaded via `<script>` tags)
- `home-button-loader.js` — injects a home navigation button into every page
- `last-edited-loader.js` — calls the GitHub API to fetch last-commit date and renders a badge

### Data files
- `leaders.csv` — primary leadership database (source of truth for all denomination pages)
- `leaders-research-log.csv` — audit trail for research decisions
- `membership-data.json` — denomination membership statistics used in `religious-tracker.html`

### Styling
- Shared denomination page styles: `religious-denominations/denomination-page.css`
- Color palette: cream background `#f5f1e8`, red accent `#d93025`
- Responsive via CSS `clamp()`, Grid, and Flexbox; no CSS framework

### Data flow
1. Research recorded in `leaders.csv`
2. Python scripts enrich data (Wikipedia/Wikimedia APIs)
3. Denomination HTML pages are authored/updated manually from the CSV data
4. JS loaders inject navigation and last-edited badges at runtime
5. CI audits flag codes on every push
