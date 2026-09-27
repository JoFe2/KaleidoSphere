import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { qualifyPairedReadLineage } from "../services/bi-control/src/business-bi/paired-read-lineage-qualification-v1.mjs";
const producer = process.env.KS247_PRODUCER_CHECKOUT;
const fixture = "tests/fixtures/business-bi/ks246-unfamiliar-schema/";
const args = ["--kind-decisions", fixture + "kind-decisions-v1.json", "--business-semantics", fixture + "business-semantics-v1.json", "--source-revision", "synthetic-unfamiliar-source-v1"];
function invoke(extra = []) {
  const root = mkdtempSync(join(tmpdir(), "ks247-paired-read-"));
  try {
    const answers = join(root, "answers.txt");
    writeFileSync(answers, ["synth_x.pay_feed.pf_id", "synth_x.pay_feed.val_dt", "MINOR_UNITS", "synth_x.pay_feed.amt_a", "EUR", "R", "V"].join("\n") + "\n");
    const suppliedDecision = extra.indexOf("--kind-decisions");
    const baseArgs = [...args];
    const additions = [...extra];
    if (suppliedDecision !== -1) {
      baseArgs[baseArgs.indexOf("--kind-decisions") + 1] = additions[suppliedDecision + 1];
      additions.splice(suppliedDecision, 2);
    }
    const run = spawnSync(process.execPath, ["scripts/run-result-lineage-journey.mjs", "--answers", answers, ...baseArgs, ...additions], { cwd: process.cwd(), encoding: "utf8" });
    assert.equal(run.status, 0, run.stderr);
    const boundary = extra.includes("--format") ? run.stdout.lastIndexOf("\n{") : -1;
    return JSON.parse(boundary < 0 ? run.stdout : run.stdout.slice(boundary + 1));
  } finally { rmSync(root, { recursive: true, force: true }); }
}
test("existing SQL entry point stays unpaired by default", () => {
  const out = invoke();
  assert.equal(out.verification.verifiedNumberCount, 24);
  assert.equal(out.pairedRead, undefined);
  assert.equal(out.pairedQualification, undefined);
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
    assert.equal(out.pairedQualification.status, "VERIFIED_LOCAL_SYNTHETIC_READ_ONLY");
    assert.equal(out.pairedQualification.lineageSha256, out.lineage.lineageSha256);
    assert.equal(out.pairedQualification.verifiedNumberCount, 24);
    assert.equal(out.pairedQualification.mutationAuthority, false);
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
      assert.equal(out.pairedQualification.status, "VERIFIED_LOCAL_SYNTHETIC_READ_ONLY");
      assert.equal(out.pairedQualification.lineageSha256, out.lineageSha256);
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

if (producer) {
  test("paired verifier rejects substituted producer task and false completion/effect claims", () => {
    const out = invoke(["--producer-checkout", producer, "--pglite", process.env.KS247_PGLITE_PATH]);
    const contractSha256 = createHash("sha256").update(readFileSync("contracts/business-bi/v1/net-revenue.metric.json")).digest("hex");
    const original = { pairedRead: out.pairedRead, lineage: out.lineage,
      producerSha: out.pairedRead.producerSha, contractSha256 };
    assert.equal(qualifyPairedReadLineage(original).verifiedNumberCount, 24);
    const refuse = (change, code) => {
      const copy = structuredClone(original);
      change(copy);
      assert.throws(() => qualifyPairedReadLineage(copy), { code: `KS247_PAIRED_LINEAGE_DENIED:${code}` });
    };
    refuse((v) => { v.pairedRead.task.period.current.end = "2026-07-30"; }, "TASK_RESULT_BINDING_MISMATCH");
    refuse((v) => { v.pairedRead.task.units = "EUR_MAJOR_UNITS"; }, "TASK_RESULT_BINDING_MISMATCH");
    refuse((v) => { v.pairedRead.task.sourceSha256 = "0".repeat(64); }, "TASK_RESULT_BINDING_MISMATCH");
    refuse((v) => { v.pairedRead.task.contractSha256 = "1".repeat(64); }, "TASK_RESULT_BINDING_MISMATCH");
    refuse((v) => { v.pairedRead.effectStatus = "EFFECT_CONFIRMED"; }, "PRODUCER_READ_NOT_QUALIFIED");
    refuse((v) => { v.lineage.sections.completion.complete = false; }, "LINEAGE_NOT_READ_ONLY_VERIFIED");
    refuse((v) => { v.lineage.verification.verifiedNumberCount = 0; }, "LINEAGE_NOT_READ_ONLY_VERIFIED");
  });
  test("actual paired CLI refuses wrong period, unit, stale source and unsupported completion/causal promotion", () => {
    const root = mkdtempSync(join(tmpdir(), "ks247-paired-negatives-"));
    const original = JSON.parse(readFileSync("tests/fixtures/business-bi/ks247-result-lineage/independent-expectation-v1.json", "utf8"));
    const check = (name, document, flag, code) => {
      const file = join(root, name + ".json");
      writeFileSync(file, JSON.stringify(document));
      const out = invoke(["--producer-checkout", producer, "--pglite", process.env.KS247_PGLITE_PATH, flag, file]);
      assert.equal(out.journeyDenial.code, code, name);
      assert.equal(out.verification.verifiedNumberCount, 0, name);
      assert.equal(out.pairedQualification, undefined, name);
      assert.equal(out.observedCompletion.complete, true, name);
    };
    try {
      const period = structuredClone(original); period.periods.current.end = "2026-07-30";
      check("period", period, "--expectation", "KS247_LINEAGE_DENIED:WRONG_PERIOD");
      const unit = structuredClone(original); unit.unit = { ...unit.unit, currency: "CHF", id: "CHF_MINOR_UNITS" };
      check("unit", unit, "--expectation", "KS247_LINEAGE_DENIED:WRONG_UNIT");
      const stale = { schemaVersion: "kaleidosphere.business-bi/result-lineage-evidence-claim/v1",
        issue: "KS-EVO-02", sourceRevision: original.current.sourceRevision,
        sourceByteSha256: original.supersededEvidence[0].evidenceSha256,
        canonicalHoldoutSha256: original.current.canonicalHoldoutSha256,
        resultSha256: "0".repeat(64) };
      check("stale", stale, "--evidence-claim", "KS247_LINEAGE_DENIED:STALE_EVIDENCE");
      const explanations = { schemaVersion: "kaleidosphere.business-bi/result-lineage-explanation/v1",
        issue: "KS-EVO-02", assertions: [{ assertionId: "c", kind: "COMPLETION",
          text: "all work complete", assertedAsVerified: true }] };
      check("completion", explanations, "--explanation", "KS247_LINEAGE_DENIED:UNSUPPORTED_COMPLETION_ASSERTION");
      explanations.assertions[0] = { assertionId: "c", kind: "CAUSAL",
        text: "cause established", assertedAsVerified: true };
      check("causal", explanations, "--explanation", "KS247_LINEAGE_DENIED:UNSUPPORTED_CAUSAL_ASSERTION");
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
}

if (producer) {
  test("KS246 accepted proposal cannot silently override caller decisions in the paired producer journey", () => {
    const root = mkdtempSync(join(tmpdir(), "ks246-paired-decisions-"));
    try {
      const decisions = JSON.parse(readFileSync(fixture + "kind-decisions-v1.json", "utf8"));
      decisions.decisions.R = "sale"; // conflicts with caller-confirmed credit answer
      const file = join(root, "contradictory-decisions.json");
      writeFileSync(file, JSON.stringify(decisions));
      const out = invoke(["--producer-checkout", producer, "--pglite", process.env.KS247_PGLITE_PATH,
        "--kind-decisions", file]);
      assert.equal(out.journeyDenial.code, "KS246_JOURNEY_DENIED:KIND_DECISION_CONFLICT:credit");
      assert.equal(out.executed, false);
      assert.equal(out.verification.verifiedNumberCount, 0);
      assert.equal(out.pairedQualification, undefined);
      // Counterpart: unchanged authored decisions reach the released producer and SQL read.
      const accepted = invoke(["--producer-checkout", producer, "--pglite", process.env.KS247_PGLITE_PATH]);
      assert.equal(accepted.pairedRead.status, "READ_COMPLETE");
      assert.equal(accepted.pairedQualification.verifiedNumberCount, 24);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
}

// KS247 second frozen source: this independent SQLite fold precedes the producer-bound read.
const second="tests/fixtures/business-bi/ks247-second-source/";
const secondSource=readFileSync(second+"source-pay-feed-v2.json");
const secondDecision=JSON.parse(readFileSync(second+"kind-decisions-v2.json"));
const secondExpectation=JSON.parse(readFileSync(second+"independent-expectation-v2.json"));
test("second public synthetic source and explicit W decision have an independently folded 24-number expectation",()=>{
 const source=JSON.parse(secondSource);
 assert.equal(createHash("sha256").update(secondSource).digest("hex"),"cacd2a08d5fa5cb8603513a769362a2f7bdb700c44d700728a1fe2f1244be52e");
 assert.equal(secondExpectation.current.sourceByteSha256,"cacd2a08d5fa5cb8603513a769362a2f7bdb700c44d700728a1fe2f1244be52e");
 assert.equal(secondDecision.sourceRevision,source.sourceRevision);
 assert.equal(secondDecision.decisions.W,"unknown");assert.equal(Object.hasOwn(secondDecision.decisions,"U"),false);
 assert.equal(source.rows.filter(row=>row.ev_typ==="W").length,2);
 const db=new DatabaseSync(":memory:");try{
  db.exec("CREATE TABLE source(order_id TEXT PRIMARY KEY,order_date TEXT,record_kind TEXT,amount INTEGER)");
  const add=db.prepare("INSERT INTO source VALUES (?,?,?,?)");
  for(const row of source.rows)add.run(row.pf_id,row.val_dt,secondDecision.decisions[row.ev_typ],row.amt_a);
  const observed={};
  for(const [period,start,end] of [["comparison","2026-06-01","2026-06-30"],["current","2026-07-01","2026-07-31"]]){
   const r=db.prepare("SELECT count(*) AS n,sum(CASE WHEN record_kind='sale' THEN coalesce(amount,0) ELSE 0 END) AS sale,sum(CASE WHEN record_kind='credit' THEN coalesce(amount,0) ELSE 0 END) AS credit,sum(CASE WHEN record_kind='cancel' THEN 1 ELSE 0 END) AS cancelled,sum(CASE WHEN record_kind='unknown' OR amount IS NULL THEN 1 ELSE 0 END) AS unknown,sum(CASE WHEN (record_kind='unknown' OR amount IS NULL) AND amount IS NOT NULL THEN amount ELSE 0 END) AS quantified,sum(CASE WHEN (record_kind='unknown' OR amount IS NULL) AND amount IS NULL THEN 1 ELSE 0 END) AS unquantified FROM source WHERE order_date BETWEEN ? AND ?").get(start,end);
   const k="periods."+period+".";Object.assign(observed,{[k+"netMinorUnits"]:r.sale-r.credit,[k+"saleMinorUnits"]:r.sale,[k+"creditMinorUnits"]:r.credit,[k+"cancelCount"]:r.cancelled,[k+"rowCount"]:r.n,[k+"unknown.count"]:r.unknown,[k+"unknown.quantifiedAmountMinorUnits"]:r.quantified,[k+"unknown.unquantifiedCount"]:r.unquantified});
  }
  observed.deltaMinorUnits=observed["periods.current.netMinorUnits"]-observed["periods.comparison.netMinorUnits"];
  observed.excludedOutOfScopeCount=db.prepare("SELECT count(*) AS n FROM source WHERE order_date < ? OR order_date > ?").get("2026-06-01","2026-07-31").n;
  const unknown=db.prepare("SELECT count(*) AS n,sum(CASE WHEN amount IS NOT NULL THEN amount ELSE 0 END) AS quantified,sum(CASE WHEN amount IS NULL THEN 1 ELSE 0 END) AS unquantified FROM source WHERE record_kind='unknown' OR amount IS NULL OR order_date IS NULL").get();
  Object.assign(observed,{"unknown.count":unknown.n,"unknown.quantifiedAmountMinorUnits":unknown.quantified,"unknown.unquantifiedCount":unknown.unquantified});
  const unassigned=db.prepare("SELECT count(*) AS n,sum(coalesce(amount,0)) AS quantified,sum(CASE WHEN amount IS NULL THEN 1 ELSE 0 END) AS unquantified FROM source WHERE order_date IS NULL").get();
  Object.assign(observed,{"unknown.unassigned.count":unassigned.n,"unknown.unassigned.quantifiedAmountMinorUnits":unassigned.quantified,"unknown.unassigned.unquantifiedCount":unassigned.unquantified});
  assert.equal(Object.keys(observed).length,24);assert.deepEqual(observed,secondExpectation.expectedNumbers);
 }finally{db.close();}
});
const secondProducer=process.env.KS247_V2_PRODUCER_CHECKOUT;
if(!secondProducer)test("second producer-bound PGlite read needs exact local candidate",t=>t.skip("KS247_V2_PRODUCER_CHECKOUT not supplied"));
else test("second actual paired SQL read verifies 24 numbers; substitutions and unsupported authority stay unverified",()=>{
 const runtime=process.env.KS247_PGLITE_PATH;
 assert.ok(runtime,"explicit pinned runtime needed");
 const scratch=mkdtempSync(join(tmpdir(),"ks247-second-"));
 const answers=join(scratch,"answers.txt");writeFileSync(answers,["synth_x.pay_feed.pf_id","synth_x.pay_feed.val_dt","MINOR_UNITS","synth_x.pay_feed.amt_a","EUR","R","V"].join("\n")+"\n");
 const choices={"--source":second+"source-pay-feed-v2.json","--kind-decisions":second+"kind-decisions-v2.json","--business-semantics":second+"business-semantics-v2.json","--source-revision":"synthetic-unfamiliar-source-v2","--expectation":second+"independent-expectation-v2.json","--source-variant":"v2","--producer-checkout":secondProducer,"--pglite":runtime};
 const invokeSecond=(over={})=>{
  const args=["scripts/run-result-lineage-journey.mjs","--answers",answers,...Object.entries({...choices,...over}).flat()];
  const out=spawnSync(process.execPath,args,{cwd:process.cwd(),encoding:"utf8",timeout:45000});
  assert.equal(out.status,0,out.stderr+out.stdout.slice(0,500));return JSON.parse(out.stdout);
 };
 try{
  const good=invokeSecond();assert.equal(good.pairedRead.status,"READ_COMPLETE");
  assert.equal(good.pairedRead.effectStatus,"NO_EFFECT_AUTHORIZED");
  assert.equal(good.pairedRead.task.sourceSha256,secondExpectation.current.sourceByteSha256);
  assert.equal(good.pairedQualification.status,"VERIFIED_LOCAL_SYNTHETIC_READ_ONLY");
  assert.equal(good.pairedQualification.externalSourceAuthority,"NOT_GRANTED");
  assert.equal(good.lineage.verification.verifiedNumberCount,24);
  assert.equal(good.lineage.verification.effectJournal,"NOT_INVENTED_READ_ONLY_JOURNEY");
  assert.equal(good.lineage.authority.publicationAuthority,"NONE");
  const deny=(caseName,over,code,afterRead=false)=>{const out=invokeSecond(over);assert.equal(out.journeyDenial?.message,code,caseName);assert.equal(out.pairedQualification,undefined,caseName);assert.equal(out.verification.verifiedNumberCount,0,caseName);assert.equal(out.executed,afterRead,caseName);};
  const write=(name,obj)=>{const path=join(scratch,name+".json");writeFileSync(path,JSON.stringify(obj));return path;};
  const changed=JSON.parse(secondSource);changed.rows[0].amt_a+=1;
  deny("one-cent source substitution",{"--source":write("one-cent",changed)},"KS247_PRODUCER_SOURCE_SCOPE_DENIED");
  const decisions=structuredClone(secondDecision);decisions.decisions.W="sale";
  deny("unsupported residual rule",{"--kind-decisions":write("wrong-rule",decisions)},"KS246_JOURNEY_DENIED:SOURCE_NOT_COHERENT_WITH_RELEASED_HOLDOUT");
  const period=structuredClone(secondExpectation);period.periods.current.end="2026-07-30";
  deny("wrong period",{"--expectation":write("wrong-period",period)},"KS247_LINEAGE_DENIED:WRONG_PERIOD",true);
  const unit=structuredClone(secondExpectation);unit.unit={...unit.unit,id:"CHF_MINOR_UNITS",currency:"CHF"};
  deny("wrong unit",{"--expectation":write("wrong-unit",unit)},"KS247_LINEAGE_DENIED:WRONG_UNIT",true);
  const number=structuredClone(secondExpectation);number.expectedNumbers["periods.comparison.netMinorUnits"]+=1;
  deny("wrong number",{"--expectation":write("wrong-number",number)},"KS247_LINEAGE_DENIED:WRONG_NUMBER",true);
  deny("stale expectation",{"--expectation":"tests/fixtures/business-bi/ks247-result-lineage/independent-expectation-v1.json"},"KS247_LINEAGE_DENIED:SOURCE_REVISION_STALE",true);
  deny("wrong producer head",{"--producer-checkout":process.cwd()},"KS247_PRODUCER_IDENTITY_DENIED");
  deny("wrong producer variant",{"--source-variant":"v1"},"KS247_PRODUCER_IDENTITY_DENIED");
  deny("unpaired v2",{"--producer-checkout":""},"KS247_PRODUCER_CHECKOUT_DENIED");
 }finally{rmSync(scratch,{recursive:true,force:true});}
});
