#!/usr/bin/env node
// Public operator entry: approved aggregate bytes only; no raw-source/SQL/Oracle option.
import { openSync, closeSync, fstatSync, readSync, realpathSync, constants } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { runAggregateCandidate } from '../services/bi-control/src/business-bi/permitted-aggregate-sandbox.mjs';
import { validateAggregateProfile } from '../services/bi-control/src/business-bi/permitted-aggregate-candidate.mjs';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
function readBoundedRegular(file) {
  let fd;
  try {
    if (!constants.O_NOFOLLOW || !constants.O_NONBLOCK || realpathSync(file) !== resolve(file)) throw new Error();
    fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const before = fstatSync(fd);
    if (!before.isFile() || before.size > 16384) throw new Error();
    const buffer = Buffer.alloc(16385);
    const length = readSync(fd, buffer, 0, buffer.length, null);
    const after = fstatSync(fd);
    if (length > 16384 || after.size > 16384 || before.dev !== after.dev || before.ino !== after.ino) throw new Error();
    return buffer.subarray(0, length);
  } catch { throw new Error('K01_INPUT_DENIED'); }
  finally { if (fd !== undefined) closeSync(fd); }
}
try {
  const { values } = parseArgs({ options: { input: { type: 'string' },
    'access-mode': { type: 'string', default: 'PERMITTED_AGGREGATES' } }, strict: true, allowPositionals: false });
  // Check the requested capability before opening even the aggregate input.
  if (values['access-mode'] !== 'PERMITTED_AGGREGATES') throw new Error('K01_PROFILE_DENIED');
  const payload = validateAggregateProfile(JSON.parse(readBoundedRegular(values.input)));
  const result = runAggregateCandidate(root, payload);
  process.stdout.write(JSON.stringify(result) + '\n');
} catch (error) {
  const reasonCode = ['K01_PROFILE_DENIED', 'K01_SOURCE_DENIED', 'K01_APPROVED_PACKAGE_DENIED', 'K01_INPUT_DENIED'].includes(error?.message) ? error.message : 'K01_ENTRY_DENIED';
  process.stdout.write(JSON.stringify({ outcome: 'DENIED', reasonCode, numbers: null }) + '\n');
  process.exitCode = 1;
}
