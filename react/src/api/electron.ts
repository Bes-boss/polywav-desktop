// ============================================================
// api/electron.ts — typed wrapper over window.electronAPI
// REACT-MIGRATION.md §4 contract: promise-returning methods,
// every on* subscription returns an unsubscribe closure.
//
// Outside Electron (plain browser / vite preview), MockBridge
// implements the same surface so screens are fully demoable.
// ============================================================

export interface ProbeResult {
  file: string;
  channels: number;
  sampleRate: number;
  frames: number;
  format: string;
  channelNames: string[];
  bitDepth: number;
  error?: string;
}

export interface PresetEntry { file: string; tier: 'bundled' | 'user'; stem: string; text: string; }
export interface PresetListResult { bundled: PresetEntry[]; user: PresetEntry[]; }
export interface ExportConfig {
  clipName?: string;
  routing?: string;
  mode?: string;
  sampleRate?: string;
  subtype?: string;
  essence?: string;
  mxfDir?: string;
  inputPath: string;
  outputPath: string;
  takeIndex?: number;
  takeCount?: number;
}

export interface ListWavsResult { wavs: string[]; error?: string; }
export interface ExportProgress { jobId: string; line: string; }
export interface ExportComplete { jobId: string; outputPath: string; stdout: string; }
export interface ExportError { jobId: string; message: string; stderr: string; }
export interface ExportCancelled { jobId: string; }

export interface PresetSaveResult { ok: boolean; exists?: boolean; file?: string; overwritten?: boolean; }
export interface PresetExportResult { ok: boolean; canceled?: boolean; path?: string; }
export interface PresetImportResult { ok: boolean; canceled?: boolean; path?: string; base?: string; text?: string; }

export interface ElectronApi {
  minimizeWindow(): void;
  maximizeWindow(): void;
  closeWindow(): void;
  onMaximizeChange(cb: (m: boolean) => void): () => void;

  openDirectory(): Promise<string | null>;
  openDirectoryWithDefault(path: string): Promise<string | null>;
  openFile(): Promise<string | null>;
  pathForFile(file: unknown): string;
  listWavs(dir: string): Promise<ListWavsResult>;

  presetsList(): Promise<PresetListResult>;
  presetsRead(stem: string): Promise<{ stem: string; tier: 'user' | 'bundled'; text: string }>;
  presetsSave(payload: { name: string; yamlText: string; force?: boolean }): Promise<PresetSaveResult>;
  presetsDelete(stem: string): Promise<{ ok: boolean }>;
  presetsExport(payload: { defaultName?: string; yamlText: string }): Promise<PresetExportResult>;
  presetsImportOpen(): Promise<PresetImportResult>;

  probeFile(path: string): Promise<ProbeResult>;
  readFileHeader(path: string): Promise<Record<string, unknown>>;

  exportStart(config: ExportConfig): Promise<{ jobId: string } | { error: string }>;
  exportCancel(): Promise<{ ok: boolean; error?: string }>;
  onExportProgress(cb: (d: ExportProgress) => void): () => void;
  onExportComplete(cb: (r: ExportComplete) => void): () => void;
  onExportError(cb: (e: ExportError) => void): () => void;
  onExportCancelled(cb: (d: ExportCancelled) => void): () => void;
}

declare global {
  interface Window { electronAPI?: Record<string, unknown>; }
}

const real = window.electronAPI;

function realApi(): ElectronApi | null {
  if (!real || typeof real !== 'object') return null;
  const fn = (k: string) => real[k];
  const has = (k: string): k is keyof typeof real => typeof real[k] === 'function';
  if (!has('probeFile') || !has('presetsList')) return null;

  const call = <A extends unknown[], R>(k: string) => fn(k) as (...a: A) => R;

  return {
    minimizeWindow: () => call<[], void>('minimizeWindow')(),
    maximizeWindow: () => call<[], void>('maximizeWindow')(),
    closeWindow: () => call<[], void>('closeWindow')(),
    onMaximizeChange: (cb) => {
      const un = call<[(m: boolean) => void], (() => void) | void>('onMaximizeChange')(cb);
      return un ?? (() => {});
    },
    openDirectory: () => call<[], Promise<string | null>>('openDirectory')(),
    openDirectoryWithDefault: (path) => call<[string], Promise<string | null>>('openDirectoryWithDefault')(path),
    openFile: () => call<[], Promise<string | null>>('openFile')(),
    pathForFile: (file) => call<[unknown], string>('pathForFile')(file),
    listWavs: (dir) => call<[string], Promise<ListWavsResult>>('listWavs')(dir),
    presetsList: () => call<[], Promise<PresetListResult>>('presetsList')(),
    presetsRead: (stem) => call<[string], Promise<{ stem: string; tier: 'user' | 'bundled'; text: string }>>('presetsRead')(stem),
    presetsSave: (payload) => call<[{ name: string; yamlText: string; force?: boolean }], Promise<PresetSaveResult>>('presetsSave')(payload),
    presetsDelete: (stem) => call<[string], Promise<{ ok: boolean }>>('presetsDelete')(stem),
    presetsExport: (payload) => call<[{ defaultName?: string; yamlText: string }], Promise<PresetExportResult>>('presetsExport')(payload),
    presetsImportOpen: () => call<[], Promise<PresetImportResult>>('presetsImportOpen')(),
    probeFile: (p) => call<[string], Promise<ProbeResult>>('probeFile')(p),
    readFileHeader: (p) => call<[string], Promise<Record<string, unknown>>>('readFileHeader')(p),
    exportStart: (config) => call<[ExportConfig], Promise<{ jobId: string } | { error: string }>>('exportStart')(config),
    exportCancel: () => call<[], Promise<{ ok: boolean; error?: string }>>('exportCancel')(),
    onExportProgress: (cb) => {
      const un = call<[(d: ExportProgress) => void], (() => void) | void>('onExportProgress')(cb);
      return un ?? (() => {});
    },
    onExportComplete: (cb) => {
      const un = call<[(r: ExportComplete) => void], (() => void) | void>('onExportComplete')(cb);
      return un ?? (() => {});
    },
    onExportError: (cb) => {
      const un = call<[(e: ExportError) => void], (() => void) | void>('onExportError')(cb);
      return un ?? (() => {});
    },
    onExportCancelled: (cb) => {
      const un = call<[(d: ExportCancelled) => void], (() => void) | void>('onExportCancelled')(cb);
      return un ?? (() => {});
    },
  };
}

