import { useEffect, useMemo, useRef, useState, type PointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { CarFront, RotateCcw, X } from 'lucide-react';
import type { ParkingLocation, Vehicle } from '@/lib/parking-data';
import { parkingZoneLabel } from '@/lib/parking-data';

type Slot = { id: string; label: string; plate?: string; x: number; y: number; occupied: boolean };
type Simulation = { x: number; y: number; heading: number; speed: number; cameraX: number; cameraY: number; collisionFrames: number };
type Target = { x: number; y: number } | null;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const angleDifference = (angle: number) => Math.atan2(Math.sin(angle), Math.cos(angle));

/** Read-only vehicle handling exercise. Never modifies live parking or sync records. */
export function VehiclePhysicsSimulator({ locations, vehicles, initialZone, onClose }: {
  locations: ParkingLocation[]; vehicles: Vehicle[]; initialZone?: string; onClose: () => void;
}) {
  const zones = useMemo(() => [...new Set(locations.map(l => l.zone))].sort(), [locations]);
  const [zone, setZone] = useState(initialZone && zones.includes(initialZone) ? initialZone : (zones[0] ?? ''));
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const speedRef = useRef<HTMLSpanElement>(null);
  const targetRef = useRef<Target>(null);
  const heldKeys = useRef(new Set<string>());
  const simRef = useRef<Simulation>({ x: 0, y: 0, heading: 0, speed: 0, cameraX: 0, cameraY: 0, collisionFrames: 0 });
  const occupied = useMemo(() => new Map(vehicles.filter(v => v.status !== 'Delivered' && v.status !== 'Released' && v.currentLocationId).map(v => [v.currentLocationId!, v.plateNumber])), [vehicles]);
  const slots = useMemo<Slot[]>(() => {
    const forZone = locations.filter(l => l.zone === zone);
    const laneNames = [...new Set(forZone.map(l => l.lane))].sort((a, b) => a === 'Top' ? -1 : b === 'Top' ? 1 : a === 'Bottom' ? 1 : b === 'Bottom' ? -1 : a.localeCompare(b));
    return laneNames.flatMap((lane, laneIndex) => {
      const bays = forZone.filter(l => l.lane === lane).sort((a, b) =>
        lane === 'Bottom' ? Number(b.bayNumber) - Number(a.bayNumber) : Number(a.bayNumber) - Number(b.bayNumber));
      return bays.map((bay, index) => ({
        id: bay.id, label: String(bay.bayNumber || bay.zone).slice(0, 16),
        x: (index - (bays.length - 1) / 2) * 7.3, y: laneIndex === 0 ? -14 : (laneIndex - 1) * 17 + 14,
        plate: occupied.get(bay.id), occupied: Boolean(occupied.get(bay.id)) || bay.status === 'Maintenance',
      }));
    });
  }, [locations, zone, occupied]);

  const reset = () => {
    simRef.current = { x: 0, y: 0, heading: 0, speed: 0, cameraX: 0, cameraY: 0, collisionFrames: 0 };
    targetRef.current = null;
    heldKeys.current.clear();
  };
  useEffect(() => { reset(); }, [zone]);

  useEffect(() => {
    const keydown = (e: KeyboardEvent) => {
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'w', 'a', 's', 'd', ' '].includes(e.key) &&
        !(e.target instanceof HTMLInputElement) && !(e.target instanceof HTMLSelectElement)) {
        e.preventDefault(); heldKeys.current.add(e.key.toLowerCase());
      }
      if (e.key === 'Escape') onClose();
    };
    const keyup = (e: KeyboardEvent) => heldKeys.current.delete(e.key.toLowerCase());
    const blur = () => { heldKeys.current.clear(); targetRef.current = null; };
    window.addEventListener('keydown', keydown);
    window.addEventListener('keyup', keyup);
    window.addEventListener('blur', blur);
    return () => { window.removeEventListener('keydown', keydown); window.removeEventListener('keyup', keyup); window.removeEventListener('blur', blur); };
  }, [onClose]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    let frame = 0;
    let previous = performance.now();

    const paintCar = (x: number, y: number, angle: number, color: string, plate?: string) => {
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(angle);
      ctx.fillStyle = '#07161399';
      ctx.fillRect(-1.75, -2.1, 4, 5.3);
      ctx.fillStyle = '#060d0c';
      ctx.fillRect(-1.45, -1.9, 0.45, 1.35); ctx.fillRect(1, -1.9, 0.45, 1.35);
      ctx.fillRect(-1.45, 1.15, 0.45, 1.35); ctx.fillRect(1, 1.15, 0.45, 1.35);
      ctx.fillStyle = color; ctx.beginPath(); ctx.roundRect(-1.3, -2.35, 2.6, 4.7, 0.42); ctx.fill();
      ctx.fillStyle = '#102b32'; ctx.beginPath(); ctx.roundRect(-1.03, -0.95, 2.06, 1.5, 0.3); ctx.fill();
      ctx.fillStyle = '#ffffff88'; ctx.fillRect(-1, -2.35, 0.65, 0.13); ctx.fillRect(0.35, -2.35, 0.65, 0.13);
      ctx.fillStyle = '#e53e51'; ctx.fillRect(-1.02, 2.22, 0.58, 0.13); ctx.fillRect(0.44, 2.22, 0.58, 0.13);
      if (plate) { ctx.save(); ctx.rotate(-angle); ctx.fillStyle = '#f2fff8'; ctx.font = '0.7px system-ui'; ctx.textAlign = 'center'; ctx.fillText(plate.slice(0, 9), 0, 0.3); ctx.restore(); }
      ctx.restore();
    };

    const tick = (now: number) => {
      const dt = clamp((now - previous) / 1000, 0, 0.033);
      previous = now;
      const sim = simRef.current;
      const keys = heldKeys.current;
      const target = targetRef.current;
      const steerLeft = keys.has('arrowleft') || keys.has('a');
      const steerRight = keys.has('arrowright') || keys.has('d');
      const forward = keys.has('arrowup') || keys.has('w');
      const backward = keys.has('arrowdown') || keys.has('s');
      if (steerLeft || steerRight) sim.heading += ((steerRight ? 1 : 0) - (steerLeft ? 1 : 0)) * dt * (1.15 + 0.05 * Math.abs(sim.speed));
      if (forward) sim.speed += 15 * dt;
      if (backward) sim.speed -= 13 * dt;
      if (target && !steerLeft && !steerRight && !forward && !backward) {
        const dx = target.x - sim.x;
        const dy = target.y - sim.y;
        const distance = Math.hypot(dx, dy);
        if (distance > 2.0) {
          const desired = Math.atan2(dx, -dy);
          const turn = angleDifference(desired - sim.heading);
          sim.heading += clamp(turn, -2.35 * dt, 2.35 * dt);
          sim.speed += (Math.abs(turn) > 1.3 ? 2 : 12) * dt;
        } else sim.speed *= Math.exp(-8 * dt);
      }
      sim.speed *= Math.exp(-1.1 * dt);
      sim.speed = clamp(sim.speed, -5, 12);
      const nextX = sim.x + Math.sin(sim.heading) * sim.speed * dt;
      const nextY = sim.y - Math.cos(sim.heading) * sim.speed * dt;
      const obstacle = slots.some(s => s.occupied && Math.abs(nextX - s.x) < 3.15 && Math.abs(nextY - s.y) < 6.2);
      if (obstacle) { sim.speed *= -0.28; sim.collisionFrames = 10; }
      else { sim.x = nextX; sim.y = nextY; }
      sim.cameraX += (sim.x - sim.cameraX) * clamp(dt * 7, 0, 1);
      sim.cameraY += (sim.y - sim.cameraY) * clamp(dt * 7, 0, 1);

      const bounds = canvas.getBoundingClientRect();
      const width = Math.max(1, bounds.width);
      const height = Math.max(1, bounds.height);
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const pxWidth = Math.round(width * dpr);
      const pxHeight = Math.round(height * dpr);
      if (canvas.width !== pxWidth || canvas.height !== pxHeight) { canvas.width = pxWidth; canvas.height = pxHeight; }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);
      ctx.fillStyle = '#061613';
      ctx.fillRect(0, 0, width, height);
      const scale = Math.min(11.5, Math.max(6, width / 40));
      ctx.save();
      ctx.translate(width / 2, height / 2);
      ctx.scale(scale, scale);
      ctx.translate(-sim.cameraX, -sim.cameraY);
      ctx.lineWidth = 0.08;
      ctx.strokeStyle = '#154638';
      const xStart = Math.floor((sim.cameraX - width / scale / 2) / 5) * 5;
      const yStart = Math.floor((sim.cameraY - height / scale / 2) / 5) * 5;
      const xEnd = sim.cameraX + width / scale / 2 + 5;
      const yEnd = sim.cameraY + height / scale / 2 + 5;
      for (let x = xStart; x < xEnd; x += 5) { ctx.beginPath(); ctx.moveTo(x, yStart); ctx.lineTo(x, yEnd); ctx.stroke(); }
      for (let y = yStart; y < yEnd; y += 5) { ctx.beginPath(); ctx.moveTo(xStart, y); ctx.lineTo(xEnd, y); ctx.stroke(); }
      ctx.fillStyle = '#183c32';
      ctx.fillRect(xStart, -5, xEnd - xStart, 10);
      ctx.strokeStyle = '#eab65d';
      ctx.setLineDash([1.6, 1.3]);
      ctx.lineWidth = 0.12; ctx.beginPath(); ctx.moveTo(xStart, 0); ctx.lineTo(xEnd, 0); ctx.stroke();
      ctx.setLineDash([]);
      for (const slot of slots) {
        ctx.fillStyle = slot.occupied ? '#30483e' : '#0d3327';
        ctx.fillRect(slot.x - 2.7, slot.y - 4.6, 5.4, 9.2);
        ctx.strokeStyle = slot.occupied ? '#cc8360' : '#47b68d';
        ctx.lineWidth = 0.17; ctx.strokeRect(slot.x - 2.7, slot.y - 4.6, 5.4, 9.2);
        ctx.fillStyle = '#e4f9ed'; ctx.font = '1px system-ui'; ctx.textAlign = 'center'; ctx.fillText(slot.label, slot.x, slot.y + 3.85);
        if (slot.occupied) paintCar(slot.x, slot.y - 0.4, Math.PI, '#8aa99b', slot.plate);
      }
      if (target) {
        ctx.strokeStyle = '#26edab'; ctx.lineWidth = 0.2;
        ctx.beginPath(); ctx.arc(target.x, target.y, 1, 0, Math.PI * 2); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(target.x - 1.5, target.y); ctx.lineTo(target.x + 1.5, target.y); ctx.moveTo(target.x, target.y - 1.5); ctx.lineTo(target.x, target.y + 1.5); ctx.stroke();
      }
      paintCar(sim.x, sim.y, sim.heading, sim.collisionFrames > 0 ? '#fb6f70' : '#19e6ab');
      if (sim.collisionFrames > 0) sim.collisionFrames--;
      ctx.restore();
      if (speedRef.current) speedRef.current.textContent = Math.round(Math.abs(sim.speed) * 3.6).toString();
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [slots]);

  const updateTarget = (event: PointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const scale = Math.min(11.5, Math.max(6, rect.width / 40));
    targetRef.current = { x: simRef.current.cameraX + (event.clientX - rect.left - rect.width / 2) / scale,
      y: simRef.current.cameraY + (event.clientY - rect.top - rect.height / 2) / scale };
  };

  return createPortal(
    <div className="fixed inset-0 z-[150] flex flex-col bg-[#071713] text-white" role="dialog" aria-modal="true" aria-label="Vehicle physics simulator">
      <header className="flex flex-wrap items-center gap-2 border-b border-emerald-500/30 bg-[#0a211b] px-3 py-3">
        <CarFront className="h-5 w-5 text-emerald-400" /><strong className="mr-auto text-sm">Vehicle physics · read-only simulator</strong>
        <label className="flex items-center gap-1 text-xs">Zone <select aria-label="Simulation zone" className="max-w-36 rounded border border-emerald-800 bg-[#13382c] p-2" value={zone} onChange={e => setZone(e.target.value)}>
          {zones.map(z => <option key={z} value={z}>{parkingZoneLabel(z)}</option>)}
        </select></label>
        <button type="button" onClick={reset} className="flex items-center gap-1 rounded border border-emerald-700 px-3 py-2 text-xs"><RotateCcw className="h-4 w-4"/>Reset</button>
        <button type="button" onClick={onClose} aria-label="Close vehicle physics" className="rounded border border-emerald-700 p-2"><X className="h-5 w-5"/></button>
      </header>
      <div className="relative min-h-0 flex-1">
        <canvas ref={canvasRef} className="h-full w-full touch-none" aria-label="Drive the green vehicle by dragging to a destination; occupied parking bays are physical obstacles"
          onPointerDown={e => { e.currentTarget.setPointerCapture(e.pointerId); updateTarget(e); }}
          onPointerMove={e => { if (e.currentTarget.hasPointerCapture(e.pointerId)) updateTarget(e); }}
          onPointerUp={e => { if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId); targetRef.current = null; }}
          onPointerCancel={() => { targetRef.current = null; }} />
        <div className="pointer-events-none absolute left-3 top-3 rounded-xl border border-emerald-600/40 bg-black/70 px-3 py-2 text-xs">Speed <span ref={speedRef} className="font-bold">0</span> km/h</div>
        <div className="pointer-events-none absolute inset-x-3 bottom-4 rounded-xl border border-emerald-600/30 bg-black/75 p-3 text-center text-xs sm:text-sm">Touch and drag to steer · Desktop: WASD or arrow keys · Occupied bays block movement · No live assignments are changed</div>
      </div>
    </div>,
    document.body,
  );
}
