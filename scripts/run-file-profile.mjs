#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { dirname,resolve } from 'node:path';
import { runDuckdbFileProfile } from '../services/bi-control/src/db-analyzer/duckdb-file-workflow.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
try {
  const {values}=parseArgs({options:{source:{type:'string'},question:{type:'string'},export:{type:'string'},mode:{type:'string',default:'FULL_READ_ONLY'},'runtime-root':{type:'string',default:resolve(root,'.ks-file-runtime')}},strict:true,allowPositionals:false});
  const result=runDuckdbFileProfile({root,runtimeRoot:values['runtime-root'],source:values.source,question:values.question,exportPath:values.export,mode:values.mode});
  process.stdout.write(JSON.stringify(result)+'\n');
} catch (error) {
  const reasonCode=typeof error?.message==='string'&&/^K02_[A-Z_]+$/.test(error.message)?error.message:'K02_ENTRY_DENIED';
  const diagnostics={
    K02_SCOPE_DENIED:'Datei oder Berechnung ist für dieses Dateiprofil nicht freigegeben. Kein Teilergebnis.',
    K02_RIGHTS_DENIED:'Die angeforderte Fähigkeit ist nicht freigegeben; Quellen-Schreibzugriff wird nicht ausgeführt. Kein Teilergebnis.',
    K02_FILE_DENIED:'Datei ist nicht regulär, wurde über einen Link adressiert oder überschreitet das Eingabebudget. Kein Teilergebnis.',
    K02_SOURCE_IDENTITY_DRIFT:'Die Dateibytes stimmen nicht mit der festen Quellenfreigabe überein. Freigabe und Datei müssen unabhängig erneut gebunden werden. Kein Teilergebnis.',
    K02_RUNTIME_IDENTITY_DENIED:'DuckDB-Laufzeit entspricht nicht den fest gebundenen Versionen und Bytes. Kein Teilergebnis.',
    K02_SCHEMA_DENIED:'Dateitypen oder Spalten entsprechen nicht der freigegebenen Bindung category: VARCHAR und units: BIGINT. Kein Teilergebnis.',
    K02_ROW_BUDGET_DENIED:'Die Datei überschreitet 10000 Quellzeilen oder das Ergebnis überschreitet 100 Gruppen. Bitte den freigegebenen Umfang verkleinern. Kein Teilergebnis.',
    K02_ENGINE_IDENTITY_DENIED:'Die ausführende DuckDB-Engine meldet nicht die fest gebundene Version. Kein Teilergebnis.',
    K02_EXECUTOR_DENIED:'Der isolierte Dateiexecutor wurde verweigert, beendet oder hat die zulässige Auswertung nicht vollständig geliefert. Datei und Ausführungsbudget prüfen. Kein Teilergebnis.',
    K02_ENTRY_DENIED:'Parameter, Datei oder Exportziel ist nicht freigegeben oder nicht verfügbar. Es wird weder überschrieben noch ein Teilergebnis behauptet.',
  };
  process.stdout.write(JSON.stringify({outcome:'DENIED',reasonCode,diagnostic:diagnostics[reasonCode]??diagnostics.K02_ENTRY_DENIED,table:null,export:null,partialSuccess:false})+'\n');process.exitCode=1;
}
