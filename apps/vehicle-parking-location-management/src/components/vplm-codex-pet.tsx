import { useEffect, useRef, useState, type PointerEvent } from 'react';
import supraBotSheet from '@/assets/supra-bot.webp';
import transformationSheet from '@/assets/supra-transformation.webp';

/** Supra Bot v2: 8 columns, 11 rows, 192x208px cells. Bundled with the app. */
const SHEET = supraBotSheet;
const STATES = {
  idle: [0, 6], 'running-right': [1, 8], 'running-left': [2, 8],
  waving: [3, 4], jumping: [4, 5], failed: [5, 8], waiting: [6, 6],
  running: [7, 6], review: [8, 6],
} as const;
type Mood = keyof typeof STATES;
const DURATIONS: Record<Mood, readonly number[]> = {
  idle: [280, 110, 110, 140, 140, 320],
  'running-right': [120, 120, 120, 120, 120, 120, 120, 220],
  'running-left': [120, 120, 120, 120, 120, 120, 120, 220],
  waving: [140, 140, 140, 280], jumping: [140, 140, 140, 140, 280],
  failed: [140, 140, 140, 140, 140, 140, 140, 240],
  waiting: [150, 150, 150, 150, 150, 260],
  running: [120, 120, 120, 120, 120, 220], review: [150, 150, 150, 150, 150, 280],
};
const SCALE = 0.75;
const WIDTH = 192 * SCALE;
const HEIGHT = 208 * SCALE;
const MARGIN = 12;

