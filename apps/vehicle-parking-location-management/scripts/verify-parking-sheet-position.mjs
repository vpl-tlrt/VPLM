import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync('src/index.css', 'utf8');
const dialog = readFileSync('src/components/ui/dialog.tsx', 'utf8');
const vehicle = readFileSync('src/components/vehicle-overview-dialog.tsx', 'utf8');
const bay = readFileSync('src/components/bay-information-dialog.tsx', 'utf8');
const dashboard = readFileSync('src/components/parking-app.tsx', 'utf8');

const start = css.indexOf('/* Parking Lot details are Radix dialogs styled as sheets.');
const end = css.indexOf('/* Parking Lot: keep supplementary', start);
assert(start >= 0 && end > start, 'Sheet positioning rules must exist in the scoped Parking Lot stylesheet');
const rules = css.slice(start, end);
const getMedia = (query) => {
  const marker = `@media (${query})`;
  const at = rules.indexOf(marker);
  assert(at >= 0, `Missing ${marker}`);
  const to = rules.indexOf('@media (', at + marker.length);
  return rules.slice(at, to < 0 ? rules.length : to);
};

// Tailwind 4 uses the independent CSS translate property for translate-x-[-50%],
// so transform:none alone leaves Radix dialog sheets half outside the viewport.
assert(dialog.includes('translate-x-[-50%]') && dialog.includes('translate-y-[-50%]'));
assert(rules.includes('translate: none !important;'), 'Cancel longhand translate on all sheet breakpoints');
assert(rules.includes('transform: none !important;'), 'Cancel inherited transform');
assert(rules.includes('animation: none !important;'), 'Prevent centered opening animations shifting sheets');
assert(rules.includes('overflow-y: auto;'), 'Profile actions must remain scrollable');

const mobile = getMedia('max-width: 767px');
for (const rule of ['left: 0 !important;', 'right: 0 !important;', 'bottom: 0 !important;',
  'top: auto !important;', 'width: 100dvw !important;', 'max-width: 100dvw !important;']) {
  assert(mobile.includes(rule), `Mobile sheet geometry missing ${rule}`);
}
const desktop = getMedia('min-width: 768px');
for (const rule of ['left: auto !important;', 'right: 0 !important;', 'top: 0 !important;',
  'bottom: 0 !important;', 'max-height: 100dvh !important;']) {
  assert(desktop.includes(rule), `Desktop drawer geometry missing ${rule}`);
}

assert(vehicle.includes('props.compactSheet ? "vplm-parking-detail-sheet'),
  'Occupied bay vehicle profile must opt into corrected sheet');
assert(bay.includes('compactSheet ? "vplm-parking-detail-sheet'),
  'Empty bay details must opt into corrected sheet');
assert(dashboard.includes('<VehicleOverviewDialog compactSheet') && dashboard.includes('<BayInformationDialog compactSheet'),
  'All Parking Lot bay taps must use the corrected sheet presentation');
console.log('PASS: mobile bottom sheet aligned to both viewport edges, desktop drawer right-aligned, Radix translation cancelled, details scrollable; bay interactions preserved');
