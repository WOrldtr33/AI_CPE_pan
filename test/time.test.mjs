import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, basename } from 'node:path';
import { timestamp, logTimeZone } from '../src/time.mjs';
import { createLog } from '../src/agent-log.mjs';

test('Los Angeles timestamps handle date rollover, winter and summer offsets', () => {
  assert.equal(timestamp(new Date('2026-10-12T07:41:04.153Z')), '2026-10-12T00:41:04.153-07:00');
  assert.equal(timestamp(new Date('2026-01-12T07:41:04.153Z')), '2026-01-11T23:41:04.153-08:00');
});

test('Los Angeles spring DST transition preserves the actual instant', () => {
  for (const [utc, local] of [
    ['2026-03-08T09:59:59.000Z', '2026-03-08T01:59:59.000-08:00'],
    ['2026-03-08T10:00:00.000Z', '2026-03-08T03:00:00.000-07:00'],
  ]) {
    assert.equal(timestamp(new Date(utc)), local);
    assert.equal(new Date(local).toISOString(), utc);
  }
});

test('New log filenames and event timestamps include the Los Angeles offset and zone', async () => {
  const directory = await mkdtemp(join(tmpdir(), 't830-log-time-'));
  try {
    const log = createLog(directory, value => value);
    log.event({ event: 'test' });
    const entry = JSON.parse(await readFile(log.path, 'utf8'));
    assert.equal(entry.timeZone, logTimeZone);
    assert.match(entry.at, /-0[78]:00$/);
    assert.match(basename(log.path), /-0[78]-00-/);
    assert(Math.abs(Date.now() - Date.parse(entry.at)) < 10000);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
