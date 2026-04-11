## Hi there 👋


- 🌱 I’m currently learning Geographic Data Science
- 🤔 I’m looking for help with working on AI as a beginner
- 💬 Ask me about censorship

## Home Button Automation

- Every HTML file includes a shared loader script that ensures a Home button is present.
- Existing HTML files were updated automatically.
- New HTML files are handled by a VS Code background task that watches the workspace and injects the loader tag.

Manual commands:

- Run one-time injection: `node scripts/home-button-manager.mjs`
- Run watcher manually: `node scripts/home-button-manager.mjs --watch`

## Country Flag Audit

- Run `node scripts/audit-country-flag-codes.mjs` to verify country flag code resolution stays canonical across denomination pages that use `country-flag-utils.js`.
- The audit also fails if a new page starts using `country-flag-utils.js` without being added to the script scenarios.
- GitHub Actions runs this audit automatically on pushes and pull requests to `main` via `.github/workflows/country-flag-audit.yml`.
