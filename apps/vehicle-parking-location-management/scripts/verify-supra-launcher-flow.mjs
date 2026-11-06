import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const app = readFileSync('src/components/parking-app.tsx', 'utf8');
const ai = readFileSync('src/components/ai-assistant.tsx', 'utf8');
const pet = readFileSync('src/components/vplm-codex-pet.tsx', 'utf8');
const assets = ['src/assets/supra-bot.webp', 'src/assets/supra-transformation.webp'];

assert(app.includes('const [aiLauncherVisible, setAiLauncherVisible] = useState(false)'));
assert(app.includes('id="vplm-ai-header-toggle"'));
assert(app.includes('setAiLauncherVisible(!aiLauncherVisible)'));
assert(app.includes('if (aiLauncherVisible) setAiOpen(false)'));
assert(app.includes('launcherVisible={aiLauncherVisible} open={aiOpen} onOpenChange={setAiOpen}'));
assert(app.includes('aria-controls="vplm-supra-launcher"'));

assert(ai.includes('launcherVisible: boolean'));
assert(ai.includes('id="vplm-ai-panel"'));
assert(ai.includes('{launcherVisible && <VplmCodexPet awake={open} busy={busy} onToggle={() => onOpenChange(!open)} />}'));
assert(ai.includes('onClick={() => onOpenChange(false)}'));
assert(ai.includes('setMessages((current) => [...current,'), 'Chat messages must stay in mounted AI component');

assert(pet.includes('id="vplm-supra-launcher"'));
assert(pet.includes('pointer-events-auto fixed'));
assert(pet.includes('onPointerDown={start}'));
assert(pet.includes('onPointerMove={move}'));
assert(pet.includes('onPointerUp={finish}'));
assert(pet.includes('supraBotSheet'));
assert(pet.includes('transformationSheet'));
for (const asset of assets) assert(readFileSync(asset).length > 0, `Supra animation asset missing: ${asset}`);

console.log('PASS: top AI button toggles original Supra launcher; Supra taps toggle chat; close retains launcher; drag, transform assets, and chat message state preserved');
