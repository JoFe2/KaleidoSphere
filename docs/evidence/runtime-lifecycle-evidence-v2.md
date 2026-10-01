# Observed host-lifecycle evidence, v2

This correction belongs to the existing technical evidence obligations of #76 and #77 under #73. It is not a marketplace submission or an authenticated model result.

## Corrected observations

The manual `scripts/release/k4c-codex-isolated-e2e.mjs` and `scripts/release/k4d-claude-isolated-e2e.mjs` helpers previously marked every required negative as `denied`, including cases never reached after an early generator/version failure. Clean-boundary receipts now use a separate v2 schema and record each check only when reached:

- `not-run`: its check was never executed;
- `not-triggered`: the guard was evaluated on the permitted counterpart (for example an initially clean profile or successful discovery); this is not an observed rejection of a bad input;
- `denied`: an actual supplied negative reached its check and matched the required denial;
- `failed`: the evaluated check did not match its required outcome.

A recovery cleanup after a failed lifecycle does not turn its unexecuted checks into successful negative evidence. Ordered command results retain actual process outputs even when their expected outcome was not observed. An authentication failure is not a refusal of an undeclared skill. A model's content-based refusal can be a successful process with exit 0; it must still contain the required refusal, without spawn failure or termination by signal.

An unobserved or failed host-version probe records `version: null`, not the historical fixture's version. A successful Codex probe captures the actual syntactically valid version without enforcing the historical transcript version; it does not infer compatibility or authenticated use from the version string. Subsequent commands must still satisfy their own checks.

The Claude helper also used empty plugin/marketplace registration lists as filesystem emptiness. A v2 receipt separates `registrationClean`, `nativeResiduePaths`, `nativeFilesystemEmpty` and actual `emptyAfterCleanup`. Native files are enumerated in the isolated config/HOME before explicit harness cleanup. A separate post-cleanup readback verifies the owned boundary was removed, or the caller-supplied boundary was emptied. Native cache retention remains visible and is never described as native zero-residue merely because the harness later removes its own test profile.

The generator and Claude helper now share the explicitly selected parent `TMPDIR`; the helper does not silently drop that scope and fall back to a different generator temp root.

## Preserved history and scope

Historical v1 transcript fixtures, v1 schemas and already recorded evidence retain their original bytes and proof class. Fixture replay still emits v1 and performs no host invocation. New manual clean-boundary receipts use v2 and different default receipt paths. Do not reinterpret old fixture success as current runtime proof.

The helpers are local evidence tooling, not an OS sandbox or permission to access an account. Use only an independently admitted safe boundary and synthetic inputs. The isolated Codex CLI authentication result says nothing about production Hermes authentication. No profile, credential, provider or global configuration changes are authorized by this correction.

Claude `plugin details` is component inventory, not an authenticated model/skill invocation. The v2 receipt explicitly preserves that distinction. Host-version compatibility, authenticated use and its model negatives still require their separate real observations. Official submission, publisher/terms authority, anonymous matching public install and the original issue's terminal criteria remain separate.

## Regression boundary

Registered tests exercise the actual helper processes with explicitly synthetic local CLI test doubles. They cover early failures, completed negative checks, failed counterparts and retained cache versus actual cleanup. These test doubles are not external API responses and never stand in for host/model, human-reader, real-pilot or public-platform acceptance. The approved counterpart and historical fixture behavior remain covered alongside the exact expected rejections.

No README redesign or replacement is part of this change. #241 remains separately owned by Main for the revised draft and separately requires owner publication approval.
