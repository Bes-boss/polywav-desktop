import { create } from 'zustand';
import { DEMO_TAKES, buildTakeChannels, defaultTrackFor } from '../data/demo';
import { useSettings } from './settings';
import { api, IS_REAL, type ExportConfig, type ProbeResult } from '../api/electron';

export interface RoutingRow {
  ch: number;
  raw: string;
  name: string;
  bext: string;
  track: string | null;
}

export interface TakeRow {
  id: string;
  name: string;
  path: string;
  channels: number;
  sampleRate: number;
  bits: number;
  channelNames?: string[];
}

type ExportStatus = 'idle' | 'running' | 'done' | 'error';

interface SessionState {
  folder: string | null;
  takes: TakeRow[];
  selectedTake: number | null;
  loading: boolean;
  error: string | null;
  rows: RoutingRow[];
  past: RoutingRow[][];
  future: RoutingRow[][];
  pattern: string;
  template: string;
  exportStatus: ExportStatus;
  exportLog: string[];
  exportQueue: string[];
  exportDone: number;
  toasts: { id: number; msg: string }[];
  loadFolder: (folder: string) => Promise<void>;
  selectTake: (idx: number) => void;
  setTrack: (ch: number, track: string | null) => void;
  /** Place a channel onto a track at a specific stacking position.
   *  beforeCh = null means "end of that track's stack". One history entry. */
  placeAt: (ch: number, track: string | null, beforeCh: number | null) => void;
  autoAssign: () => void;
  clearRouting: () => void;
  undo: () => void;
  redo: () => void;
  setPattern: (p: string) => void;
  setTemplate: (t: string) => void;
  startExport: () => void;
  cancelExport: () => void;
  resetExport: () => void;
  toast: (msg: string) => void;
  dismissToast: (id: number) => void;
}

let toastSeq = 0;
let jobCompleteCb: (() => void) | null = null;
let exportWired = false;

function buildRows(channels: number, previous: RoutingRow[], auto: boolean, channelNames?: string[]): RoutingRow[] {
  const chans = buildTakeChannels(channels);
  // Browser demo keeps its presentational demo names; the real shell follows
  // shipping semantics: bext names when probed, else neutral 'Channel 0N'
  // (never demo names), and NO load-time auto-assign (autoAssign is wizard /
  // explicit Auto-assign button action in the shipping app too).
  const demo = !IS_REAL;
  return chans.map((c, i) => {
    const prev = previous[i];
    if (demo) {
      return {
        ch: i + 1,
        raw: c.raw,
        name: c.name,
        bext: c.bext,
        track: prev ? prev.track : auto ? defaultTrackFor(i) : null,
      };
    }
    const hasReal = !!channelNames?.length;
    const raw = hasReal ? channelNames![i] : `Channel ${String(i + 1).padStart(2, '0')}`;
    return {
      ch: i + 1,
      raw,
      name: raw,
      bext: '',
      track: prev ? prev.track : null,
    };
  });
}

// eslint-disable-next-line @typescript-eslint/naming-convention
const outPath = (takeName: string) => {
  const base = useSettings.getState().settings.outputAafDir;
  return `${base}\\${takeName.replace(/\.wav$/i, '')}.aaf`;
};

function wireExportEvents() {
  if (exportWired) return;
  exportWired = true;
  api.onExportProgress((d) => {
    useSession.setState((s) => ({ exportLog: [...s.exportLog, d.line] }));
  });
  api.onExportComplete(() => {
    useSession.setState((s) => ({ exportDone: s.exportDone + 1 }));
    jobCompleteCb?.();
  });
  api.onExportError(() => useSession.setState({ exportStatus: 'error' }));
  api.onExportCancelled(() => useSession.setState({ exportStatus: 'idle' }));
}

const pushHistory = (s: { rows: RoutingRow[]; past: RoutingRow[][]; future: RoutingRow[][] }) => ({
  past: [...s.past, s.rows.map((r) => ({ ...r }))].slice(-50),
  future: [],
});

