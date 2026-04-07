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

