# Comlist source

The public entry point is `/comlist.html`. Edit `_assets/list.html`, `_assets/css/`, and `_assets/js/`; build.js generates the hashed deployment bundle. Google Sheets remains authoritative; private material and credentials are not included.

Run `npm ci` then `npm test`. Real-browser fixture tests: `node tools/test_browser.cjs` with `CODEX_NODE_MODULES` pointing to a runtime containing Playwright.


## Weekly quest UI

The field page starts with the existing weekly mission, followed by one existing action and five monthly activity cards. Today shortcuts open a completed-activity draft; saving and outcome confirmation remain explicit. Progress feedback runs only after a successful version-checked write with an actual increase. Counts, units, targets, encrypted pending records, calendar access and reduced-motion behavior are unchanged. No GAS schema or permission changes are required.

Validation: 507 unit tests, ESLint, four existing browser fixture suites and the PC/mobile quest fixture passed without production requests. Preview captures use synthetic data. The deployment bundle was regenerated from the isolated source with the existing encrypted payload preserved and verified. Live GAS deployment was not changed or exercised.

Integrate the isolated quest commit by reviewing/cherry-picking it onto the latest release branch, resolving any later UI changes, rebuilding and repeating fixture checks. Update the daily generator source only as part of an explicitly approved release, then push and verify CI/Pages. This implementation does not publish.
