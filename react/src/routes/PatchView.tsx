import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { useSession } from '../store/session';
import { BatchStrip } from '../components/BatchStrip';
import { EmptyState } from '../components/EmptyState';
import { IconPatch, IconUndo, IconRedo } from '../components/icons';
import { useUi } from '../store/ui';

const LEGEND = [
  { name: 'Tracks 1-8', color: '#c4664a' },
  { name: 'Tracks 9-16', color: '#c8a96e' },
  { name: 'Tracks 17-24', color: '#7a9e8c' },
  { name: 'Tracks 25-32', color: '#7f8fa0' },
  { name: 'Unassigned', color: '#ccc', dashed: true },
];

/** Cable/accent color for a track number by range band. */
function colorForTrack(track: string | null): string {
  if (!track) return '#9a958d';
  const n = parseInt(track.slice(1), 10);
  if (n <= 8) return LEGEND[0].color;
  if (n <= 16) return LEGEND[1].color;
  if (n <= 24) return LEGEND[2].color;
  if (n <= 32) return LEGEND[3].color;
  return '#b088c8';
}

// ----- cable geometry helpers -------------------------------------------
function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

/** Cable path with gravity-ish sag: a cubic bezier whose control points
 *  pull the middle of the cable downward proportional to its span. */
function cablePath(sx: number, sy: number, tx: number, ty: number): string {
  const dx = tx - sx;
  const sag = clamp(Math.abs(dx) * 0.09, 6, 26);
  const c1x = sx + dx * 0.38;
  const c2x = sx + dx * 0.62;
  return `M ${sx} ${sy} C ${c1x} ${sy + sag}, ${c2x} ${ty + sag}, ${tx} ${ty}`;
}

export interface CableEnd {
  x: number;
  y: number;
}

export interface CableSpec {
  ch: number;
  name: string;
  from: CableEnd;
  to: CableEnd;
  color: string;
  track: string;
}

interface Pt { x: number; y: number; }

