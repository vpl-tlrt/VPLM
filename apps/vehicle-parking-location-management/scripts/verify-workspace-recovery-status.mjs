import assert from 'node:assert/strict';
import { build } from 'esbuild';

const built = await build({
  entryPoints: ['src/lib/workspace-recovery-status.ts'],
  bundle: true, platform: 'node', format: 'esm', write: false,
});
const source = Buffer.from(built.outputFiles[0].contents).toString('base64');
const { workspaceContentMatches, readRecoverySnapshot, recoveryFingerprint, preserveWorkspaceRecoveryCopy } =
  await import(`data:text/javascript;base64,${source}`);

const keys = ['vehicle-parking-browser-state-v2', 'vplm-bay-management-v1', 'vplm-road-tests-v2',
  'vplm-road-test-audit-v2', 'vplm-road-test-notifications-v2', 'vplm-garage-layout-v1', 'vplm-vehicle-models-v1'];
const state = (pendingChanges, savedAt, color = 'White') => JSON.stringify({
  vehicles: [{ id: 'v1', plateNumber: '938848', currentLocationId: 'A-01', color }],
  locations: [{ id: 'A-01', status: 'Occupied' }],
  movements: [{ id: 'm1', vehicleId: 'v1' }], reservations: [], auditEvents: [],
  pendingChanges, savedAt,
});
const workspace = (p, stamp, color) => Object.fromEntries(keys.map(key =>
  [key, key === 'vehicle-parking-browser-state-v2' ? state(p, stamp, color)
    : key === 'vplm-bay-management-v1' ? JSON.stringify({ reservations: [{ id: 'r1' }] }) : '[]']));
const cloud = workspace(0, 'today');
assert(workspaceContentMatches(workspace(19, 'yesterday'), cloud));
assert(!workspaceContentMatches(workspace(19, 'yesterday', 'Blue'), cloud));
const missingReservation = workspace(19, 'yesterday');
missingReservation['vplm-bay-management-v1'] = '{"reservations":[]}';
assert(!workspaceContentMatches(missingReservation, cloud));
const missingAudit = workspace(19, 'yesterday');
missingAudit['vplm-road-test-audit-v2'] = '[{"id":"a1"}]';
assert(!workspaceContentMatches(missingAudit, cloud));
assert.equal(workspaceContentMatches(null, cloud), false);
assert.equal(readRecoverySnapshot('{malformed'), null);
assert.deepEqual(readRecoverySnapshot(JSON.stringify(cloud)), cloud);
assert.notEqual(recoveryFingerprint(JSON.stringify(cloud)), recoveryFingerprint(JSON.stringify(missingReservation)));

const data = new Map();
globalThis.window = { localStorage: {
  getItem: (key) => data.has(key) ? data.get(key) : null,
  setItem: (key, value) => { data.set(key, value); },
}};
assert(preserveWorkspaceRecoveryCopy('test-user', cloud));
const first = data.get('vplm-unsynced-recovery:test-user');
const edited = workspace(3, 'another-day', 'Blue');
assert(preserveWorkspaceRecoveryCopy('test-user', edited));
const second = data.get('vplm-unsynced-recovery:test-user');
assert.notEqual(second, first);
assert.equal(data.get(`vplm-unsynced-recovery-archive:test-user:${recoveryFingerprint(first)}`), first);
assert(preserveWorkspaceRecoveryCopy('test-user', edited));
assert.equal(data.get('vplm-unsynced-recovery:test-user'), second);
console.log('PASS: identical recovery despite bookkeeping timestamps; vehicle/bay/audit conflicts detected; malformed backup rejected; older drafts archived before replacement');
