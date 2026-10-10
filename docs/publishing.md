# Packaging and publishing

[Documentation](./README.md) · [Project overview](../README.md)

For local setup and debugging, see [Development](./development.md).

## Prepare a release

Synchronize the version in `package.json` and `package-lock.json`, and update the [English changelog](../CHANGELOG.md) and [Simplified Chinese changelog](../CHANGELOG.zh-CN.md).

From the repository root, run:

```bash
npm ci
npm test
npm run compile
git diff --check
npx @vscode/vsce package
```

## Verify the VSIX

Install the resulting VSIX to check the commands, Settings descriptions, and generation workflow. See [Local VSIX installation](../README.md#local-vsix).

Verify VS Code 1.85 and the current stable version in English and Simplified Chinese. Check notification cancellation, concurrent repositories, draft preservation, password key entry, and confirmed migration without modifying real credentials.

The package must include:

- `out/extension.js` and runtime dependencies.
- English base resources (`package.nls.json`) and `package.nls.zh-cn.json`.
- The project README, `docs/` guides, and both changelogs.

Source files, test scripts, source maps, CI configuration, temporary files, and previous `dist/` artifacts are excluded by [.vscodeignore](../.vscodeignore). Runtime dependencies are required; do not omit them when packaging or publishing.

## Publish

After verifying the package, publish with the configured publisher account:

```bash
npx @vscode/vsce publish
```
