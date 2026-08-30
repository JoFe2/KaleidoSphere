# Synthetic connector fixture v1

Status: future-only fixture contract for issue #92 / FRC.3. This directory
contains a small, reviewable, hand-authored fixture for a future local spike. It
is not a connector, MCP server, authorization, execution receipt, or production
claim.

## What is materialized

`synthetic-connector-fixture-v1.json` is the complete fixture contract and data
payload. It contains:

- 2 collections: `catalog` and `telemetry`;
- 6 records total, 3 per collection;
- 5 declared fields per collection, with at most 5 fields in any record;
- deterministic identifiers matching `SYN-<collection>-<ordinal>`;
- deterministic integers and booleans; and
- only the closed labels listed in the JSON provenance block.

The contract exposes only these read-only actions for a future local adapter:
`enumerate_collections`, `read_record`, and `count_records`. Create, update,
delete, grant, deploy, publish, and send are explicitly prohibited. The fixture
is deliberately much smaller than the FRC.3 limits of 10 collections, 50
records per collection, 500 records total, 10 fields per record, and 256 bytes
per field.

## Provenance and readability

The payload is `HAND_AUTHORED_SYNTHETIC`. It was authored from the FRC.3
synthetic-only plan, not copied or transformed from a database, provider
payload, API response, customer export, or local environment. `sourceInputs` is
empty and the provenance block records these negative claims explicitly:

- `generatedFromCustomerData: false`;
- `copiedFromProviderPayload: false`;
- `environmentDerived: false`; and
- `externalCallsDuringAuthoring: false`.

The JSON is UTF-8, pretty-printed with two-space indentation, and uses stable
field and record ordering so a reviewer can inspect it directly. There are no
emails, names of real people or organizations, account numbers, tokens,
passwords, credentials, timestamps, hostnames, filesystem paths, environment
values, or source-row values. The identifiers, labels, statuses, counts, and
flags are fictitious closed-set test values only.

The manifest digest covers `fixture.collections` only, excluding the manifest
itself to avoid a circular hash. Canonicalization is UTF-8 JSON with sorted
object keys and no insignificant whitespace. The committed digest is:

`sha256:933b2e96d606d2037d1e27ce8a05d42683b7dc0d0acdcb05ddeece46653bb67f`

Re-derive it locally with:

```bash
python3 - <<'PY'
import hashlib
import json
from pathlib import Path

path = Path("docs/future/remote-connector/fixtures/synthetic-connector-fixture-v1.json")
data = json.loads(path.read_text(encoding="utf-8"))
canonical = json.dumps(
    data["fixture"]["collections"],
    ensure_ascii=False,
    sort_keys=True,
    separators=(",", ":"),
).encode("utf-8")
print("sha256:" + hashlib.sha256(canonical).hexdigest())
PY
```

A different digest is a provenance mismatch and must be treated as NO-GO, not
silently accepted or regenerated from another source.

## Isolation plan

The fixture is a local file and requires no endpoint at all. The future spike
must consume it from a fresh disposable execution directory with:

1. network disabled (localhost-only is the stricter alternative if a local
   helper is later proven necessary);
2. no public bind address, hosted endpoint, cloud service, or external network
   dependency;
3. no credentials, customer data, provider payloads, or environment-derived
   inputs;
4. only the three read-only actions in the contract;
5. the FRC.3 timeout, request, record, retry, and cleanup limits; and
6. a pre-spike snapshot plus a sealed local receipt, followed by deletion of
   temporary execution artifacts.

A future adapter must fail closed before start if it needs a public listener,
external host, credential, customer data, mutation action, or unbounded retry.
After start it must stop immediately if any of those conditions appears or if
the fixture digest does not match. This fixture therefore proves the planned
positive case without requiring customer data or a public endpoint; it does not
prove that a future adapter has been implemented or authorized.

## Focused checks

Validate JSON syntax:

```bash
python3 -m json.tool docs/future/remote-connector/fixtures/synthetic-connector-fixture-v1.json
```

The fixture contract is documentation/test input only. No command in this note
starts a service, opens a listener, contacts a provider, or changes the default
runtime.
