# Development

[Documentation](./README.md) · [Project overview](../README.md)

## Local setup

Install Node.js 22 with npm, Git, and VS Code. The extension requires VS Code 1.85.0 or later; its API typings are pinned to 1.85.0.

```bash
git clone https://github.com/u7pi/ai-commit-generator
cd ai-commit-generator
npm ci
npm test
npm run compile
```

The committed lockfile fixes dependency versions. GitHub Actions runs installation, tests, compilation, and diff checks on Windows and Ubuntu with Node.js 22.

Tests use a local HTTP server and simulated VS Code, Git, and SecretStorage APIs. They cover startup mask restoration without a network probe, HTTP 401 cleanup and preservation of newer credentials, retention on 403/network errors, endpoint binding, legacy upgrades, configuration snapshots/scopes, delayed writes and clearing, closed progress during dialogs, staged-content changes, draft preservation, Git/API cancellation, byte limits and UTF-8 boundaries, placeholder cleanup, fallback paths, and bounded summaries. Additional tests load the installed simple-git library and redirect only its spawn boundary to real Node child processes to verify literal paths containing spaces, cancellation, and deadlines despite continuous output. The 30-second plugin timer is shortened only inside these tests.

## Debugging and locale checks

After compilation, press `F5` in VS Code to launch the Extension Development Host. For locale checks, use **Configure Display Language**, restart the host, and verify English and `zh-cn` separately.

Before release, check Windows with both VS Code 1.85 and the current stable version, in English and `zh-cn`. Use disposable profiles/workspaces and test keys. Verify generation/cancellation, two repositories, draft and staged-content changes during generation, setting/clearing keys while a confirmation is pending, legacy binding and changed path/query approval or dismissal, 401/403 retries while the error is open, SCM placeholder restoration, and Command Palette/disabled Git API fallbacks. Automated API checks do not replace visual checks of dialog visibility and localized UI.

## Packaging

See [Packaging and publishing](./publishing.md) for release preparation and VSIX verification.
