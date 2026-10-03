# KS76 — additive Codex directory-upload package

This is an offline packaging correction, not a marketplace listing or an authenticated model result. It preserves the frozen `generate-k4c-codex-plugin.mjs` manifest, all three legacy host archives, the canonical skill, and Portable Companion bytes.

The current OpenAI upload documentation requires both `interface.composerIcon` and `interface.logo` for the Codex package. The legacy host package had neither. This additive upload view references one local square PNG through both fields, extracted byte-for-byte from the already committed KaleidoSphere brand asset. It introduces no new brand, publisher identity, account, Terms decision, hook, MCP server, application, connector or runtime action.

Source: OpenAI, Plugin submission errors, checked 2026-10-03: https://developers.openai.com/plugins/deploy/submission-errors

## Build and verify without authentication

Build-time tools: Node.js 24, GNU tar (the existing canonical distribution builder), and Python 3 standard library. No Python or extra dependency is added to the packaged skill; its request validator remains dependency-free Node.js.

Choose a fresh child of your configured `TMPDIR`, not an existing directory:

    node scripts/release/build-k4c-directory-upload.mjs --out "$TMPDIR/ks76-directory-upload-example"
    node scripts/release/build-k4c-directory-upload.mjs --verify "$TMPDIR/ks76-directory-upload-example"

The output contains `plugin/`, a root-correct ZIP and its SHA-256 sidecar. The ZIP has the manifest at `.codex-plugin/plugin.json`, the existing four skill files under `skills/kaleidosphere/`, and the existing image at `assets/kaleidosphere.png`. ZIP entries are sorted, non-executable regular files, with a fixed 1980 timestamp and no compression-version dependency. The CLI emits a digest receipt on stdout; the receipt is not an extra package file.

Output is confined to the declared `dist/k4c-directory-upload` directory or a child of the configured system scratch directory. Existing output is rejected rather than overwritten. Symlink components, unknown arguments and repository overlap are rejected. Verification reconstructs the expected package from canonical sources and denies changed bytes, executable payload modes, symlinks, extra files/directories, ZIP drift and checksum-sidecar drift. ZIP and checksum-sidecar targets must be regular files before reading; FIFOs and other special file types fail closed instead of blocking. The ZIP helper independently enforces the same target-type restriction.

The skill validator can be executed directly from the extracted ZIP. It still accepts a closed status request and rejects `apply` and undeclared input. No external network or model is needed for those checks.

## Still separate

A valid offline ZIP does not establish authenticated Codex usefulness, verified publisher/organization identity, legal rights or Terms acceptance, submission authority, a submitted package or public directory acceptance. Those original issue obligations remain open. An unchanged failed refresh token is not retried. The frozen submission-contract records and historical evidence remain historical; this additive package is not silently substituted into a prior authorized submission payload.

For #77 the original conditional clause independently permits packaging-only with explicit nonclaims when a safe authenticated runtime is unavailable. This #76 correction does not add an unconditional Claude-login requirement, a human comprehension/effort study, or a new data permission for the #250 pilot.
