import { useCallback, useEffect, useRef } from 'react';

type Point = { x: number; y: number };
type ScrollStyles = { snap: string; behavior: string };

/**
 * Continuous edge auto-scroll for vehicle drag. It follows the bay rail where
 * dragging began, even after touch pointer capture moves the pointer outside
 * the source bay. A zone portal strip is only chosen while directly hovered.
 */
export function useParkingAutoScroll() {
  const pointerRef = useRef<Point | null>(null);
  const activeRailRef = useRef<HTMLElement | null>(null);
  const runningRef = useRef(false);
  const frameRef = useRef<number | null>(null);
  const originalStylesRef = useRef(new Map<HTMLElement, ScrollStyles>());

  const unlockScroll = useCallback(() => {
    for (const [element, style] of originalStylesRef.current) {
      element.style.scrollSnapType = style.snap;
      element.style.scrollBehavior = style.behavior;
    }
    originalStylesRef.current.clear();
  }, []);

  const stop = useCallback(() => {
    runningRef.current = false;
    pointerRef.current = null;
    activeRailRef.current = null;
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    frameRef.current = null;
    unlockScroll();
  }, [unlockScroll]);

  const allowFreeScroll = useCallback((element: HTMLElement) => {
    if (originalStylesRef.current.has(element)) return;
    originalStylesRef.current.set(element, { snap: element.style.scrollSnapType, behavior: element.style.scrollBehavior });
    // CSS scroll-snap was pulling the rail back to its original bay after every
    // small scrollLeft change, making the left edge appear broken on Android.
    element.style.scrollSnapType = 'none';
    element.style.scrollBehavior = 'auto';
  }, []);

  const pickRail = useCallback((point: Point): HTMLElement | null => {
    const portal = [...document.querySelectorAll<HTMLElement>('.vplm-zone-portal-scroll')].find(el => {
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && point.y >= rect.top && point.y <= rect.bottom &&
        point.x >= rect.left - 20 && point.x <= rect.right + 20;
    });
    if (portal) return portal;
    const rails = [...document.querySelectorAll<HTMLElement>('.vplm-oriented-horizontal-scroll')];
    const closest = rails
      .map(el => {
        const rect = el.getBoundingClientRect();
        return { el, rect, distance: Math.max(rect.top - point.y, point.y - rect.bottom, 0) };
      })
      .filter(row => row.rect.width > 0 && row.rect.height > 0 &&
        point.x >= row.rect.left - 100 && point.x <= row.rect.right + 100 &&
        row.distance <= 48)
      .sort((a, b) => a.distance - b.distance)[0];
    return closest?.el ?? activeRailRef.current;
  }, []);

  const step = useCallback(() => {
    if (!runningRef.current) { frameRef.current = null; return; }
    const point = pointerRef.current;
    if (point) {
      const panel = pickRail(point);
      if (panel?.isConnected && panel.scrollWidth > panel.clientWidth + 1) {
        activeRailRef.current = panel.classList.contains('vplm-oriented-horizontal-scroll')
          ? panel : activeRailRef.current;
        const rect = panel.getBoundingClientRect();
        const edge = Math.min(112, Math.max(40, rect.width * 0.3));
        const left = Math.max(0, Math.min(1.4, (rect.left + edge - point.x) / edge));
        const right = Math.max(0, Math.min(1.4, (point.x - rect.right + edge) / edge));
        const velocity = right - left;
        if (Math.abs(velocity) > 0.015) {
          allowFreeScroll(panel);
          const speed = Math.sign(velocity) * (2 + 24 * Math.pow(Math.min(1.4, Math.abs(velocity)), 1.3));
          panel.scrollLeft = Math.max(0, Math.min(panel.scrollWidth - panel.clientWidth, panel.scrollLeft + speed));
        }
      }
    }
    frameRef.current = requestAnimationFrame(step);
  }, [allowFreeScroll, pickRail]);

  const track = useCallback((x: number, y: number) => {
    if (runningRef.current && Number.isFinite(x) && Number.isFinite(y))
      pointerRef.current = { x, y };
  }, []);

  const start = useCallback((x: number, y: number, source?: HTMLElement | null) => {
    pointerRef.current = { x, y };
    const sourceRail = source?.closest<HTMLElement>('.vplm-oriented-horizontal-scroll');
    activeRailRef.current = sourceRail ?? pickRail({ x, y });
    if (runningRef.current) return;
    runningRef.current = true;
    frameRef.current = requestAnimationFrame(step);
  }, [pickRail, step]);

  useEffect(() => {
    const onNativeDrag = (event: DragEvent) => {
      if (runningRef.current && Number.isFinite(event.clientX) && Number.isFinite(event.clientY) &&
          (event.clientX !== 0 || event.clientY !== 0)) track(event.clientX, event.clientY);
    };
    const onEnd = () => stop();
    document.addEventListener('dragover', onNativeDrag, true);
    window.addEventListener('dragend', onEnd, true);
    window.addEventListener('drop', onEnd, true);
    window.addEventListener('blur', onEnd);
    return () => {
      document.removeEventListener('dragover', onNativeDrag, true);
      window.removeEventListener('dragend', onEnd, true);
      window.removeEventListener('drop', onEnd, true);
      window.removeEventListener('blur', onEnd);
      stop();
    };
  }, [track, stop]);

  return { start, track, stop };
}
