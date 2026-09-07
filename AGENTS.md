# AGENTS.md

Guidance for Codex and other coding agents working in this repository.

## What this is

Vimal Vivegananda's personal portfolio site, served by GitHub Pages at
https://vimal.my (CNAME). Plain HTML, CSS and JavaScript — no framework, no
bundler, no npm dependencies. Every page is a self-contained HTML file at the
repository root.

## Commands

```bash
node scripts/build.mjs           # stamp the shared menu + SEO head block into every page, regenerate sitemap.xml
node scripts/build.mjs --check   # exit 1 if any page or sitemap.xml is out of date (runs in CI)
python3 -m http.server 8123 --bind 127.0.0.1   # local preview (also .claude/launch.json "site")
```

Run the build after adding or renaming a page or editing anything between the
marker comments. New pages must be added to `PAGES` in `scripts/build.mjs`
(description, og:type, optional Article JSON-LD) or the build fails.

## Layout

- `index.html` — homepage; this *is* the About Me page (shared header + the bio)
- `work.html` — the My Work page
- `polio.html`, `mapping-the-papacy.html`, `song-archive.html` — project pages
  (song-archive also carries the current Song of the Month pick)
- `report-*.html` — long-form reports; wrapper is `<div class="container article">`
- `404.html` — GitHub Pages not-found page (root-relative URLs only)
- `site.css` — the single shared stylesheet: Bagnard @font-face, design tokens
  (CSS custom properties with dark-mode values swapped once), reset, `.container`,
  `.back-link`, the `.site-header` band (name + `.social-links` + `.site-nav`),
  `.article` typography, `.data-table`, and the Song of the Month widget classes.
  Page-specific rules stay inline in each page.
- `site.js` — cross-fades the header name between `Vimal` and `விமல்` on every
  page (stamped `<script src="/site.js" defer>`); static under reduced motion.
- `song-visualizer.js` — decorative canvas rails beside the Spotify embeds
  (song archive page). Animates only while visible; static under reduced motion.
- `scripts/build.mjs` — the only tooling. Stamps `<!-- header:start/end -->` —
  the name, the Substack / LinkedIn / Email links and the menu bar (in the style
  of aadi.net.in), first thing in `<body>` on every page — and
  `<!-- seo:start/end -->` (in `<head>`), and writes `sitemap.xml`. The name is
  the `<h1>` on the homepage and a link home elsewhere; menu labels, hrefs and
  the social links all live in that script.
- `world-map.svg` — minified world map fetched by `mapping-the-papacy.html`
- `report-images/*.webp`, `assets/og-card.png`, `favicon.svg`

## Conventions

- Colours come from the tokens in `site.css` (`var(--ink)`, `var(--accent)`,
  `var(--card)`, …). Never duplicate a dark-mode rule that only re-colours;
  change the token instead.
- Keep pages dependency-free and fast: no new third-party scripts or fonts, images
  as `.webp` with explicit `width`/`height` and `loading="lazy"`.
- Canonical URLs are extensionless (`https://vimal.my/polio`); internal links use
  `page.html` (root-relative `/page.html` on 404.html).
- CI (`.github/workflows/site-quality.yml`): build freshness check, offline
  internal-link check (lychee), non-blocking Lighthouse.

## Removed project

The Religious Leader Tracker (150+ denomination pages, `leaders.csv`, related
scripts and CI) was removed on 2026-09-02. Everything is archived in
`religious-tracker-archive-2026-09-02.zip` (outside the repo) and in git history
up to commit `9b54be0`.
