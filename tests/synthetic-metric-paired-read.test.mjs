import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const producer = process.env.KS247_PRODUCER_CHECKOUT;
const fixture = "tests/fixtures/business-bi/ks246-unfamiliar-schema/";
const args = ["--kind-decisions", fixture + "kind-decisions-v1.json", "--business-semantics", fixture + "business-semantics-v1.json", "--source-revision", "synthetic-unfamiliar-source-v1"];
function invoke(extra = []) {
  const root = mkdtempSync(join(tmpdir(), "ks247-paired-read-"));
  try {
    const answers = join(root, "answers.txt");
    writeFileSync(answers, ["synth_x.pay_feed.pf_id", "synth_x.pay_feed.val_dt", "MINOR_UNITS", "synth_x.pay_feed.amt_a", "EUR", "R", "V"].join("\n") + "\n");
    const run = spawnSync(process.execPath, ["scripts/run-result-lineage-journey.mjs", "--answers", answers, ...args, ...extra], { cwd: process.cwd(), encoding: "utf8" });
    assert.equal(run.status, 0, run.stderr);
    const boundary = extra.includes("--format") ? run.stdout.lastIndexOf("\n{") : -1;
    return JSON.parse(boundary < 0 ? run.stdout : run.stdout.slice(boundary + 1));
  } finally { rmSync(root, { recursive: true, force: true }); }
}
test("existing SQL entry point stays unpaired by default", () => {
  const out = invoke();
  assert.equal(out.verification.verifiedNumberCount, 24);
  assert.equal(out.pairedRead, undefined);
});
test("paired request cannot silently ignore write flags or missing checkout", () => {
  for (const extra of [["--producer-checkout"], ["--producer-checkout", process.cwd(), "--write", "true"]]) {
    const out = invoke(extra);
    assert.equal(out.journeyDenial.message, "KS247_PAIRED_CLI_SCOPE_DENIED");
    assert.equal(out.executed, false);
  }
});
test("a wrong local producer checkout is denied, never silently used", () => {
  const out = invoke(["--producer-checkout", process.cwd()]);
  assert.equal(out.journeyDenial.message, "KS247_PRODUCER_IDENTITY_DENIED");
  assert.equal(out.executed, false);
  assert.equal(out.verification.verifiedNumberCount, 0);
});
if (producer) {
  test("a subdirectory cannot inherit producer Git identity", () => {
    const out = invoke(["--producer-checkout", join(producer, "src")]);
    assert.equal(out.journeyDenial.message, "KS247_PRODUCER_IDENTITY_DENIED");
    assert.equal(out.executed, false);
  });
  test("pinned public producer through existing resolver and actual SQL", () => {
    const pglite = process.env.KS247_PGLITE_PATH;
    assert.ok(pglite, "explicit isolated runtime required for paired SQL leg");
    const out = invoke(["--producer-checkout", producer, "--pglite", pglite]);
    assert.equal(out.pairedRead.status, "READ_COMPLETE");
    assert.equal(out.pairedRead.effectStatus, "NO_EFFECT_AUTHORIZED");
    assert.equal(out.lineage.verification.effectJournal, "NOT_INVENTED_READ_ONLY_JOURNEY");
    assert.equal(out.lineage.verification.verifiedNumberCount, 24);
    assert.equal(out.lineage.verification.evidence.sourceByteSha256, out.pairedRead.task.sourceSha256);
  });
  test("TABLE and HTML machine receipts retain paired source, status and effect truth", () => {
    for (const format of ["TABLE", "HTML"]) {
      const out = invoke(["--producer-checkout", producer, "--pglite", process.env.KS247_PGLITE_PATH, "--format", format]);
      assert.equal(out.sourceMode, "REAL_POSTGRESQL");
      assert.equal(out.sharedReadPurposeBinding, "EXECUTED_LOCAL_SYNTHETIC");
      assert.equal(out.pairedRead.status, "READ_COMPLETE");
      assert.equal(out.pairedRead.effectStatus, "NO_EFFECT_AUTHORIZED");
      assert.equal(out.pairedRead.task.sourceRevision, "synthetic-unfamiliar-source-v1");
    }
  });
  test("paired mode requires an explicitly pinned SQL runtime", () => {
    const out = invoke(["--producer-checkout", producer]);
    assert.equal(out.journeyDenial.message, "KS247_PAIRED_SQL_RUNTIME_REQUIRED_DENIED");
    assert.equal(out.executed, false);
  });
  test("resealed source drift denies before local SQL, no verified number", () => {
    const root = mkdtempSync(join(tmpdir(), "ks247-wrong-source-"));
    try {
      const changed = join(root, "changed.json");
      const source = JSON.parse(readFileSync(fixture + "source-pay-feed-v1.json", "utf8"));
      source.rows[0].amt_a = 999999;
      writeFileSync(changed, JSON.stringify(source));
      const out = invoke(["--producer-checkout", producer, "--source", changed]);
      assert.equal(out.journeyDenial.message, "KS247_PRODUCER_SOURCE_SCOPE_DENIED");
      assert.equal(out.executed, false);
      assert.equal(out.verification.verifiedNumberCount, 0);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
  test("attempted write intent remains outside paired read scope", () => {
    const out = invoke(["--producer-checkout", producer, "--pglite", process.env.KS247_PGLITE_PATH, "--goal", "CREATE_IF_ABSENT"]);
    assert.equal(out.journeyDenial.code, "KS246_JOURNEY_DENIED:INCOMPATIBLE_SEMANTIC_GOAL");
    assert.equal(out.executed, false);
  });
}
