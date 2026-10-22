import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { redact } from '../src/t830.mjs';

if (!process.argv.includes('--apply')) throw new Error('Use --apply to test the existing session and restore UPnP');
const connection = JSON.parse(await readFile(new URL('../.media-state/connection.json', import.meta.url), 'utf8'));
const directory = new URL('../reports/live/systematic-writes-2026-10-20/', import.meta.url);
await mkdir(directory, { recursive: true });
const report = { at: new Date().toISOString(), mode: 'existing-session-live', records: [], restored: false };
const save = () => writeFile(new URL('session-upnp.json', directory), JSON.stringify(redact(report), null, 2));
async function request(action, body) {
  const response = await fetch(connection.url + '/api/dashboard/' + action, {
    method: 'POST', headers: { Authorization: 'Bearer ' + connection.token, 'Content-Type': 'application/json' },
    body: JSON.stringify(body), signal: AbortSignal.timeout(30000),
  });
  const output = await response.json();
  report.records.push({ action, body, http: response.status, output });
  await save();
  return output;
}
let attempted = false;
try {
  const baseline = await request('snapshot', { refresh: true });
  if (!baseline.writeEnabled || !['0', '1'].includes(baseline.upnp)) throw new Error('BASELINE_UNAVAILABLE');
  report.original = baseline.upnp;
  report.target = baseline.upnp === '0' ? '1' : '0';
  const stale = await request('prepare', { value: report.target, expected: report.target });
  report.staleBaselineRejected = stale.status === 'error' && /CONFLICT/.test(stale.error);
  if (!report.staleBaselineRejected) throw new Error('STALE_BASELINE_NOT_REJECTED');
  const cancelled = await request('prepare', { value: report.target, expected: report.original });
  if (!cancelled.id) throw new Error('CANCEL_PROPOSAL_UNAVAILABLE');
  const cancel = await request('cancel', { id: cancelled.id });
  const afterCancel = await request('snapshot', { refresh: true });
  report.cancelVerified = cancel.status === 'cancelled' && afterCancel.upnp === report.original;
  if (!report.cancelVerified) throw new Error('CANCEL_NOT_VERIFIED');
  const proposal = await request('prepare', { value: report.target, expected: report.original });
  if (!proposal.id) throw new Error('PROPOSAL_UNAVAILABLE');
  attempted = true;
  const sent = await request('confirm', { id: proposal.id, confirmed: true });
  const after = await request('snapshot', { refresh: true });
  report.changedVerified = sent.status === 'verified' && sent.result?.submissionOutcome === 'acknowledged' && after.upnp === report.target;
} catch (error) {
  report.error = error.message;
  process.exitCode = 1;
} finally {
  if (attempted) {
    try {
      const current = await request('snapshot', { refresh: true });
      if (current.upnp === report.original) report.restored = true;
      else if (current.upnp === report.target) {
        const proposal = await request('prepare', { value: report.original, expected: report.target });
        if (!proposal.id) throw new Error('RESTORE_PROPOSAL_UNAVAILABLE');
        await request('confirm', { id: proposal.id, confirmed: true });
        const final = await request('snapshot', { refresh: true });
        report.restored = final.upnp === report.original;
      } else throw new Error('RESTORE_CONFLICT_OR_UNAVAILABLE');
    } catch (error) { report.restoreError = error.message; }
  }
  report.passed = !!report.changedVerified && report.restored && report.staleBaselineRejected && report.cancelVerified;
  if (!report.passed) process.exitCode = 1;
  await save();
  console.log(JSON.stringify({ passed: report.passed, changedVerified: report.changedVerified, restored: report.restored, staleBaselineRejected: report.staleBaselineRejected, cancelVerified: report.cancelVerified, error: report.error, restoreError: report.restoreError }));
}
