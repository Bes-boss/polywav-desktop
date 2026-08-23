import { create } from 'zustand';
import { createJSONStorage, persist, type StateStorage } from 'zustand/middleware';

// REACT-MIGRATION.md §3: exact keys/types/defaults mirrored from app.js
// DEFAULT_SETTINGS. Persisted to localStorage['polywav-settings'].
export interface Settings {
  mode: 'group' | 'sequence' | 'mixed';
  essence: 'embedded' | 'external' | 'mxf';
  sampleRate: 'auto' | '48000' | '96000' | '192000';
  bitDepth: 'auto' | '16' | '24' | '32';
  presetName: string;
  namingTemplate: string;
  mixGain: number;
  outputAafDir: string;
  outputMxfDir: string;
  showRawBext: boolean;
  autoAssign: boolean;
  showToasts: boolean;
  confirmExport: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  mode: 'group',
  essence: 'embedded',
  sampleRate: 'auto',
  bitDepth: '24',
  presetName: 'Masterchef Kitchens (MKR)',
  namingTemplate: '{prefix}_{role}_{num}',
  mixGain: -3,
  outputAafDir: './output',
  outputMxfDir: './output/mxf',
  showRawBext: true,
  autoAssign: true,
  showToasts: true,
  confirmExport: true,
};

export const SETTINGS_KEY = 'polywav-settings';

// ---- Cross-shell storage formats (parity with app.js) ----
// zustand persist normally writes an envelope {"state":…,"version":1} under the
// key. The shipping app writes BARE values under the same keys (settings object,
// recents array, theme string), so React must write the same bytes or a user
// switching shells loses state. These adapters unwrap persist's envelope to the
// shipping format on write and accept BOTH formats on read.
const envelope = (state: unknown) => JSON.stringify({ state, version: 1 });

export const rawSettingsStorage: StateStorage = {
  getItem: (name) => {
    try {
      const raw = localStorage.getItem(name);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      const hasState = parsed && typeof parsed === 'object' && 'state' in parsed;
      const s = hasState ? (parsed as { state: unknown }).state : parsed;
      const settings = s && typeof s === 'object' && 'settings' in (s as object)
        ? (s as { settings: unknown }).settings : s;
      return settings && typeof settings === 'object' ? envelope({ settings }) : null;
    } catch {
      return null;
    }
  },
  setItem: (name, value) => {
    try {
      const settings = JSON.parse(value)?.state?.settings;
      if (settings && typeof settings === 'object') localStorage.setItem(name, JSON.stringify(settings));
    } catch { /* ignore */ }
  },
  removeItem: (name) => {
    try { localStorage.removeItem(name); } catch { /* ignore */ }
  },
};

export const rawRecentsStorage: StateStorage = {
  getItem: (name) => {
    try {
      const raw = localStorage.getItem(name);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      const list = Array.isArray(parsed) ? parsed : (parsed as { state?: { recents?: unknown } })?.state?.recents;
      return Array.isArray(list) ? envelope({ recents: list }) : null;
    } catch {
      return null;
    }
  },
  setItem: (name, value) => {
    try {
      const list = JSON.parse(value)?.state?.recents;
      if (Array.isArray(list)) localStorage.setItem(name, JSON.stringify(list));
    } catch { /* ignore */ }
  },
  removeItem: (name) => {
    try { localStorage.removeItem(name); } catch { /* ignore */ }
  },
};

export const rawThemeStorage: StateStorage = {
  getItem: (name) => {
    try {
      const raw = localStorage.getItem(name);
      if (!raw) return null;
      let theme: unknown = null;
      try {
        theme = JSON.parse(raw)?.state?.theme;
      } catch {
        theme = raw; // shipping app: bare 'dark' | 'light' string
      }
      return theme === 'light' || theme === 'dark' ? envelope({ theme }) : null;
    } catch {
      return null;
    }
  },
  setItem: (name, value) => {
    try {
      const theme = JSON.parse(value)?.state?.theme;
      if (theme === 'light' || theme === 'dark') localStorage.setItem(name, theme);
    } catch { /* ignore */ }
  },
  removeItem: (name) => {
    try { localStorage.removeItem(name); } catch { /* ignore */ }
  },
};

interface SettingsState {
  settings: Settings;
  setSetting: <K extends keyof Settings>(key: K, value: Settings[K]) => void;
  setSettings: (patch: Partial<Settings>) => void;
}

export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({
      settings: { ...DEFAULT_SETTINGS },
      setSetting: (key, value) =>
        set((s) => ({ settings: { ...s.settings, [key]: value } })),
      setSettings: (patch) =>
        set((s) => ({ settings: { ...s.settings, ...patch } })),
    }),
    {
      name: SETTINGS_KEY,
      storage: createJSONStorage(() => rawSettingsStorage),
      // Contract: merge saved over defaults, unknown keys dropped.
      merge: (persisted, current) => {
        const p = ((persisted as { settings?: Partial<Settings> } | null)?.settings ?? {}) as Partial<Settings>;
        const out = { ...current.settings };
        (Object.keys(DEFAULT_SETTINGS) as (keyof Settings)[]).forEach((k) => {
          if (typeof p[k] !== 'undefined' && p[k] !== null) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (out as Record<string, unknown>)[k] = p[k];
          }
        });
        return { ...current, settings: out };
      },
      migrate: (persisted) => persisted as never,
    },
  ),
);

export interface RecentEntry { name: string; path: string; }

// NOTE: shipping app writes 'polywav-recent' (singular, app.js RECENT_KEY).
// REACT-MIGRATION.md said 'polywav-recents'; shipping code wins so a user
// switching shells keeps their recent folders.
export const RECENTS_KEY = 'polywav-recent';

interface RecentsState {
  recents: RecentEntry[];
  addRecent: (entry: RecentEntry) => void;
  clearRecents: () => void;
}

export const useRecents = create<RecentsState>()(
  persist(
    (set) => ({
      recents: [],
      addRecent: (entry) =>
        set((s) => ({
          recents: [entry, ...s.recents.filter((r) => r.path !== entry.path)].slice(0, 10),
        })),
      clearRecents: () => set({ recents: [] }),
    }),
        { name: RECENTS_KEY, version: 1, storage: createJSONStorage(() => rawRecentsStorage), migrate: (persisted) => persisted as never },
  ),
);