// ============================================================
// MockBridge — browser-only stand-in (vite dev/preview, screenshots)
// ============================================================
const mockPresets: PresetEntry[] = [
  { file: 'mkr.yaml', tier: 'bundled', stem: 'mkr', text: 'name: Masterchef Kitchens (MKR)\nnaming: "{prefix}_{role}_{num}"\nrouting:\n  group: A1-A8\n' },
];
let mockProgressCb: ((d: ExportProgress) => void) | null = null;
let mockCompleteCb: ((r: ExportComplete) => void) | null = null;

function mockBridge(): ElectronApi {
  return {
    minimizeWindow: () => {},
    maximizeWindow: () => {},
    closeWindow: () => {},
    onMaximizeChange: () => () => {},
    openDirectory: async () => 'D:\\shoots\\EP03\\audio',
    openDirectoryWithDefault: async () => 'D:\\shoots\\EP03\\audio',
    openFile: async () => 'D:\\shoots\\EP03\\audio\\EP03_S1_T01.WAV',
    pathForFile: (file) => (file as { path?: string } | undefined)?.path ?? '',
    listWavs: async () => ({ wavs: DEMO_WAV_NAMES }),
    presetsList: async () => ({ bundled: mockPresets, user: [] }),
    presetsRead: async (stem) => ({ stem, tier: 'bundled', text: mockPresets[0]?.text ?? '' }),
    presetsSave: async (payload) => ({ ok: true, file: payload.name.toLowerCase().replace(/[^a-z0-9]+/g, '_') + '.yaml' }),
    presetsDelete: async () => ({ ok: false }),
    presetsExport: async () => ({ ok: false, canceled: true }),
    presetsImportOpen: async () => ({ ok: false, canceled: true }),
    probeFile: async (path) => {
      const ch = path.toLowerCase().includes('t06') ? 94 : 14;
      const names: string[] = [];
      for (let i = 1; i <= ch; i++) names.push(`CH${String(i).padStart(2, '0')}`);
      return { file: path, channels: ch, sampleRate: 48000, frames: 0, format: 'WAV / PCM_16', channelNames: names, bitDepth: 16 };
    },
    readFileHeader: async () => ({ channels: 14, sampleRate: 48000, bitsPerSample: 16, frames: 0, format: 'WAV / PCM_16' }),
    exportStart: async (config) => {
      const lines = [
        `[export] building single shoot-day timeline from ${config.inputPath}`,
        `[export] ${config.takeCount} takes · time-of-day placement · ${config.routing}`,
        '[export] stacking clips by routing order — one track per clip',
        '[export] writing OP-Atom media',
        `Wrote AAF: ${config.outputPath}`,
      ];
      lines.forEach((line, i) => setTimeout(() => mockProgressCb?.({ jobId: 'current', line }), 120 * (i + 1)));
      setTimeout(() => mockCompleteCb?.({ jobId: 'current', outputPath: config.outputPath, stdout: lines.join('\n') }), 120 * (lines.length + 1));
      return { jobId: 'current' };
    },
    exportCancel: async () => ({ ok: true }),
    onExportProgress: (cb) => { mockProgressCb = cb; return () => { mockProgressCb = null; }; },
    onExportComplete: (cb) => { mockCompleteCb = cb; return () => { mockCompleteCb = null; }; },
    onExportError: () => () => {},
    onExportCancelled: () => () => {},
  };
}

export const realBridge = realApi();
export const api: ElectronApi = realBridge ?? mockBridge();
/** True when running inside the Electron shell (real IPC available). */
export const IS_REAL = realBridge !== null;

const DEMO_WAV_NAMES = [
  'EP03_S1_T01.WAV', 'EP03_S1_T02.WAV', 'EP03_S1_T03.WAV', 'EP03_S1_T04.WAV',
  'EP03_S1_T05.WAV', 'EP03_S1_T06_MIX.WAV',
];