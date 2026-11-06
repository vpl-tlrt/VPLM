import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';

const dialog = readFileSync('src/components/ui/dialog.tsx', 'utf8');
const vehicle = readFileSync('src/components/vehicle-overview-dialog.tsx', 'utf8');
const bay = readFileSync('src/components/bay-information-dialog.tsx', 'utf8');
const app = readFileSync('src/components/parking-app.tsx', 'utf8');
const ai = readFileSync('src/components/ai-assistant.tsx', 'utf8');
const cssSource = readFileSync('src/index.css', 'utf8');

assert(dialog.includes('placement?: "center" | "parking-sheet"'));
assert(dialog.includes('placement === "parking-sheet"'));
assert(dialog.includes('translate-x-[-50%]'));
assert(dialog.includes('"vplm-parking-detail-sheet inset-x-0 bottom-0 w-full max-w-full rounded-t-lg"'));
assert(vehicle.includes('placement={props.compactSheet ? "parking-sheet" : "center"}'));
assert(bay.includes('placement={compactSheet ? "parking-sheet" : "center"}'));
assert(app.includes('id="vplm-ai-header-toggle"'));
assert(app.includes('onClick={() => setAiOpen((current) => !current)}'));
assert(app.includes('open={aiOpen} onOpenChange={setAiOpen}'));
assert(ai.includes('id="vplm-ai-panel"'));
assert(!ai.includes('VplmCodexPet'));
assert(!ai.includes('setOpen('));
assert(cssSource.includes('translate: none !important'));
console.log('PASS: Parking Lot detail dialogs never inherit center transforms; header AI toggle opens and closes the existing assistant');

// Also validate the actual compiled Tailwind CSS geometry in headless Chrome,
// rather than relying only on a source-string assertion.
if (!process.argv.includes('--browser')) process.exit(0);
const { chromium } = await import('playwright');
const cssFile = readdirSync('dist/assets').find(name => name.endsWith('.css'));
assert(cssFile, 'Vite must generate a production CSS bundle');
const css = readFileSync(`dist/assets/${cssFile}`, 'utf8');
const candidatePaths = [
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/opt/google/chrome/chrome',
  '/usr/bin/chromium',
];
const executablePath = candidatePaths.find(path => existsSync(path));
const browser = await chromium.launch({
  ...(executablePath ? { executablePath } : {}),
  headless: true,
  args: ['--no-sandbox'],
});
try {
  for (const { width, height, label } of [
    { width: 360, height: 740, label: 'small Android phone' },
    { width: 412, height: 915, label: 'Android phone' },
    { width: 768, height: 1024, label: 'tablet / breakpoint' },
    { width: 980, height: 820, label: 'desktop-site mobile layout viewport' },
    { width: 1440, height: 900, label: 'desktop' },
  ]) {
    const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
    await page.setContent(`<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1" /><style>${css}</style></head>
      <body style="margin:0"><div data-slot="dialog-content" data-state="open"
      class="bg-background fixed z-50 grid gap-4 border p-6 vplm-parking-detail-sheet inset-x-0 bottom-0 w-full max-w-full rounded-t-lg max-h-[92dvh] min-w-0 overflow-x-hidden overflow-y-auto">
        <header><h2>Vehicle profile</h2><p>938848</p></header>
        <div style="height:1500px"><p>All vehicle actions remain available on scroll.</p></div>
      </div></body></html>`);
    const details = await page.locator('[data-slot="dialog-content"]').evaluate(element => {
      const r = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return { left:r.left, right:r.right, top:r.top, bottom:r.bottom,
        width:r.width, height:r.height, translate:style.translate,
        overflowY:style.overflowY, scrollHeight:element.scrollHeight, clientHeight:element.clientHeight };
    });
    assert(details.left >= -1.5, `${label}: sheet starts offscreen to left ${JSON.stringify(details)}`);
    assert(details.right <= width + 1.5, `${label}: sheet extends right ${JSON.stringify(details)}`);
    assert(details.top >= -1.5, `${label}: sheet starts above viewport ${JSON.stringify(details)}`);
    assert(details.bottom <= height + 1.5, `${label}: sheet extends below viewport ${JSON.stringify(details)}`);
    assert(details.scrollHeight > details.clientHeight, `${label}: profile controls not scrollable`);
    assert(details.overflowY === 'auto', `${label}: profile vertical scrolling disabled`);
    console.log(`PASS ${label}: left=${Math.round(details.left)}, right=${Math.round(details.right)}, top=${Math.round(details.top)}, bottom=${Math.round(details.bottom)}; scroll enabled`);
    await page.close();
  }
} finally { await browser.close(); }
