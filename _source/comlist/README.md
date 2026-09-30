# Comlist source

The public entry point is `/comlist.html`. Edit `_assets/list.html`, `_assets/css/`, and `_assets/js/`; build.js generates the hashed deployment bundle. Google Sheets remains authoritative; private material and credentials are not included.

Run `npm ci` then `npm test`. Real-browser fixture tests: `node tools/test_browser.cjs` with `CODEX_NODE_MODULES` pointing to a runtime containing Playwright.
