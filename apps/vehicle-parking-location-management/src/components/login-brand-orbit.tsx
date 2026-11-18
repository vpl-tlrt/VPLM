import { useEffect, useRef } from 'react';

/**
 * Login brand artwork derived from the supplied VPLM Brand Engine:
 * 1,050 Fibonacci sphere nodes, a raised-cosine polar collapse to a
 * parking-bay halo, and interactive pointer orbit with flick inertia.
 * This visual is isolated from authentication and workspace state.
 */
const N = 1050;
const GOLDEN = Math.PI * (3 - Math.sqrt(5));
const DOTS = Array.from({ length: N }, (_, i) => {
  const y = 1 - ((i + 0.5) / N) * 2;
  const phi = i * GOLDEN;
  return { theta: Math.acos(y), cp: Math.cos(phi), sp: Math.sin(phi), weight: 0.88 + 0.24 * ((i * 7) % 11) / 10 };
});
const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));
const ease = (t: number) => {
  const r = (1 - Math.cos(Math.PI * clamp(t, 0, 1))) / 2;
  return r * r * (3 - 2 * r);
};

export function LoginBrandOrbit() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d', { alpha: true });
    if (!ctx) return;
    const motionReduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    let raf = 0, last = 0, phase = 0.02, spin = -0.26, tilt = 0.48, vx = 0, vy = 0;
    let dragging = false, pointerId = -1, px = 0, py = 0;
    let width = 1, height = 1;
    const resize = () => {
      const r = canvas.getBoundingClientRect();
      width = Math.max(1, r.width); height = Math.max(1, r.height);
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    resize();

    const onDown = (e: PointerEvent) => {
      dragging = true; pointerId = e.pointerId; px = e.clientX; py = e.clientY;
      vx = 0; vy = 0; canvas.setPointerCapture(e.pointerId);
    };
    const onMove = (e: PointerEvent) => {
      if (!dragging || e.pointerId !== pointerId) return;
      const dx = e.clientX - px, dy = e.clientY - py;
      spin += dx * 0.008; tilt = clamp(tilt + dy * 0.007, -1.5, 1.5);
      vx = dx * 0.0016; vy = dy * 0.0013;
      px = e.clientX; py = e.clientY;
    };
    const onUp = (e: PointerEvent) => {
      if (e.pointerId !== pointerId) return;
      dragging = false; pointerId = -1;
      if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
    };
    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointercancel', onUp);
    const draw = (now: number) => {
      const dt = Math.min(0.05, last ? (now - last) / 1000 : 0.016);
      last = now;
      if (!motionReduced.matches) {
        phase = (phase + dt / 8.5) % 1;
        if (!dragging) {
          spin += dt * 0.22 + vx;
          tilt = clamp(tilt + vy, -1.5, 1.5);
          vx *= Math.pow(0.90, dt * 60);
          vy *= Math.pow(0.85, dt * 60);
        }
      }
      ctx.clearRect(0, 0, width, height);
      const collapse = motionReduced.matches ? 0.2 : ease(phase < 0.5 ? phase * 2 : (1 - phase) * 2);
      const radius = Math.min(width, height) * 0.315;
      const centerX = width * 0.5, centerY = height * 0.49;
      const cp = Math.cos(spin), sp = Math.sin(spin);
      const ct = Math.cos(tilt), st = Math.sin(tilt);
      const pts: { x: number; y: number; z: number; w: number }[] = [];
      for (const dot of DOTS) {
        // Polar-angle interpolation keeps the ring on the sphere surface.
        const lane = Math.sin(dot.theta * 19) * 0.055;
        const theta = dot.theta + (Math.PI / 2 + lane - dot.theta) * collapse;
        const sx = Math.sin(theta) * dot.cp, sy = Math.cos(theta), sz = Math.sin(theta) * dot.sp;
        const x = sx * cp + sz * sp;
        const z = -sx * sp + sz * cp;
        const y = sy * ct - z * st;
        const depth = sy * st + z * ct;
        const proj = 1 + depth * 0.16;
        pts.push({ x: centerX + x * radius * proj, y: centerY - y * radius * proj, z: depth, w: dot.weight });
      }
      pts.sort((a, b) => a.z - b.z);
      for (const p of pts) {
        const depth = (p.z + 1) / 2;
        const rad = Math.max(0.6, (0.72 + depth * 1.05) * p.w);
        // Emerald shades match the existing sign-in button and dark green login surface.
        const alpha = (0.22 + 0.65 * depth) * (collapse > 0.9 ? 0.96 : 1);
        ctx.fillStyle = depth > 0.62 ? `rgba(128,245,175,${alpha})` : `rgba(32,164,107,${alpha})`;
        ctx.beginPath();
        ctx.arc(p.x, p.y, rad, 0, Math.PI * 2);
        ctx.fill();
      }
      raf = window.requestAnimationFrame(draw);
    };
    raf = window.requestAnimationFrame(draw);
    return () => {
      window.cancelAnimationFrame(raf);
      observer.disconnect();
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onUp);
    };
  }, []);
  return (
    <canvas
      ref={canvasRef}
      role="img"
      aria-label="Interactive VPLM animated parking zone globe transforming into a bay halo; drag to orbit"
      className="absolute inset-0 h-full w-full cursor-grab touch-none active:cursor-grabbing"
    />
  );
}
