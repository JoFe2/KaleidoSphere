#!/usr/bin/env node
// Metadata only: no source reads, credentials, rights, or registry promotion.
import { parseArgs } from 'node:util';
import { externalBiProviderProfileV1 } from '../services/bi-agent/src/external-api-v2.mjs';
try {
  parseArgs({options:{},strict:true,allowPositionals:false});
  process.stdout.write(JSON.stringify(externalBiProviderProfileV1())+'\n');
} catch {
  process.stdout.write(JSON.stringify({outcome:'DENIED',reasonCode:'J02_PROVIDER_INPUT_DENIED',partialSuccess:false})+'\n');
  process.exitCode=1;
}