// ---------------------------------------------------------------------------
export function PatchView() {
  const session = useSession();
  const { rows } = session;
  const setTab = useUi((s) => s.setTab);

  // Undo/redo keyboard shortcuts (Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y — parity with app.js)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const k = e.key.toLowerCase();
      if (k === 'z') {
        e.preventDefault();
        if (e.shiftKey) session.redo();
        else session.undo();
      } else if (k === 'y') {
        e.preventDefault();
        session.redo();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  if (!session.folder) {
    return (
      <EmptyState
        icon={<IconPatch size={30} />}
        title="No patch bay to show"
        hint="Load a shoot-day folder, then plug source channels into Avid tracks here."
        cta="Go to Home"
        onClick={() => setTab('home')}
      />
    );
  }
  const [dragging, setDragging] = useState<number | null>(null);
  const [dragOverTrack, setDragOverTrack] = useState<string | null>(null);
  const [dragOverChip, setDragOverChip] = useState<number | null>(null);
  const [mouse, setMouse] = useState<Pt | null>(null);
  const areaRef = useRef<HTMLDivElement>(null);
  const [tick, setTick] = useState(0);

  const assigned = rows.filter((r) => r.track);
  const unassigned = rows.filter((r) => !r.track);

  // Expanded timeline lanes: one lane PER CLIP, in stacking order.
  // A bucket (e.g. 4 contestants on "A3") expands to consecutive timeline
  // tracks A3, A4, A5, A6 — one track per clip, exactly like the AAF.
  const expLanes = useMemo(() => {
    const buckets = new Map<string, typeof assigned>();
    for (const r of assigned) {
      const b = buckets.get(r.track as string) ?? [];
      b.push(r);
      buckets.set(r.track as string, b);
    }
    const order = [...buckets.keys()].sort(
      (a, b) => parseInt(a.slice(1), 10) - parseInt(b.slice(1), 10),
    );
    const out: { track: string; expanded: string; ch: number; name: string }[] = [];
    let prevEnd = 0;
    for (const b of order) {
      const members = buckets.get(b) ?? [];
      let cur = Math.max(parseInt(b.slice(1), 10), prevEnd + 1);
      for (const m of members) {
        out.push({ track: b, expanded: `A${cur}`, ch: m.ch, name: m.name });
        cur += 1;
      }
      prevEnd = cur - 1;
    }
    return out;
  }, [assigned]);

  const clearDrag = () => {
    setDragging(null);
    setDragOverTrack(null);
    setDragOverChip(null);
    setMouse(null);
  };

  // Measure chip/track/member anchors relative to the patch area, re-measured
  // whenever routing, drag state, or layout changes (ResizeObserver + tick).
  useLayoutEffect(() => {
    const el = areaRef.current;
    if (!el) return;
    const measure = () => setTick((t) => t + 1);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    window.addEventListener('resize', measure);
    // Also re-measure once images/fonts settle.
    const t = setTimeout(measure, 350);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', measure);
      clearTimeout(t);
    };
  }, [rows, dragging, dragOverTrack, dragOverChip, mouse]);

  const anchors = useMemo(() => {
    const el = areaRef.current;
    if (!el) return { chips: new Map<number, Pt>(), tracks: new Map<string, Pt>(), members: new Map<string, Pt>() };
    const rect = el.getBoundingClientRect();
    const chips = new Map<number, Pt>();
    const tracks = new Map<string, Pt>();
    const members = new Map<string, Pt>();
    el.querySelectorAll<HTMLElement>('[data-ch-anchor]').forEach((n) => {
      const r = n.getBoundingClientRect();
      chips.set(Number(n.dataset.chAnchor), { x: r.left - rect.left + r.width, y: r.top - rect.top + r.height / 2 });
    });
    el.querySelectorAll<HTMLElement>('[data-track-anchor]').forEach((n) => {
      const r = n.getBoundingClientRect();
      tracks.set(n.dataset.trackAnchor as string, { x: r.left - rect.left, y: r.top - rect.top + r.height / 2 });
    });
    el.querySelectorAll<HTMLElement>('[data-member-anchor]').forEach((n) => {
      const r = n.getBoundingClientRect();
      members.set(String(n.dataset.memberAnchor), { x: r.left - rect.left, y: r.top - rect.top + r.height / 2 });
    });
    return { chips, tracks, members };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick, rows]);

  const cables: CableSpec[] = useMemo(() => {
    const { chips, tracks, members } = anchors;
    const list: CableSpec[] = [];
    for (const r of assigned) {
      const from = chips.get(r.ch);
      const to = members.get(String(r.ch)) ?? (r.track ? tracks.get(r.track) : undefined);
      if (!from || !to) continue;
      list.push({
        ch: r.ch,
        name: r.name,
        from,
        to,
        color: colorForTrack(r.track),
        track: r.track as string,
      });
    }
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anchors, assigned]);

  const tempCable = useMemo(() => {
    if (dragging === null || !mouse) return null;
    const from = anchors.chips.get(dragging);
    if (!from) return null;
    const tgt = dragOverChip !== null ? anchors.members.get(String(dragOverChip)) : undefined;
    const target = tgt ?? mouse;
    const hoverExp = dragOverChip !== null ? expLanes.find((l) => l.ch === dragOverChip)?.expanded : undefined;
    return {
      color: hoverExp ? colorForTrack(hoverExp) : '#999',
      path: cablePath(from.x, from.y, target.x, target.y),
    };
  }, [dragging, mouse, dragOverChip, anchors, expLanes]);

  const dropUnassigned = () => {
    if (dragging === null) return;
    const cur = rows.find((r) => r.ch === dragging);
    if (cur?.track) {
      session.placeAt(dragging, null, null);
      session.toast(`${cur?.name ?? `CH${dragging}`} unrouted`);
    }
    clearDrag();
  };

  const dropOnChip = (track: string | null, targetCh: number) => {
    if (dragging === null || dragging === targetCh) return;
    const cur = rows.find((r) => r.ch === dragging);
    session.placeAt(dragging, track, targetCh);
    session.toast(`${cur?.name ?? `CH${dragging}`} stacked before CH${targetCh} on ${track ?? 'Unassigned'}`);
    clearDrag();
  };

  return (
    <>
      <BatchStrip />
      <div className="card">
        <div className="patch-map-head card-header" style={{ borderBottom: '1px solid var(--border)' }}>
          <h2>Patch bay — plug source into a track</h2>
          <div className="legend">
            {LEGEND.map((l) => (
              <span key={l.name} className="legend-item">
                <span className="legend-swatch" style={l.dashed ? { border: '1px dashed #bbb', background: 'transparent' } : { background: l.color }} />
                {l.name}
              </span>
            ))}
          </div>
          <div className="patch-undo-bar">
            <button className={`btn-undo${session.past.length ? ' enabled' : ''}`} disabled={!session.past.length} onClick={session.undo} title="Undo (Ctrl+Z)"><IconUndo size={13} /> Undo</button>
            <button className={`btn-redo${session.future.length ? ' enabled' : ''}`} disabled={!session.future.length} onClick={session.redo} title="Redo (Ctrl+Shift+Z)"><IconRedo size={13} /> Redo</button>
          </div>
        </div>

        <div
          ref={areaRef}
          className="patch-map-wrap"
          style={{ padding: '0 20px 16px', position: 'relative' }}
          onDragOver={(e) => {
            e.preventDefault();
            const el = areaRef.current;
            if (el) {
              const r = el.getBoundingClientRect();
              setMouse({ x: e.clientX - r.left, y: e.clientY - r.top });
            }
          }}
        >
          {/* Source lane */}
          <div className="patch-lane">
            <div className="lane-label">Source channels</div>
            <div className="patch-chips">
              {rows.map((r) => (
                <span
                  key={r.ch}
                  data-ch-anchor={r.ch}
                  className={`patch-chip${dragging === r.ch ? ' dragging' : ''}`}
                  draggable
                  onDragStart={() => setDragging(r.ch)}
                  onDragEnd={clearDrag}
                >
                  <span className="ch">{String(r.ch).padStart(2, '0')}</span>{r.name}
                </span>
              ))}
            </div>
            <div className="patch-drag-hint">Drag a chip and plug it into a lane on the right</div>
          </div>

          {/* Cable corridor hint between the two panels */}
          <div className="patch-corridor" aria-hidden="true">
            <span className="corridor-label">cables</span>
          </div>

          {/* SVG cable overlay (absolute over the whole patch area) */}
          <svg
            className="patch-cable-svg"
            style={{
              position: 'absolute', inset: 0, width: '100%', height: '100%',
              pointerEvents: 'none', zIndex: 5,
            }}
          >
            {cables.map((c) => (
              <g key={c.ch}>
                <path d={cablePath(c.from.x, c.from.y, c.to.x, c.to.y)} stroke={c.color}
                  strokeWidth={1.7} fill="none" opacity={0.85} />
                <circle cx={c.from.x} cy={c.from.y} r={2.4} fill={c.color} />
                <circle cx={c.to.x} cy={c.to.y} r={2.6} fill={c.color}
                  stroke="rgba(20,17,14,0.6)" strokeWidth={1} />
              </g>
            ))}
            {tempCable && (
              <path d={tempCable.path} stroke={tempCable.color} strokeWidth={2}
                strokeDasharray="5 4" fill="none" opacity={0.9} />
            )}
          </svg>

          {/* Timeline stack lane (right) — ONE lane per clip, in AAF stacking
              order. Drop a chip onto a lane to insert it before that clip. */}
          <div className="patch-lane" data-right-lane>
            <div className="lane-label">Timeline stack — one clip per track · drag to reorder</div>
            <div className="exp-stack">
              {expLanes.map((l) => (
                <div
                  key={`${l.track}-${l.ch}`}
                  data-exp-ch={l.ch}
                  className={`exp-row${dragOverChip === l.ch && dragging !== l.ch ? ' drop-before' : ''}`}
                  style={{ '--tc': colorForTrack(l.expanded) } as CSSProperties}
                  onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setDragOverChip(l.ch); }}
                  onDragLeave={(e) => { e.preventDefault(); e.stopPropagation(); setDragOverChip(null); }}
                  onDrop={(e) => { e.preventDefault(); e.stopPropagation(); dropOnChip(l.track, l.ch); }}
                >
                  <span className="exp-track">{l.expanded}</span>
                  <span
                    data-member-anchor={l.ch}
                    className={`patch-chip exp-chip${dragging === l.ch ? ' dragging' : ''}`}
                    draggable
                    onDragStart={(e) => { e.stopPropagation(); setDragging(l.ch); }}
                    onDragEnd={clearDrag}
                  >
                    <span className="ch">{String(l.ch).padStart(2, '0')}</span>{l.name}
                  </span>
                </div>
              ))}
              {/* Unassigned lane at the bottom — drag a routed chip here to unroute */}
              <div
                className={`exp-row exp-un${dragOverTrack === '__un' ? ' drag-over' : ''}`}
                onDragOver={(e) => { e.preventDefault(); setDragOverTrack('__un'); }}
                onDragLeave={() => setDragOverTrack(null)}
                onDrop={(e) => { e.preventDefault(); dropUnassigned(); }}
              >
                <span className="exp-track" style={{ color: '#9a958d' }}>—</span>
                <div className="exp-un-chips">
                  {unassigned.length === 0 && <span className="exp-empty muted">no unassigned</span>}
                  {unassigned.map((m) => (
                    <span key={m.ch} className="patch-chip exp-chip dim" data-member-anchor={`u${m.ch}`}>
                      <span className="ch">{String(m.ch).padStart(2, '0')}</span>{m.name}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}