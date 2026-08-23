import { useEffect, useState } from 'react';
import { useUi } from '../store/ui';
import { useSettings, type Settings } from '../store/settings';
import { useSession } from '../store/session';
import { api, type PresetEntry, type PresetListResult } from '../api/electron';
import { IconGear, IconX } from './icons';

export function SettingsOverlay() {
  const { toggleSettings, theme, setTheme } = useUi();
  const { settings, setSettings } = useSettings();
  const toast = useSession((s) => s.toast);
  const [draft, setDraft] = useState<Settings>({ ...settings });
  const [presets, setPresets] = useState<{ value: string; label: string; tier: string }[]>([]);
  const [presetName, setPresetName] = useState('');

  useEffect(() => {
    loadPresets();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadPresets = () => {
    void api.presetsList().then((r: PresetListResult) => {
      // Display the YAML 'name:' like the shipping app; option value = stem.
      // Files have CRLF endings -> use multiline match + trim.
      const label = (p: PresetEntry) => {
        try {
          const m = /^\s*name:\s*(.+)$/m.exec(p.text);
          return (m?.[1] ?? p.stem).trim().replace(/^["']|["']$/g, '');
        } catch { return p.stem; }
      };
      setPresets([
        ...r.bundled.map((p) => ({ value: p.stem, label: label(p), tier: 'Built-in' })),
        ...r.user.map((p) => ({ value: p.stem, label: label(p), tier: 'My presets' })),
      ]);
    });
  };

  const d = (patch: Partial<Settings>) => setDraft((s) => ({ ...s, ...patch }));

  const apply = () => {
    setSettings(draft);
    toast('Settings applied');
    toggleSettings();
  };

  const savePreset = () => {
    void api.presetsSave({ name: presetName || 'untitled', yamlText: yamlOf(draft) })
      .then((r) => {
        toast(r.ok ? `Preset saved (${r.file})` : r.exists ? 'Preset already exists — choose another name' : 'Preset save failed');
        loadPresets();
      })
      .catch(() => toast('Preset save failed'));
  };

  const exportPreset = () => {
    void api.presetsExport({ defaultName: (presetName || 'preset') + '.yaml', yamlText: yamlOf(draft) })
      .then((r) => { if (r.ok) toast('Preset exported'); else if (!r.canceled) toast('Preset export failed'); })
      .catch(() => toast('Preset export failed'));
  };

  const importPreset = () => {
    void api.presetsImportOpen()
      .then(async (r) => {
        if (!r.ok) { if (!r.canceled) toast('Import failed'); return; }
        await api.presetsSave({ name: r.base || 'imported', yamlText: r.text || '', force: true });
        toast(`Imported preset "${r.base}"`);
        loadPresets();
      })
      .catch(() => toast('Import failed'));
  };

  const deletePreset = () => {
    const stem = (presetName || draft.presetName || '').trim();
    if (!stem) { toast('Type a preset name to delete'); return; }
    void api.presetsDelete(stem)
      .then((r) => { if (r.ok) { toast(`Deleted preset "${stem}"`); loadPresets(); } else toast('Delete failed'); })
      .catch((e) => toast('Delete failed: ' + ((e as Error).message ?? e)));
  };

  return (
    <div className="overlay open" role="dialog" aria-modal="true" aria-labelledby="settingsTitle">
      <div className="settings-panel">
        <div className="settings-header">
          <h2 id="settingsTitle"><IconGear size={16} /> Settings</h2>
          <button className="settings-close" onClick={toggleSettings} aria-label="Close settings"><IconX size={14} /></button>
        </div>

        <div className="settings-section">
          <h3><span className="section-icon">●</span>Appearance</h3>
          <div className="setting-row" style={{ borderBottom: 'none' }}>
            <div className="setting-info">
              <div className="setting-label">Theme</div>
              <div className="setting-desc">Switch between dark and light mode</div>
            </div>
            <div className="setting-control">
              <div className="segmented">
                <button className={`seg-option${theme === 'dark' ? ' active' : ''}`} onClick={() => setTheme('dark')}>Dark</button>
                <button className={`seg-option${theme === 'light' ? ' active' : ''}`} onClick={() => setTheme('light')}>Light</button>
              </div>
            </div>
          </div>
        </div>

        <div className="settings-section">
          <h3><span className="section-icon">●</span>Export Mode</h3>
          <div className="setting-row">
            <div className="setting-info">
              <div className="setting-label">Output structure</div>
              <div className="setting-desc">How multiple source channels map to output tracks</div>
            </div>
            <div className="setting-control">
              <div className="segmented">
                {(['group', 'sequence', 'mixed'] as const).map((m) => (
                  <button key={m} className={`seg-option${draft.mode === m ? ' active' : ''}`} onClick={() => d({ mode: m })}>
                    {m === 'group' ? 'Group Clip' : m === 'sequence' ? 'Sequence' : 'Mixed'}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <div className="setting-row">
            <div className="setting-info">
              <div className="setting-label">Media format</div>
              <div className="setting-desc">How audio is stored in the output</div>
            </div>
            <div className="setting-control">
              <div className="segmented">
                {(['embedded', 'external', 'mxf'] as const).map((e) => (
                  <button key={e} className={`seg-option${draft.essence === e ? ' active' : ''}`} onClick={() => d({ essence: e })}>
                    {e === 'embedded' ? 'Embedded in AAF' : e === 'external' ? 'Separate WAV files' : 'Avid MXF (OP-Atom)'}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <div className="setting-row">
            <div className="setting-info">
              <div className="setting-label">Sample rate</div>
              <div className="setting-desc">Output sample rate</div>
            </div>
            <div className="setting-control">
              <select value={draft.sampleRate} onChange={(e) => d({ sampleRate: e.target.value as Settings['sampleRate'] })}>
                <option value="auto">Auto (from source)</option>
                <option value="48000">48000 Hz</option>
                <option value="96000">96000 Hz</option>
                <option value="192000">192000 Hz</option>
              </select>
            </div>
          </div>
          <div className="setting-row">
            <div className="setting-info">
              <div className="setting-label">Bit depth</div>
              <div className="setting-desc">Output bit depth</div>
            </div>
            <div className="setting-control">
              <select value={draft.bitDepth} onChange={(e) => d({ bitDepth: e.target.value as Settings['bitDepth'] })}>
                <option value="auto">Auto (from source)</option>
                <option value="16">16-bit PCM</option>
                <option value="24">24-bit PCM</option>
                <option value="32">32-bit float</option>
              </select>
            </div>
          </div>
        </div>

        <div className="settings-section">
          <h3><span className="section-icon">☰</span>Presets</h3>
          <div className="setting-row">
            <div className="setting-info">
              <div className="setting-label">Active preset</div>
              <div className="setting-desc">Current naming and routing configuration</div>
            </div>
            <div className="setting-control">
              <select
                value={presets.find((p) => p.label === draft.presetName)?.value ?? ''}
                onChange={(e) => {
                  const p = presets.find((x) => x.value === e.target.value);
                  d({ presetName: p?.label ?? draft.presetName });
                }}
                style={{ minWidth: 200 }}
              >
                {presets.length === 0 && <option value="">No presets</option>}
                {['Built-in', 'My presets'].map((tier) => {
                  const entries = presets.filter((p) => p.tier === tier);
                  if (!entries.length) return null;
                  return (
                    <optgroup key={tier} label={tier}>
                      {entries.map((p) => (
                        <option key={p.value} value={p.value}>{p.label}</option>
                      ))}
                    </optgroup>
                  );
                })}
              </select>
            </div>
          </div>
          <div className="setting-row">
            <div className="setting-info">
              <div className="setting-label">Manage presets</div>
              <div className="setting-desc">Save, duplicate, export, or import preset configurations</div>
            </div>
            <div className="setting-control">
              <div className="preset-actions-row">
                <input type="text" placeholder="Preset name" value={presetName} onChange={(e) => setPresetName(e.target.value)} aria-label="New preset name" />
                <button className="btn btn-secondary" onClick={savePreset}>Save</button>
                <button className="btn btn-secondary" onClick={exportPreset}>Export</button>
                <button className="btn btn-secondary" onClick={importPreset}>Import</button>
                <button className="btn btn-danger" onClick={deletePreset}>Delete</button>
              </div>
            </div>
          </div>
          <div className="setting-row">
            <div className="setting-info">
              <div className="setting-label">Default naming template</div>
              <div className="setting-desc">Pattern used when no preset naming rules apply</div>
            </div>
            <div className="setting-control">
              <input type="text" value={draft.namingTemplate} onChange={(e) => d({ namingTemplate: e.target.value })} style={{ width: 180, textAlign: 'left', fontFamily: 'var(--font-mono)' }} />
            </div>
          </div>
        </div>

        <div className="settings-section">
          <h3><span className="section-icon">✱</span>General</h3>
          <div className="setting-row">
            <div className="setting-info">
              <div className="setting-label">Show original channel names</div>
              <div className="setting-desc">Show the original recording metadata alongside renamed channels</div>
            </div>
            <div className="setting-control">
              <label className="toggle-switch">
                <input type="checkbox" checked={draft.showRawBext} onChange={(e) => d({ showRawBext: e.target.checked })} />
                <span className="toggle-slider" />
              </label>
            </div>
          </div>
          <div className="setting-row">
            <div className="setting-info">
              <div className="setting-label">Show toast notifications</div>
              <div className="setting-desc">Display operation confirmations as popup toasts</div>
            </div>
            <div className="setting-control">
              <label className="toggle-switch">
                <input type="checkbox" checked={draft.showToasts} onChange={(e) => d({ showToasts: e.target.checked })} />
                <span className="toggle-slider" />
              </label>
            </div>
          </div>
          <div className="setting-row">
            <div className="setting-info">
              <div className="setting-label">Auto-assign routing</div>
              <div className="setting-desc">Automatically route channels to tracks on load</div>
            </div>
            <div className="setting-control">
              <label className="toggle-switch">
                <input type="checkbox" checked={draft.autoAssign} onChange={(e) => d({ autoAssign: e.target.checked })} />
                <span className="toggle-slider" />
              </label>
            </div>
          </div>
          <div className="setting-row">
            <div className="setting-info">
              <div className="setting-label">Confirm before export</div>
              <div className="setting-desc">Ask for confirmation before starting an export</div>
            </div>
            <div className="setting-control">
              <label className="toggle-switch">
                <input type="checkbox" checked={draft.confirmExport} onChange={(e) => d({ confirmExport: e.target.checked })} />
                <span className="toggle-slider" />
              </label>
            </div>
          </div>
          <div className="setting-row" style={{ borderBottom: 'none' }}>
            <div className="setting-info">
              <div className="setting-label">Mix gain (dB)</div>
              <div className="setting-desc">Default gain applied to routed channels</div>
            </div>
            <div className="setting-control">
              <input type="number" value={draft.mixGain} step={0.5} min={-24} max={6} style={{ width: 90 }}
                onChange={(e) => d({ mixGain: Number(e.target.value) })} />
            </div>
          </div>
        </div>

        <div className="settings-footer">
          <span className="version">Polywav Ingest v1.0.0 · AAF OP-Atom Engine</span>
          <button className="btn-setting" onClick={() => { setDraft({ ...settings }); toggleSettings(); }}>Cancel</button>
          <button className="btn-setting btn-setting-primary" onClick={apply}>Apply</button>
        </div>
      </div>
    </div>
  );
}

function yamlOf(s: Settings): string {
  return [
    'name: ' + (s.presetName || 'untitled'),
    `mode: ${s.mode}`,
    `essence: ${s.essence}`,
    `sampleRate: ${s.sampleRate}`,
    `bitDepth: ${s.bitDepth}`,
    `namingTemplate: "${s.namingTemplate}"`,
    `mixGain: ${s.mixGain}`,
    `outputAafDir: "${s.outputAafDir}"`,
    `outputMxfDir: "${s.outputMxfDir}"`,
  ].join('\n');
}