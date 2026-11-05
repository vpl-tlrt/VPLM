import assert from 'node:assert/strict';
import { build } from 'esbuild';

const built = await build({
  entryPoints: ['src/lib/workspace-recovery.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
});
const source = Buffer.from(built.outputFiles[0].contents).toString('base64');
const { mergeWorkspaceChanges } = await import(`data:text/javascript;base64,${source}`);

const vehicle = (id, plateNumber, currentLocationId, xParking = 'No') =>
  ({ id, plateNumber, currentLocationId, xParking, status: 'Assigned', model: 'Corolla', color: 'White' });
const locations = ['A1', 'A2', 'A3'].map(id => ({ id, capacity: 1, lane: 'Main' }));
const initialState = { vehicles: [vehicle('v1','ABC1','A1')], locations, movements: [], reservations: [], auditEvents: [] };
const snapshot = data => ({ 'vehicle-parking-browser-state-v2': JSON.stringify(data) });
const edit = (state, action) => { const next = structuredClone(state); action(next); return snapshot(next); };
const run = (local, cloud) => JSON.parse(mergeWorkspaceChanges(snapshot(initialState),local,cloud)['vehicle-parking-browser-state-v2']);

const localProfile = edit(initialState, s => { s.vehicles[0].color = 'Blue'; });
const cloudProfile = edit(initialState, s => { s.vehicles[0].model = 'Camry'; });
const mergedProfile = run(localProfile,cloudProfile);
assert.equal(mergedProfile.vehicles[0].color,'Blue');
assert.equal(mergedProfile.vehicles[0].model,'Camry');

const localMove = edit(initialState, s => { s.vehicles[0].currentLocationId = 'A2'; });
const cloudMove = edit(initialState, s => { s.vehicles[0].currentLocationId = 'A3'; });
assert.throws(() => run(localMove,cloudMove), /Concurrent vehicle movements/);

const mixed = run(localMove,cloudProfile);
assert.equal(mixed.vehicles[0].currentLocationId,'A2');
assert.equal(mixed.vehicles[0].model,'Camry');

const localNew = edit(initialState, s => { s.vehicles.push(vehicle('v2','ABC2','A2')); });
const cloudSameBay = edit(initialState, s => { s.vehicles.push(vehicle('v3','ABC3','A2')); });
assert.throws(() => run(localNew,cloudSameBay), /Bay A2/);

const cloudXBay = edit(initialState, s => { s.vehicles.push(vehicle('v3','ABC3','A2','Yes')); });
assert.equal(run(localNew,cloudXBay).vehicles.length,3);

const cloudIndependent = edit(initialState, s => { s.vehicles.push(vehicle('v3','ABC3','A3')); });
assert.equal(run(localNew,cloudIndependent).vehicles.length,3);

const cloudDuplicate = edit(initialState, s => { s.vehicles.push(vehicle('v3','ABC2','A3')); });
assert.throws(() => run(localNew,cloudDuplicate), /Vehicle ABC2/);

const history = structuredClone(initialState);
history.auditEvents = [{id:'event1',detail:'saved'}];
const oldSnapshot = snapshot(history);
const trimmed = edit(history,s => { s.auditEvents = []; });
const unchanged = snapshot(history);
const reconciled = JSON.parse(mergeWorkspaceChanges(oldSnapshot,trimmed,unchanged)['vehicle-parking-browser-state-v2']);
assert.equal(reconciled.auditEvents.length,1);

console.log('PASS 8 workspace merge checks: independent profile edits, conflicting moves, mixed edits, slot capacity, X coexistence, independent additions, duplicate plates, history protection');
