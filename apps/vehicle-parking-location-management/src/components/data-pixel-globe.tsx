import { useEffect, useRef } from 'react';
import type { CSSProperties } from 'react';

/** Adapted from the user's standalone Fibonacci-dot DataPixelGlobe.
 * Kept separate from OriginKit's authentic DataPixelArc KPI shader.
 * No global listeners, extra dependencies, or independent cloud-sync actions.
 */
type Point = { x: number; y: number; z: number; lat: number; lon: number };
type Projected = { x: number; y: number; depth: number; z: number; intensity: number };
type GlobeProps = {
  connected: boolean;
  size?: number;
  dotColor?: string;
  arcColor?: string;
  rotationSpeed?: number;
  density?: number;
  className?: string;
};

const rgb = (input: string): [number, number, number] => {
  const clean = input.trim().replace(/^#/, '');
  if (/^[\da-fA-F]{3}$/.test(clean)) {
    return [...clean].map(n => Number.parseInt(n + n, 16)) as [number, number, number];
  }
  if (/^[\da-fA-F]{6}$/.test(clean)) {
    return [0, 2, 4].map(i => Number.parseInt(clean.slice(i, i + 2), 16)) as [number, number, number];
  }
  const values = input.match(/\d+(?:\.\d+)?/g);
  return values?.length && values.length >= 3
    ? [Number(values[0]), Number(values[1]), Number(values[2])]
    : [51, 65, 85];
};

function pointsOnSphere(count: number): Point[] {
  const goldenAngle = Math.PI * (3 - Math.sqrt(5));
  return Array.from({ length: count }, (_, i) => {
    const y = 1 - (i / Math.max(count - 1, 1)) * 2;
    const radius = Math.sqrt(Math.max(0, 1 - y * y));
    const theta = goldenAngle * i;
    const x = Math.cos(theta) * radius;
    const z = Math.sin(theta) * radius;
    return { x, y, z, lat: Math.asin(y), lon: Math.atan2(z, x) };
  });
}

export function DataPixelGlobe({
  connected, size = 34, dotColor = '#334155', arcColor = '#2563eb',
  rotationSpeed = 1, density = 260, className = '',
}: GlobeProps) {
  const rootRef = useRef<HTMLSpanElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const latestRef = useRef({ connected, dotColor, arcColor, rotationSpeed, density });
  latestRef.current = { connected, dotColor, arcColor, rotationSpeed, density };

  useEffect(() => {
    const canvas = canvasRef.current;
    const root = rootRef.current;
    const context = canvas?.getContext('2d', { alpha: true });
    if (!canvas || !root || !context) return;

    let raf = 0;
    let rotationY = 0;
    const rotationX = 0.28;
    let arcPhase = 0;
    let pulseBoost = 0;
    let hovered = false;
    let lastTime = performance.now();
    let visible = true;
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const pointCache = new Map<number, Point[]>();
    const getPoints = (count: number) => {
      let points = pointCache.get(count);
      if (!points) {
        points = pointsOnSphere(count);
        pointCache.clear();
        pointCache.set(count, points);
      }
      return points;
    };

    const render = (now: number) => {
      raf = 0;
      const dt = Math.min(Math.max((now - lastTime) / 1000, 0), 0.05);
      lastTime = now;
      const state = latestRef.current;
      const active = state.connected && !reducedMotion.matches;
      if (active) {
        const speed = Math.min(3, Math.max(0.1, state.rotationSpeed));
        const effectiveSpeed = speed * (hovered ? 1.45 : 1) + pulseBoost * 2.2;
        rotationY += dt * 0.85 * effectiveSpeed;
        arcPhase += dt * 2.1 * (speed + pulseBoost * 1.5);
        pulseBoost = Math.max(0, pulseBoost - dt * 1.4);
      }
      const rect = root.getBoundingClientRect();
      const width = Math.max(24, rect.width);
      const height = Math.max(24, rect.height);
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
        canvas.width = Math.round(width * dpr);
        canvas.height = Math.round(height * dpr);
      }
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      context.clearRect(0, 0, width, height);
      const count = Math.min(800, Math.max(40, Math.round(state.density)));
      const points = getPoints(count);
      const base = rgb(state.dotColor);
      const accent = rgb(state.arcColor);
      const cy = Math.cos(rotationY), sy = Math.sin(rotationY);
      const cx = Math.cos(rotationX), sx = Math.sin(rotationX);
      const radius = Math.min(width, height) * 0.41;
      const projected: Projected[] = points.map(point => {
        const x = point.x * cy - point.z * sy;
        const z = point.z * cy + point.x * sy;
        const y = point.y * cx - z * sx;
        const depthZ = z * cx + point.y * sx;
        const scale = 2.6 / (2.6 - depthZ);
        const wave = Math.sin(point.lon * 1.5 + point.lat * 2.2 - arcPhase);
        const secondary = Math.cos(point.lat * 3 - arcPhase * 0.7);
        const signal = Math.max(0, wave * 0.75 + secondary * 0.25);
        const intensity = signal > 0.58 ? Math.min(1, (signal - 0.58) / 0.42 * (0.85 + pulseBoost * 0.5)) : 0;
        return {
          x: width / 2 + x * radius * scale,
          y: height / 2 + y * radius * scale,
          depth: (depthZ + 1) * 0.5,
          z: depthZ,
          intensity,
        };
      }).sort((a, b) => a.z - b.z);
      const baseRadius = Math.max(0.6, width * 0.0175);
      for (const point of projected) {
        const radius = baseRadius * (0.45 + point.depth * 0.65 + point.intensity * 0.35 * point.depth);
        const opacity = Math.min(1, (0.12 + Math.pow(point.depth, 1.5) * 0.78) * (1 + point.intensity * 0.25));
        const mix = point.intensity * (0.35 + point.depth * 0.65);
        const red = Math.round(base[0] + (accent[0] - base[0]) * mix);
        const green = Math.round(base[1] + (accent[1] - base[1]) * mix);
        const blue = Math.round(base[2] + (accent[2] - base[2]) * mix);
        context.beginPath();
        context.arc(point.x, point.y, radius, 0, Math.PI * 2);
        context.fillStyle = `rgba(${red}, ${green}, ${blue}, ${opacity})`;
        context.fill();
        if (point.intensity > 0.8 && point.depth > 0.65) {
          context.beginPath();
          context.arc(point.x, point.y, radius * 1.6, 0, Math.PI * 2);
          context.fillStyle = `rgba(${accent[0]}, ${accent[1]}, ${accent[2]}, ${point.intensity * 0.08})`;
          context.fill();
        }
      }
      if (active && visible && !document.hidden) raf = window.requestAnimationFrame(render);
    };
    const requestFrame = () => {
      if (!raf && visible && !document.hidden) {
        lastTime = performance.now();
        raf = window.requestAnimationFrame(render);
      }
    };
    const visibility = () => { if (document.hidden) window.cancelAnimationFrame(raf); else requestFrame(); if (document.hidden) raf = 0; };
    const onEnter = () => { hovered = true; requestFrame(); };
    const onLeave = () => { hovered = false; };
    const onPulse = () => { pulseBoost = 1; requestFrame(); };
    const observer = new IntersectionObserver(entries => {
      visible = entries[0]?.isIntersecting ?? false;
      if (visible) requestFrame();
      else { window.cancelAnimationFrame(raf); raf = 0; }
    });
    observer.observe(root);
    root.addEventListener('pointerenter', onEnter);
    root.addEventListener('pointerleave', onLeave);
    root.addEventListener('pointerdown', onPulse);
    document.addEventListener('visibilitychange', visibility);
    reducedMotion.addEventListener('change', requestFrame);
    requestFrame();
    return () => {
      window.cancelAnimationFrame(raf);
      observer.disconnect();
      root.removeEventListener('pointerenter', onEnter);
      root.removeEventListener('pointerleave', onLeave);
      root.removeEventListener('pointerdown', onPulse);
      document.removeEventListener('visibilitychange', visibility);
      reducedMotion.removeEventListener('change', requestFrame);
    };
  }, []);

  // Globe itself is decorative; the wrapping cloud button remains the accessible control.
  const style = {
    '--globe-size': `${size}px`,
    '--globe-dot-color': dotColor,
    '--globe-arc-color': arcColor,
    '--globe-rotation-speed': rotationSpeed,
    '--globe-dot-density': density,
  } as CSSProperties;
  return <span ref={rootRef} className={`data-pixel-globe ${className}`} style={style} aria-hidden="true">
    <canvas ref={canvasRef} aria-hidden="true" />
  </span>;
}
