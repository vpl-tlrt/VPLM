import { useCallback, useEffect, useRef } from 'react';

type PointerPosition = { x: number; y: number };

/**
 * Continuous auto-scroll at the edges of horizontal parking rows.
 * HTML dragover events may stop firing when the pointer is held stationary,
 * so scrolling must run inside requestAnimationFrame on desktop and touch.
 */
export function useParkingAutoScroll() {
  const pointerRef = useRef<PointerPosition | null>(null);
  const runningRef = useRef(false);
  const frameRef = useRef<number | null>(null);

  const stop = useCallback(() => {
    runningRef.current = false;
    pointerRef.current = null;
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    frameRef.current = null;
  }, []);

  const step = useCallback(() => {
    if (!runningRef.current) { frameRef.current = null; return; }
    const point = pointerRef.current;
    if (point) {
      const panels = document.querySelectorAll<HTMLElement>('.vplm-oriented-horizontal-scroll, .vplm-zone-portal-scroll');
      for (const panel of panels) {
        if (panel.scrollWidth <= panel.clientWidth + 2) continue;
        const rect = panel.getBoundingClientRect();
        if (point.y < rect.top - 12 || point.y > rect.bottom + 12 ||
            point.x < rect.left - 24 || point.x > rect.right + 24) continue;
        const edge = Math.min(92, rect.width * 0.28);
        const left = clamp((rect.left + edge - point.x) / edge);
        const right = clamp((point.x - (rect.right - edge)) / edge);
        const amount = right - left;
        if (Math.abs(amount) > 0.01) {
          panel.scrollLeft += Math.sign(amount) * (3 + 25 * Math.pow(Math.abs(amount), 1.5));
        }
        break;
      }
    }
    frameRef.current = requestAnimationFrame(step);
  }, []);

  const track = useCallback((x: number, y: number) => {
    if (runningRef.current && Number.isFinite(x) && Number.isFinite(y)) pointerRef.current = { x, y };
  }, []);

  const start = useCallback((x: number, y: number) => {
    pointerRef.current = { x, y };
    if (runningRef.current) return;
    runningRef.current = true;
    frameRef.current = requestAnimationFrame(step);
  }, [step]);

  useEffect(() => {
    const onNativeDrag = (event: DragEvent) => {
      if (runningRef.current && event.clientX > 0 && event.clientY > 0) track(event.clientX, event.clientY);
    };
    const onEnd = () => stop();
    document.addEventListener('dragover', onNativeDrag, true);
    window.addEventListener('blur', onEnd);
    return () => {
      document.removeEventListener('dragover', onNativeDrag, true);
      window.removeEventListener('blur', onEnd);
      stop();
    };
  }, [track, stop]);

  return { start, track, stop };
}

function clamp(value: number) { return Math.max(0, Math.min(1, value)); }