export const useSession = create<SessionState>()((set, get) => ({
  folder: null,
  takes: [],
  selectedTake: null,
  loading: false,
  error: null,
  rows: [],
  past: [],
  future: [],
  pattern: '^(?<prefix>[A-Z]+)_(?<role>[A-Za-z]+)_?(?<num>\\d+)?$',
  template: '{prefix}_{role}_{num}',
  exportStatus: 'idle',
  exportLog: [],
  exportQueue: [],
  exportDone: 0,
  toasts: [],

  loadFolder: async (folder) => {
    set({ loading: true, error: null, folder });
    try {
      let takes: TakeRow[];
      if (IS_REAL) {
        // Real shell: enumerate WAVs, probe each through the engine.
        // Hardening: bounded concurrency — 60 takes must not spawn 60 pythons.
        const res = await api.listWavs(folder);
        if ('error' in res && res.error) throw new Error(String(res.error));
        if (!res.wavs.length) throw new Error('No .wav files found in that folder');
        const PROBE_CONCURRENCY = 4;
        const probed: { name: string; path: string; pr: ProbeResult }[] = [];
        let cursor = 0;
        const worker = async () => {
          while (cursor < res.wavs.length) {
            const i = cursor++;
            const p = `${folder}\\${res.wavs[i]}`;
            let pr: Partial<ProbeResult> = {};
            try {
              pr = await api.probeFile(p);
            } catch { /* leave empty probe; take still listed */ }
            probed[i] = { name: res.wavs[i], path: p, pr: pr as ProbeResult };
          }
        };
        await Promise.all(
          Array.from({ length: Math.min(PROBE_CONCURRENCY, res.wavs.length) }, worker),
        );
        takes = probed.map((x, i) => ({
          id: `T${String(i + 1).padStart(2, '0')}`,
          name: x.name,
          path: x.path,
          channels: x.pr.channels ?? 0,
          sampleRate: x.pr.sampleRate ?? 0,
          bits: x.pr.bitDepth ?? 0,
          channelNames: Array.isArray(x.pr.channelNames) && x.pr.channelNames.length
            ? x.pr.channelNames : undefined,
        }));
      } else {
        // Browser demo / screenshot path: fabricated takes.
        await new Promise((r) => setTimeout(r, 250));
        takes = DEMO_TAKES.map((t) => ({ ...t, path: `${folder}\\${t.name}` }));
      }
      if (!takes.length) throw new Error('No .wav files found in that folder');
      const auto = useSettings.getState().settings.autoAssign;
      const rows = buildRows(takes[0].channels, [], auto, takes[0].channelNames);
      set({ takes, selectedTake: 0, rows, past: [], future: [], loading: false, exportStatus: 'idle', exportLog: [], exportDone: 0 });
      get().toast(`Loaded ${takes.length} WAV — routing template from ${takes[0].name}`);
    } catch (e) {
      set({ loading: false, error: e instanceof Error ? e.message : String(e) });
    }
  },

  selectTake: (idx) => {
    const { takes, rows } = get();
    const t = takes[idx];
    if (!t || idx === get().selectedTake) return;
    const auto = useSettings.getState().settings.autoAssign;
    const next = buildRows(t.channels, rows, auto, t.channelNames);
    set((s) => ({ ...pushHistory(s), selectedTake: idx, rows: next }));
  },

  setTrack: (ch, track) => {
    const cur = get().rows.find((r) => r.ch === ch);
    if (cur && cur.track === track) return;
    set((s) => ({
      ...pushHistory(s),
      rows: s.rows.map((r) => (r.ch === ch ? { ...r, track } : r)),
    }));
  },

  placeAt: (ch, track, beforeCh) => {
    const s = get();
    const src = s.rows.find((r) => r.ch === ch);
    if (!src) return;
    // New group ordering: everyone on the target track (ordered by the current
    // rows array), with `ch` spliced in before `beforeCh` (null = end).
    const others = s.rows.filter((r) => r.ch !== ch);
    const group = others.filter((r) => r.track === track);
    let insertIdx = beforeCh === null ? group.length : group.findIndex((r) => r.ch === beforeCh);
    if (insertIdx < 0) insertIdx = group.length;
    group.splice(insertIdx, 0, { ...src, track });
    const groupIds = new Set(group.map((r) => r.ch));
    const kept: RoutingRow[] = [];
    for (const r of s.rows) {
      if (!groupIds.has(r.ch)) kept.push(r);
    }
    const firstIdx = s.rows.findIndex((r) => groupIds.has(r.ch));
    const rows = [...kept];
    rows.splice(firstIdx < 0 ? rows.length : firstIdx, 0, ...group);
    if (JSON.stringify(rows) === JSON.stringify(s.rows)) return; // no-op
    set((st) => ({ ...pushHistory(st), rows }));
  },

  autoAssign: () => {
    set((s) => ({
      ...pushHistory(s),
      rows: s.rows.map((r) => ({ ...r, track: r.track ?? defaultTrackFor(r.ch - 1) })),
    }));
  },

  clearRouting: () => {
    set((s) => ({
      ...pushHistory(s),
      rows: s.rows.map((r) => ({ ...r, track: null })),
    }));
  },

  undo: () => {
    const { past, rows, future } = get();
    if (!past.length) return;
    const prev = past[past.length - 1];
    set({
      past: past.slice(0, -1),
      rows: prev,
      future: [rows.map((r) => ({ ...r })), ...future],
    });
  },

  redo: () => {
    const { future, rows, past } = get();
    if (!future.length) return;
    const [next, ...rest] = future;
    set({
      future: rest,
      rows: next,
      past: [...past, rows.map((r) => ({ ...r }))],
    });
  },

  setPattern: (p) => set({ pattern: p }),
  setTemplate: (t) => set({ template: t }),

  startExport: () => {
    const { takes, rows, folder } = get();
    if (!takes.length || !folder) return;
    if (useSettings.getState().settings.confirmExport) {
      const ok = window.confirm(
        `Export ${takes.length} takes to one shoot-day AAF?\n\n${rows.filter((r) => r.track).length} routed channels → ${rows.filter((r) => r.track).length * takes.length} timeline tracks.`,
      );
      if (!ok) return;
    }
    wireExportEvents();
    const settings = useSettings.getState().settings;
    const routed = rows.filter((r) => r.track);
    // One shoot day → one AAF, one timeline, time-of-day placement.
    // Every routed clip gets its own track, stacked in routing order.
    // Engine routing format (cli.py embed-aaf --routing): "chIdx:Name,..."
    const routingStr = routed.map((r) => `${r.ch - 1}:${r.track}`).join(',') || undefined;
    const timelineTracks = routed.length * takes.length;
    const base = folder.split('\\').pop() ?? folder.split('/').pop() ?? 'shoot_day';
    const outFile = `${base}.aaf`;
    const outputPath = `${settings.outputAafDir}\\${outFile}`;
    set({ exportStatus: 'running', exportLog: [], exportQueue: [outFile], exportDone: 0 });
    jobCompleteCb = () => {
      set({ exportStatus: 'done', exportDone: 1 });
      get().toast(`Export complete — 1 AAF · ${takes.length} takes · ${timelineTracks} stacked tracks`);
    };
    const config: ExportConfig = {
      inputPath: folder,
      outputPath,
      clipName: base,
      // Parity with app.js: omit flags the CLI treats as defaults.
      mode: settings.mode !== 'group' ? settings.mode : undefined,
      essence: settings.essence !== 'embedded' ? settings.essence : undefined,
      subtype: settings.bitDepth !== 'auto' ? `PCM_${settings.bitDepth}` : undefined,
      sampleRate: settings.sampleRate !== 'auto' ? settings.sampleRate : undefined,
      mxfDir: settings.essence === 'mxf'
        && settings.outputMxfDir
        && settings.outputMxfDir !== './output/mxf'
        ? settings.outputMxfDir : undefined,
      routing: routingStr,
      takeIndex: 1,
      takeCount: takes.length,
    };
    void api.exportStart(config)
      .then((res) => {
        if ('error' in res) {
          set({ exportStatus: 'error' });
          get().toast('Export failed');
        }
      })
      .catch(() => set({ exportStatus: 'error' }));
  },

  cancelExport: () => {
    set({ exportStatus: 'idle' });
    void api.exportCancel();
    get().toast('Export cancelled');
  },

  resetExport: () => set({ exportStatus: 'idle', exportLog: [], exportQueue: [], exportDone: 0 }),

  toast: (msg) => {
    if (!useSettings.getState().settings.showToasts) return;
    const id = ++toastSeq;
    set((s) => ({ toasts: [...s.toasts, { id, msg }] }));
    setTimeout(() => get().dismissToast(id), 4000);
  },

  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));

export { outPath };