import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { rawThemeStorage } from './settings';

export type TabId = 'home' | 'normalize' | 'route' | 'patch' | 'export';

interface UiState {
  tab: TabId;
  settingsOpen: boolean;
  wizardOpen: boolean;
  wizardStep: number;
  theme: 'dark' | 'light';
  setTab: (t: TabId) => void;
  toggleSettings: () => void;
  openSettings: () => void;
  closeSettings: () => void;
  openWizard: () => void;
  closeWizard: () => void;
  setWizardStep: (s: number) => void;
  setTheme: (t: 'dark' | 'light') => void;
  toggleTheme: () => void;
}

export const useUi = create<UiState>()(
  persist(
    (set, get) => ({
      tab: 'home',
      settingsOpen: false,
      wizardOpen: false,
      wizardStep: 0,
      theme: 'dark',
      setTab: (tab) => set({ tab }),
      openSettings: () => set({ settingsOpen: true }),
      closeSettings: () => set({ settingsOpen: false }),
      openWizard: () => set({ wizardOpen: true, wizardStep: 0 }),
      closeWizard: () => set({ wizardOpen: false }),
      setWizardStep: (wizardStep) => set({ wizardStep }),
      toggleSettings: () => set((s) => ({ settingsOpen: !s.settingsOpen })),
      setTheme: (theme) => set({ theme }),
      toggleTheme: () => set({ theme: get().theme === 'dark' ? 'light' : 'dark' }),
    }),
    {
      // Theme follows the shipping app's key + bare-string format so switching
      // shells keeps it (rawThemeStorage adapter).
      name: 'polywav-theme',
      storage: createJSONStorage(() => rawThemeStorage),
      partialize: (s) => ({ theme: s.theme }),
      version: 1,
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as { theme?: 'dark' | 'light' };
        return { ...current, theme: p.theme === 'light' ? 'light' : 'dark' };
      },
      migrate: (persisted) => persisted as never,
    },
  ),
);