export function VplmCodexPet({ awake, busy = false, onToggle }: { awake: boolean; busy?: boolean; onToggle: () => void }) {
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null);
  const [mood, setMood] = useState<Mood>('idle');
  const [frame, setFrame] = useState(0);
  const [imageFailed, setImageFailed] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [lookDirection, setLookDirection] = useState<number | null>(null);
  const [transformationFrame, setTransformationFrame] = useState(awake ? 7 : 0);
  const transformationProgress = useRef(awake ? 7 : 0);
  const [transformationReady, setTransformationReady] = useState(false);
  const [transformationFailed, setTransformationFailed] = useState(false);
  const transformationTarget = awake ? 7 : 0;
  const transforming = !transformationFailed && transformationFrame !== transformationTarget;
  const showTransformation = !transformationFailed && (!awake || transformationFrame < 7);
  const drag = useRef<{ pointerId: number; x: number; y: number; originX: number; originY: number; moved: boolean } | null>(null);
  const suppressClick = useRef(false);
  const button = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReducedMotion(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  useEffect(() => {
    const fit = () => setPosition(current => current && ({
      x: Math.max(MARGIN, Math.min(current.x, window.innerWidth - WIDTH - MARGIN)),
      y: Math.max(MARGIN, Math.min(current.y, window.innerHeight - HEIGHT - 35)),
    }));
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, []);

  useEffect(() => {
    if (!transformationReady || transformationFailed) return;
    const from = transformationProgress.current;
    if (reducedMotion) {
      transformationProgress.current = transformationTarget;
      setTransformationFrame(transformationTarget);
      return;
    }
    const started = performance.now();
    const duration = Math.max(1, Math.abs(transformationTarget - from) * 180);
    let animation = 0;
    const advance = (now: number) => {
      const elapsed = Math.min(1, (now - started) / duration);
      const eased = elapsed * elapsed * (3 - 2 * elapsed);
      const progress = elapsed === 1 ? transformationTarget : from + (transformationTarget - from) * eased;
      transformationProgress.current = progress;
      setTransformationFrame(progress);
      if (elapsed < 1) animation = window.requestAnimationFrame(advance);
    };
    animation = window.requestAnimationFrame(advance);
    return () => window.cancelAnimationFrame(animation);
  }, [transformationTarget, transformationReady, transformationFailed, reducedMotion]);

  useEffect(() => {
    setLookDirection(null);
    setMood(busy ? 'running' : awake ? 'waving' : 'idle');
    setFrame(0);
    if (!awake || busy || transforming) return;
    const timer = window.setTimeout(() => setMood('waiting'), 950);
    return () => window.clearTimeout(timer);
  }, [awake, busy, transforming]);

  useEffect(() => {
    if (reducedMotion || lookDirection !== null || showTransformation) return;
    const timer = window.setTimeout(() => setFrame(current => (current + 1) % STATES[mood][1]), DURATIONS[mood][frame % STATES[mood][1]]);
    return () => window.clearTimeout(timer);
  }, [mood, frame, reducedMotion, lookDirection, showTransformation]);

  const currentPosition = position ?? {
    x: typeof window === 'undefined' ? 24 : Math.max(MARGIN, window.innerWidth - WIDTH - 24),
    y: typeof window === 'undefined' ? 24 : Math.max(MARGIN, window.innerHeight - HEIGHT - 78),
  };

  useEffect(() => {
    if (!awake || transforming || busy || reducedMotion || !window.matchMedia('(pointer: fine)').matches) return;
    const look = (event: globalThis.PointerEvent) => {
      if (drag.current || event.pointerType === 'touch') return;
      const bounds = button.current?.getBoundingClientRect();
      if (!bounds) return;
      const dx = event.clientX - (bounds.left + WIDTH / 2);
      const dy = event.clientY - (bounds.top + HEIGHT / 2);
      if (Math.hypot(dx, dy) < 42) { setLookDirection(null); return; }
      const angle = (Math.atan2(dx, -dy) * 180 / Math.PI + 360) % 360;
      setLookDirection(Math.round(angle / 22.5) % 16);
    };
    const rest = () => setLookDirection(null);
    window.addEventListener('pointermove', look);
    window.addEventListener('blur', rest);
    document.documentElement.addEventListener('pointerleave', rest);
    return () => {
      window.removeEventListener('pointermove', look);
      window.removeEventListener('blur', rest);
      document.documentElement.removeEventListener('pointerleave', rest);
    };
  }, [awake, busy, reducedMotion, transforming]);

  const start = (event: PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return;
    setLookDirection(null);
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
    setMood(busy ? 'running' : awake ? 'waiting' : 'idle');
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };

  return (
    <button
      ref={button}
      type="button"
      aria-label={awake ? 'Close Ask VPLM AI' : 'Open Ask VPLM AI'}
      aria-expanded={awake}
      title="Supra Bot · Drag to move · Tap to chat with Ask VPLM AI"
      onClick={() => { if (suppressClick.current) { suppressClick.current = false; return; } onToggle(); }}
      onPointerDown={start}
      onPointerMove={move}
      onPointerUp={finish}
      onPointerCancel={finish}
      className="fixed z-[110] flex touch-none select-none flex-col items-center border-0 bg-transparent p-0 text-foreground shadow-none outline-offset-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-400"
      style={{ left: currentPosition.x, top: currentPosition.y, width: WIDTH, cursor: drag.current?.moved ? 'grabbing' : 'grab' }}
    >
      {imageFailed ? (
        <span className="flex items-center justify-center text-5xl" style={{ width: WIDTH, height: HEIGHT }} aria-hidden="true">🤖</span>
      ) : (
        <span
          aria-hidden="true"
          className="relative block shrink-0"
          style={{
            width: WIDTH, height: HEIGHT,
            backgroundImage: showTransformation ? 'none' : `url("${SHEET}")`,
            backgroundSize: `${1536 * SCALE}px ${(showTransformation ? 208 : 2288) * SCALE}px`,
            backgroundPosition: showTransformation
              ? `-${Math.floor(transformationFrame) * WIDTH}px 0px`
              : reducedMotion ? '0px 0px' : lookDirection !== null
              ? `-${(lookDirection % 8) * WIDTH}px -${(9 + Math.floor(lookDirection / 8)) * HEIGHT}px`
              : `-${(frame % STATES[mood][1]) * WIDTH}px -${STATES[mood][0] * HEIGHT}px`,
            backgroundRepeat: 'no-repeat',
            imageRendering: 'auto',
            filter: 'drop-shadow(0 5px 5px rgba(0,0,0,.32))',
          }}
        >
          {showTransformation && (
            <span className="absolute inset-0 block" style={{
              backgroundImage: `url("${transformationSheet}")`,
              backgroundSize: `${1536 * SCALE}px ${208 * SCALE}px`,
              backgroundPosition: `-${Math.floor(transformationFrame) * WIDTH}px 0px`,
              backgroundRepeat: 'no-repeat',
              opacity: 1 - (transformationFrame - Math.floor(transformationFrame)),
            }} />
          )}
          {showTransformation && (
            <span className="absolute inset-0 block" style={{
              backgroundImage: `url("${transformationSheet}")`,
              backgroundSize: `${1536 * SCALE}px ${208 * SCALE}px`,
              backgroundPosition: `-${Math.min(7, Math.floor(transformationFrame) + 1) * WIDTH}px 0px`,
              backgroundRepeat: 'no-repeat',
              opacity: transformationFrame - Math.floor(transformationFrame),
            }} />
          )}
        </span>
      )}
      <img src={SHEET} alt="" className="hidden" onError={() => setImageFailed(true)} />
      <img src={transformationSheet} alt="" className="hidden" onLoad={() => setTransformationReady(true)} onError={() => setTransformationFailed(true)} />
      <span className="whitespace-nowrap rounded-full border border-cyan-400/60 bg-slate-950/90 px-2.5 py-1 text-[11px] font-bold text-white shadow-lg">
        {transforming ? 'Transforming…' : busy ? 'AI working' : awake ? 'AI awake' : 'Ask VPLM AI'}
      </span>
    </button>
  );
}
