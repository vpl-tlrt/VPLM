import { useEffect, useRef, useState, type PointerEvent } from 'react';

/** Codex Pets v1 sprite atlas: 8 columns, 9 rows, 192x208px frames.
 * Uses the Bandit example spritesheet from the MIT-licensed codex-pets-web demo.
 * https://github.com/FroeMic/codex-pets-web
 */
const SHEET = 'https://froemic.github.io/codex-pets-web/pets/bandit/spritesheet.webp';
const STATES = { idle: [0, 6], 'running-right': [1, 8], 'running-left': [2, 8], waving: [3, 4], jumping: [4, 5], waiting: [6, 6] } as const;
type Mood = keyof typeof STATES;
const SCALE = 0.46;
const WIDTH = 192 * SCALE;
const HEIGHT = 208 * SCALE;
const MARGIN = 12;

export function VplmCodexPet({ awake, onToggle }: { awake: boolean; onToggle: () => void }) {
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null);
  const [mood, setMood] = useState<Mood>('idle');
  const [frame, setFrame] = useState(0);
  const [imageFailed, setImageFailed] = useState(false);
  const drag = useRef<{ pointerId: number; x: number; y: number; originX: number; originY: number; moved: boolean } | null>(null);
  const suppressClick = useRef(false);
  const button = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const fit = () => setPosition(current => current && ({
      x: Math.max(MARGIN, Math.min(current.x, window.innerWidth - WIDTH - MARGIN)),
      y: Math.max(MARGIN, Math.min(current.y, window.innerHeight - HEIGHT - 35)),
    }));
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, []);

  useEffect(() => {
    setMood(awake ? 'waving' : 'idle');
    setFrame(0);
    if (!awake) return;
    const timer = window.setTimeout(() => setMood('waiting'), 950);
    return () => window.clearTimeout(timer);
  }, [awake]);

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const fps = mood === 'idle' ? 3 : 9;
    const timer = window.setInterval(() => setFrame(current => (current + 1) % STATES[mood][1]), 1000 / fps);
    return () => window.clearInterval(timer);
  }, [mood]);

  const currentPosition = position ?? {
    x: typeof window === 'undefined' ? 24 : Math.max(MARGIN, window.innerWidth - WIDTH - 24),
    y: typeof window === 'undefined' ? 24 : Math.max(MARGIN, window.innerHeight - HEIGHT - 78),
  };
  const start = (event: PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return;
    drag.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, originX: currentPosition.x, originY: currentPosition.y, moved: false };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const move = (event: PointerEvent<HTMLButtonElement>) => {
    const d = drag.current;
    if (!d || d.pointerId !== event.pointerId) return;
    const dx = event.clientX - d.x, dy = event.clientY - d.y;
    if (Math.hypot(dx, dy) > 7) d.moved = true;
    if (!d.moved) return;
    setPosition({
      x: Math.max(MARGIN, Math.min(d.originX + dx, window.innerWidth - WIDTH - MARGIN)),
      y: Math.max(MARGIN, Math.min(d.originY + dy, window.innerHeight - HEIGHT - 35)),
    });
    setMood(dx < 0 ? 'running-left' : 'running-right');
  };
  const finish = (event: PointerEvent<HTMLButtonElement>) => {
    if (drag.current?.pointerId !== event.pointerId) return;
    suppressClick.current = drag.current.moved;
    drag.current = null;
    setMood(awake ? 'waiting' : 'idle');
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };

  return (
    <button
      ref={button}
      type="button"
      aria-label={awake ? 'Close Ask VPLM AI' : 'Open Ask VPLM AI'}
      aria-expanded={awake}
      title="Drag to move · Tap to chat with Ask VPLM AI"
      onClick={() => { if (suppressClick.current) { suppressClick.current = false; return; } onToggle(); }}
      onPointerDown={start}
      onPointerMove={move}
      onPointerUp={finish}
      onPointerCancel={finish}
      className="fixed z-[110] flex touch-none select-none flex-col items-center border-0 bg-transparent p-0 text-foreground outline-offset-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-400"
      style={{ left: currentPosition.x, top: currentPosition.y, width: WIDTH, cursor: drag.current?.moved ? 'grabbing' : 'grab' }}
    >
      {imageFailed ? (
        <span className="flex h-[96px] w-[88px] items-center justify-center text-5xl" aria-hidden="true">🐾</span>
      ) : (
        <span
          aria-hidden="true"
          className="block shrink-0"
          style={{
            width: WIDTH, height: HEIGHT,
            backgroundImage: `url("${SHEET}")`,
            backgroundSize: `${1536 * SCALE}px ${1872 * SCALE}px`,
            backgroundPosition: `-${frame * WIDTH}px -${STATES[mood][0] * HEIGHT}px`,
            backgroundRepeat: 'no-repeat',
            imageRendering: 'pixelated',
            filter: 'drop-shadow(0 5px 5px rgba(0,0,0,.32))',
          }}
        />
      )}
      <img src={SHEET} alt="" className="hidden" onError={() => setImageFailed(true)} />
      <span className="whitespace-nowrap rounded-full border border-cyan-400/60 bg-slate-950/90 px-2.5 py-1 text-[11px] font-bold text-white shadow-lg">
        {awake ? 'AI awake' : 'Ask VPLM AI'}
      </span>
    </button>
  );
}
