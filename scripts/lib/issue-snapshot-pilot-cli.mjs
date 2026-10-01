// Strict additive mode of the existing #250 pilot CLI. Reads only caller-named files;
// no network, credentials, writes, default fixtures or owner-authenticity inference.
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { analyzeIssueStateSnapshot, prepareIssueSnapshotReaderTask, verifyIssueStateSnapshot } from '../../services/bi-control/src/business-bi/issue-state-snapshot-metric.mjs';

export function runIssueSnapshotCli(args) {
  try {
    const seen = new Set();
    for (const arg of args.filter(a => a.startsWith('--'))) {
      const key = arg.split('=')[0];
      if (seen.has(key)) return { outcome: 'DENIED', code: 'KS250_ISSUE_SNAPSHOT_DENIED:CLI_INPUT' };
      seen.add(key);
    }
    const { values } = parseArgs({ args, strict: true, allowPositionals: false, options: {
      'issue-snapshot': { type: 'string' }, 'issue-permission': { type: 'string' },
      'issue-capture': { type: 'string' }, 'reader-task': { type: 'boolean' },
      verify: { type: 'boolean' }, binding: { type: 'string' },
    } });
    if (!values['issue-snapshot'] || !values['issue-permission'] || !values['issue-capture']
      || (values.verify && !values.binding)) return { outcome: 'DENIED', code: 'KS250_ISSUE_SNAPSHOT_DENIED:INPUT_REQUIRED' };
    if (values['reader-task'] && values.verify) return { outcome: 'DENIED', code: 'KS250_ISSUE_SNAPSHOT_DENIED:MODE_CONFLICT' };
    if (values.binding && !values.verify) return { outcome: 'DENIED', code: 'KS250_ISSUE_SNAPSHOT_DENIED:MODE_CONFLICT' };
    const inputs = {
      sourceBytes: readFileSync(values['issue-snapshot']),
      permission: JSON.parse(readFileSync(values['issue-permission'], 'utf8')),
      capture: JSON.parse(readFileSync(values['issue-capture'], 'utf8')),
    };
    if (values.verify) return verifyIssueStateSnapshot({ ...inputs, carried: JSON.parse(readFileSync(values.binding, 'utf8')) });
    return values['reader-task'] ? prepareIssueSnapshotReaderTask(inputs) : analyzeIssueStateSnapshot(inputs);
  } catch {
    // Do not echo file paths, contents, credential-looking fields or parser payloads.
    return { outcome: 'DENIED', code: 'KS250_ISSUE_SNAPSHOT_DENIED:CLI_INPUT' };
  }
}
