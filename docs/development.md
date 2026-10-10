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

Unit tests use a local HTTP server and simulated VS Code, Git, and SecretStorage APIs. They cover concurrent generation, draft preservation, cancellation, total deadlines, URL queries, final response validation, key migration failures, and bounded long-diff summaries.

## Debugging and locale checks

After compilation, press `F5` in VS Code to launch the Extension Development Host. For locale checks, use **Configure Display Language**, restart the host, and verify English and `zh-cn` separately.

Before release, check both VS Code 1.85 and the current stable version: generate and cancel from the notification, run with two repositories, edit a draft while waiting, set/clear a key, and accept/decline legacy migration. Use disposable profiles and test keys for migration checks.

## Packaging

See [Packaging and publishing](./publishing.md) for release preparation and VSIX verification.
