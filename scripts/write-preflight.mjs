import { timestamp } from '../src/time.mjs';
import { writeReport } from '../src/artifacts.mjs';
import { T830, redact } from '../src/t830.mjs';
import { writes, readByKey } from '../src/catalog.mjs';
import { writeProfiles, takeSnapshot } from '../src/write-profiles.mjs';
const device = new T830({ ...process.env, T830_ENABLE_WRITES: '0' });
const report = {
  at: timestamp(),
  mode: 'live-read-only-write-preflight',
  realWrites: 0,
  records: [],
};
try {
  for (const def of writes) {
    const profile = writeProfiles[def.key];
    let raw;
    const record = { section: def.key, readback: profile.readback, basis: profile.basis };
    try {
      const result = await device.run(
        readByKey[profile.readback],
        {},
        {
          captureRaw: (value) => {
            raw = value;
          },
        },
      );
      const snapshot = takeSnapshot(profile, profile.fields(def.sample), raw, def.sample);
      record.read = {
        status: result.status,
        values: snapshot.values,
        unavailable: snapshot.unavailable,
        warnings: result.warnings,
      };
      record.baselineAvailable =
        snapshot.unavailable.filter((name) => !/(wpapsk|password)/i.test(name)).length ===
        0;
    } catch (e) {
      record.read = { status: 'error', error: e.message, details: e.details };
      record.baselineAvailable = false;
    }
    if (def.transport === 'ubus') {
      try {
        record.writePermission = await device.rpc('session', 'access', {
          scope: 'ubus',
          object: def.service,
          function: def.method,
        });
      } catch (e) {
        record.writePermission = {
          status: 'error',
          error: e.message,
          details: e.details,
        };
      }
    } else
      record.writePermission = {
        status: 'not_applicable',
        note: 'UBUS access 不检查 CGI 路径权限。',
      };
    report.records.push(redact(record));
    console.log(JSON.stringify(redact(record)));
  }
} finally {
  await writeReport(
    'live/write-preflight-results.json',
    JSON.stringify(redact(report), null, 2),
  );
  await device.close();
}
