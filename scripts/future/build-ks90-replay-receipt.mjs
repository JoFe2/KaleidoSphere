#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import {
  ACCEPTED_DOCUMENT_HEAD_SHA,
  DISPOSITION,
  EXACT_BASE_SHA,
  ISSUE,
  PACKET,
  RECEIPT_PATH,
  RECEIPT_VERSION,
  canonicalSerialize,
  validateReceipt,
} from './ks90-replay-receipt-lib.mjs';


function parseArgs(argv) {
  const options = {
    base: EXACT_BASE_SHA,
    documentHead: ACCEPTED_DOCUMENT_HEAD_SHA,
    out: RECEIPT_PATH,
    check: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--base') options.base = argv[++i];
    else if (argv[i] === '--document-head') options.documentHead = argv[++i];
    else if (argv[i] === '--out') options.out = argv[++i];
    else if (argv[i] === '--check') options.check = true;
    else throw new Error(`unknown argument: ${argv[i]}`);
  }
  return options;
}

function sha256InCheckout(file) {
  const bytes = readFileSync(file);
  return createHash('sha256').update(bytes).digest('hex');
}

function verifyAcceptedChain(base, head) {
  if (base !== EXACT_BASE_SHA || head !== ACCEPTED_DOCUMENT_HEAD_SHA) {
    throw new Error('fail-closed: refs do not resolve to the accepted KS90 presentation base/document head');
  }
}

function buildReceipt(base, head) {
  const packet = PACKET.map((entry) => {
    const actual = sha256InCheckout(entry.path);
    if (actual !== entry.sha256) throw new Error(`fail-closed: authoritative byte digest mismatch for ${entry.path}`);
    return { ...entry };
  });
  return {
    receipt_version: RECEIPT_VERSION,
    status: DISPOSITION,
    presentation: {
      exact_base_sha: base,
      accepted_document_head_sha: head,
      issue: ISSUE,
      disposition: DISPOSITION,
    },
    packet,
    authority: {
      evidence_only: true,
      execution_permission_granted: false,
      signature_is_execution_authority: false,
      receipt_is_command_or_permission: false,
    },
    nonclaims: [
      'no implementation, integration, execution, release, or closure permission',
      'no claim of a later integration or closure commit',
      'no OAuth application, credential, signing key, endpoint, service, customer data, or runtime capability',
    ],
  };
}

try {
  const options = parseArgs(process.argv.slice(2));
  const base = options.base;
  const head = options.documentHead;
  verifyAcceptedChain(base, head);
  const receipt = buildReceipt(base, head);
  const context = {
    exactBaseSha: base,
    acceptedDocumentHeadSha: head,
    issue: ISSUE,
    disposition: DISPOSITION,
    packetDigests: Object.fromEntries(receipt.packet.map(({ path, sha256 }) => [path, sha256])),
  };
  const validation = validateReceipt(receipt, context);
  if (!validation.ok) throw new Error(`fail-closed: built receipt rejected: ${validation.failures.join(', ')}`);
  const output = canonicalSerialize(receipt);
  const outputPath = resolve(options.out);
  if (options.check) {
    if (readFileSync(outputPath, 'utf8') !== output) throw new Error(`fail-closed: ${options.out} is not byte-identical`);
    console.log(`check: OK (byte-identical ${options.out})`);
  } else {
    mkdirSync(dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, output);
    console.log(`wrote ${options.out}`);
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
