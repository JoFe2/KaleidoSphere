// XRA-KS-01 — real local service boundary for PANSPHAIRA projection ingestion.
// Standalone loopback HTTP service. The projection profile arrives only as a
// canonical JSON request body; no PANSPHAIRA module is imported and no dryRun
// bridge is used. Fails closed on every gate; binds the exact KaleidoSphere
// head and the held release registry at startup.

import { spawnSync } from 'node:child_process';
import http from 'node:http';
import path from 'node:path';
import { readFileSync } from 'node:fs';

import { buildEnvironmentIdentity } from './candidate.mjs';
import { ingestProjectionProfile, validateRegistry } from './pipeline.mjs';

const ROOT = path.resolve(import.meta.dirname, '..', '..', '..', '..');
const PROJECTION_CONTRACT_PATH = path.join(ROOT, 'contracts/pansphaira-analytics/v1/projection-profile.v1.json');
const ANALYSIS_CONTRACT_PATH = path.join(ROOT, 'contracts/pansphaira-analytics/v1/analysis.v1.json');
const RELEASE_REGISTRY_PATH = path.join(ROOT, 'contracts/pansphaira-analytics/v1/release-registry.v1.json');
const REQUEST_DEADLINE_MS = 1000;
const MAX_BODY_BYTES = 16384;

const port = Number(process.env.PORT ?? 18791);

function coded(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function gitHead(ref) {
  const result = spawnSync('git', ['rev-parse', ref], { cwd: ROOT, encoding: 'utf8' });
  if (result.status !== 0) throw coded('XRA_KS01_GIT_HEAD_UNRESOLVED');
  return result.stdout.trim();
}

const projectionContractBytes = readFileSync(PROJECTION_CONTRACT_PATH);
const analysisContractBytes = readFileSync(ANALYSIS_CONTRACT_PATH);
const registry = validateRegistry(JSON.parse(readFileSync(RELEASE_REGISTRY_PATH, 'utf8')));
const heads = { commitOid: gitHead('HEAD'), treeOid: gitHead('HEAD^{tree}') };
const { environment, environmentSha256 } = buildEnvironmentIdentity({
  nodeVersion: process.version,
  nodeModulesAbi: process.versions.modules,
  platform: process.platform,
  architecture: process.arch,
  canonicalJsonBytes: readFileSync(path.join(ROOT, 'services/bi-control/src/canonical-json.js')),
  packageBytes: readFileSync(path.join(ROOT, 'package.json')),
});
const context = {
  registry,
  heads,
  environment,
  environmentSha256,
  projectionContractBytes,
  analysisContractBytes,
};
const releasedEntryCount = registry.entries.filter((entry) => entry.status === 'RELEASED').length;

function send(response, status, value) {
  const body = `${JSON.stringify(value)}\n`;
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  response.end(body);
}

function deniedEnvelope(code, requestSha256) {
  return {
    status: 'DENIED',
    issue: 'XRA-KS-01',
    code,
    requestSha256,
    candidate: null,
    ordinaryAnswer: null,
    successfulOrdinaryAnswer: false,
  };
}

function readBoundedBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(coded('XRA_KS01_TIMEOUT_DENIED'));
    }, REQUEST_DEADLINE_MS);
    request.on('data', (chunk) => {
      if (settled) return;
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        settled = true;
        clearTimeout(timer);
        reject(coded('XRA_KS01_REQUEST_SIZE_DENIED'));
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(Buffer.concat(chunks));
    });
    request.on('error', () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(coded('XRA_KS01_TIMEOUT_DENIED'));
    });
  });
}

const server = http.createServer(async (request, response) => {
  try {
    if (request.method === 'GET' && request.url === '/healthz') {
      return send(response, 200, { status: 'ok', issue: 'XRA-KS-01' });
    }
    if (request.method === 'GET' && request.url === '/v1/pansphaira-analytics/heads') {
      return send(response, 200, {
        issue: 'XRA-KS-01',
        kaleidosphereHead: { commitOid: heads.commitOid, treeOid: heads.treeOid },
        releaseRegistry: {
          status: releasedEntryCount > 0 ? 'RELEASED' : 'HELD',
          entryCount: registry.entries.length,
          releasedEntryCount,
        },
      });
    }
    if (request.method === 'POST' && request.url === '/v1/pansphaira-analytics/projection') {
      let body;
      try {
        body = await readBoundedBody(request);
      } catch (error) {
        send(response, 400, deniedEnvelope(error.code ?? 'XRA_KS01_TIMEOUT_DENIED', null));
        response.on('finish', () => request.destroy());
        return;
      }
      const result = ingestProjectionProfile(body, context);
      if (result.state === 'CANDIDATE') {
        return send(response, 200, { status: 'CANDIDATE', issue: 'XRA-KS-01', requestSha256: result.requestSha256, candidate: result.candidate });
      }
      return send(response, 400, deniedEnvelope(result.code, result.requestSha256));
    }
    return send(response, 400, deniedEnvelope('XRA_KS01_ROUTE_DENIED', null));
  } catch (error) {
    const code = String(error?.code ?? 'XRA_KS01_INTERNAL_ERROR_DENIED').replace(/[^A-Z0-9_]/g, '_').slice(0, 128);
    try {
      send(response, 400, deniedEnvelope(code, null));
    } catch {
      response.destroy();
    }
  }
});

server.on('error', (error) => {
  console.error(`XRA_KS01_SERVICE_STARTUP_DENIED ${error.code ?? error.message}`);
  process.exit(1);
});
server.listen(port, '127.0.0.1', () => {
  console.log(`READY ${port}`);
});