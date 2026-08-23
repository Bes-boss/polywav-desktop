import { useEffect, useState } from 'react';
import { useUi, type TabId } from './store/ui';
import { useSession } from './store/session';
import { api } from './api/electron';
import { HomeView } from './routes/HomeView';
import { NormalizeView } from './routes/NormalizeView';
import { RouteView } from './routes/RouteView';
import { PatchView } from './routes/PatchView';
import { ExportView } from './routes/ExportView';
import { SettingsOverlay } from './components/SettingsOverlay';
import { IngestWizard } from './components/IngestWizard';
import { ToastStack } from './components/ToastStack';
import { FABoundary } from './components/FatalBoundary';
import { HeroWaves } from './components/HeroWaves';
import {
  IconHome, IconNormalize, IconRoute, IconPatch, IconExport,
  IconGear, IconExportHeader, IconWinMin, IconWinMax, IconWinRestore, IconWinClose,
} from './components/icons';

const TABS: { id: TabId; icon: (p: { size?: number }) => React.ReactElement; label: string }[] = [
  { id: 'home', icon: IconHome, label: 'Home' },
  { id: 'normalize', icon: IconNormalize, label: 'Normalize' },
  { id: 'route', icon: IconRoute, label: 'Route' },
  { id: 'patch', icon: IconPatch, label: 'Patch' },
  { id: 'export', icon: IconExport, label: 'Export' },
];

const VIEWS: Record<TabId, () => React.ReactElement> = {
  home: () => <HomeView />,
  normalize: () => <NormalizeView />,
  route: () => <RouteView />,
  patch: () => <PatchView />,
  export: () => <ExportView />,
};

export function App() {
  const { tab, setTab, settingsOpen, wizardOpen, theme, toggleSettings } = useUi();
  const session = useSession();
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    document.body.classList.toggle('light-mode', theme === 'light');
  }, [theme]);

  useEffect(() => {
    const unsub = api.onMaximizeChange((m) => setMaximized(m));
    return unsub;
  }, []);

  // Escape closes overlays (parity with app.js settings overlay).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      const s = useUi.getState();
      if (s.wizardOpen) s.closeWizard();
      else if (s.settingsOpen) s.closeSettings();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // First-run: open the setup wizard once, like the shipping app
  // (polywav-wizard-done flag).
  useEffect(() => {
    try {
      if (!localStorage.getItem('polywav-wizard-done')) {
        useUi.getState().openWizard();
        localStorage.setItem('polywav-wizard-done', '1');
      }
    } catch { /* storage unavailable — skip first-run wizard */ }
  }, []);

  const loaded = session.folder !== null;
  const subtitle = loaded
    ? `${pathBase(session.folder ?? '')} · ${session.takes.length} polywav takes · ${chTotal(session.takes)} channels`
    : 'Ready to load';

  const Active = VIEWS[tab];

  return (
    <FABoundary>
      <HeroWaves />
      <div className="orb orb-1" />
      <div className="orb orb-2" />
      <div className="orb orb-3" />
      <div className="app-wrap">
        <div className="sticky-header">
          <div className="header-inner">
            <div className="app-header">
              <div>
                <h1><span className="dot" />Polywav Ingest</h1>
                <div className="subtitle"><strong>{loaded ? 'EP03 Shoot Day' : 'Polywav Ingest'}</strong> · {subtitle}</div>
              </div>
              <div className="header-actions">
                <div className={`status${loaded ? ' status-live' : ''}`}>
                  <span className="status-dot" />
                  <span>{loaded ? `${session.takes.length} files ready` : 'No file loaded'}</span>
                </div>
                <button className="btn-icon" onClick={() => setTab('export')} title="Go to Export">
                  <IconExportHeader />Export
                </button>
                <button className="btn-icon icon-only" onClick={toggleSettings} title="Settings" aria-label="Settings">
                  <IconGear />
                </button>
                <div className="win-row">
                  <button className="win-btn" onClick={() => api.minimizeWindow()} aria-label="Minimize"><IconWinMin /></button>
                  <button className="win-btn" onClick={() => api.maximizeWindow()} aria-label={maximized ? 'Restore' : 'Maximize'}>
                    {maximized ? <IconWinRestore /> : <IconWinMax />}
                  </button>
                  <button className="win-btn win-close" onClick={() => api.closeWindow()} aria-label="Close"><IconWinClose /></button>
                </div>
              </div>
            </div>
            <div className="tab-bar" role="tablist" aria-label="Main sections">
              {TABS.map((t) => {
                const Icon = t.icon;
                const active = tab === t.id;
                return (
                  <span key={t.id} className={`tab${active ? ' active' : ''}`}
                    role="tab" aria-selected={active} onClick={() => setTab(t.id)}>
                    <span className={`tab-icon${active ? ' lit' : ''}`}><Icon size={15} /></span>
                    {t.label}
                    {active && <span className="tab-underline" />}
                  </span>
                );
              })}
            </div>
          </div>
        </div>

        <main key={tab} className="view-enter">
          <Active />
        </main>
      </div>

      <ToastStack />
      {settingsOpen && <SettingsOverlay />}
      {wizardOpen && <IngestWizard />}
    </FABoundary>
  );
}

const pathBase = (p: string) => p.split('\\').pop()?.split('/').pop() ?? p;
const chTotal = (takes: { channels: number }[]) => takes.reduce((a, t) => a + t.channels, 0);