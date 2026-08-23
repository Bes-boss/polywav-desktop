import { useMemo, useState } from 'react';
import { useSession } from '../store/session';
import { useSettings } from '../store/settings';
import { useUi } from '../store/ui';
import { api } from '../api/electron';
import { BatchStrip } from '../components/BatchStrip';
import { EmptyState } from '../components/EmptyState';
import { IconExport, IconCopy, IconFolder, IconX } from '../components/icons';

const ESSENCE_LABELS: Record<string, string> = {
  embedded: 'Embedded AAF',
  external: 'AAF + WAV',
  mxf: 'Avid MXF (OP-Atom)',
};
const MODE_LABELS: Record<string, string> = {
  group: 'Group Clip',
  sequence: 'Sequence',
  mixed: 'Mixed',
};

export function ExportView() {
  const session = useSession();
  const settings = useSettings((s) => s.settings);
  const setSetting = useSettings((s) => s.setSetting);
  const setTab = useUi((s) => s.setTab);
  const [exportTemplate, setExportTemplate] = useState('{show}_{episode}_{prefix}_{role}_{num}');
  const [copied, setCopied] = useState(false);

  const browseAafDir = async () => {
    const dir = await api.openDirectoryWithDefault(settings.outputAafDir);
    if (dir) setSetting('outputAafDir', dir);
  };

  const browseMxfDir = async () => {
    const dir = await api.openDirectoryWithDefault(settings.outputMxfDir);
    if (dir) setSetting('outputMxfDir', dir);
  };

  const take = session.selectedTake !== null ? session.takes[session.selectedTake] : null;
  const totalCh = session.takes.reduce((a, t) => a + t.channels, 0);
  const assigned = session.rows.filter((r) => r.track).length;
  // One shoot day → one timeline; every routed clip gets its own track.
  const timelineTracks = assigned * session.takes.length;
  const folderName = (session.folder ?? '').split('\\').pop()?.split('/').pop() ?? 'shoot_day';

  const cli = useMemo(() => {
    const t = take ?? session.takes[0];
    if (!t) return '# Load a shoot day to preview the export command';
    return [
      `polywav embed-aaf -i "${session.folder}" -o "${outPathFor(folderName, settings.outputAafDir)}" --stack --mode ${settings.mode}`,
      `# one timeline · time-of-day · ${assigned} ch × ${session.takes.length} takes → ${timelineTracks} tracks`,
    ].join('\n');
  }, [take, session.takes, assigned, settings.mode, settings.outputAafDir, session.folder, folderName, timelineTracks]);

  if (!session.folder) {
    return (
      <EmptyState
        icon={<IconExport size={30} />}
        title="Nothing to export yet"
        hint="Load a shoot-day folder, route the channels, then come back here."
        cta="Go to Home"
        onClick={() => setTab('home')}
      />
    );
  }

  const running = session.exportStatus === 'running';
  const pct = session.exportQueue.length ? Math.round((session.exportDone / session.exportQueue.length) * 100) : 0;

  const copyCli = async () => {
    try {
      await navigator.clipboard.writeText(cli);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
      session.toast('CLI copied');
    } catch {
      session.toast('Copy not available here');
    }
  };

  return (
    <>
      <BatchStrip />
      <div className="export-panel">
        <div>
          <div className="card card-enter">
            <div className="card-header"><h2>Output summary</h2><span className={`badge badge-${session.exportStatus}`}>{session.exportStatus}</span></div>
            <div className="export-summary">
              <div className="line-item"><span className="line-label">Total channels</span><span className="line-value">{totalCh}</span></div>
              <div className="line-item"><span className="line-label">Assigned to tracks</span><span className="line-value">{assigned * session.takes.length}</span></div>
              <div className="line-item"><span className="line-label">Timeline tracks (one per clip)</span><span className="line-value">{timelineTracks}</span></div>
              <div className="line-item"><span className="line-label">Structure</span><span className="line-value">{MODE_LABELS[settings.mode] ?? settings.mode}</span></div>
              <div className="line-item"><span className="line-label">Media format</span><span className="line-value">{ESSENCE_LABELS[settings.essence] ?? settings.essence}</span></div>
              <div className="line-item"><span className="line-label">Sample rate</span><span className="line-value">{settings.sampleRate === 'auto' ? 'From source' : settings.sampleRate + ' Hz'}</span></div>
              <div className="line-item"><span className="line-label">Bit depth</span><span className="line-value">{settings.bitDepth === 'auto' ? 'Auto' : settings.bitDepth + '-bit'}</span></div>
              <div className="line-item"><span className="line-label">Takes</span><span className="line-value">{session.takes.length} → 1 AAF · single timeline</span></div>
              <div className="line-item total-row"><span className="line-label">Estimated output size</span><span className="line-value">~{(totalCh * 0.03).toFixed(1)} GB</span></div>
            </div>
          </div>

          <div className="card card-enter delay-1" style={{ marginTop: 16 }}>
            <div className="card-header"><h2>Output destination</h2></div>
            <div style={{ padding: 16 }}>
              <div className="preset-field" style={{ marginBottom: 14 }}>
                <label>Output folder</label>
                <div className="out-dir-row">
                  <input type="text" value={settings.outputAafDir}
                    onChange={(e) => setSetting('outputAafDir', e.target.value)} />
                  <button className="btn btn-secondary icon-text" onClick={browseAafDir}><IconFolder size={13} /> Browse</button>
                </div>
                <div className="hint">Output file path: <strong style={{ fontFamily: 'var(--font-mono)', fontWeight: 500 }}>{outPathFor(folderName, settings.outputAafDir)}</strong></div>
              </div>
              <div className="preset-field">
                <label>MXF folder</label>
                <div className="out-dir-row">
                  <input type="text" value={settings.outputMxfDir}
                    onChange={(e) => setSetting('outputMxfDir', e.target.value)} />
                  <button className="btn btn-secondary icon-text" onClick={browseMxfDir}><IconFolder size={13} /> Browse</button>
                </div>
                <div className="hint">One MXF per timeline track, placed in this folder</div>
              </div>
            </div>
          </div>

          <div className="card card-enter delay-2" style={{ marginTop: 16 }}>
            <div className="card-header"><h2>CLI command</h2><button className="btn btn-secondary icon-text" onClick={copyCli}><IconCopy size={13} /> {copied ? 'Copied' : 'Copy'}</button></div>
            <div style={{ padding: 16 }}>
              <code className="cli-code">{cli}</code>
            </div>
          </div>
        </div>

        <div>
          <div className="card card-enter delay-1">
            <div className="card-header"><h2>Export options</h2></div>
            <div style={{ padding: 16 }}>
              {(['embedded', 'external', 'mxf'] as const).map((v) => (
                <label key={v} className={`export-option${settings.essence === v ? ' selected' : ''}`}>
                  <input type="radio" checked={settings.essence === v} onChange={() => setSetting('essence', v)} />
                  <div>
                    <div className="export-label">{ESSENCE_LABELS[v]}</div>
                    <div className="export-desc">
                      {v === 'embedded' && 'Audio embedded directly in the AAF file · self-contained'}
                      {v === 'external' && 'Broadcast WAV files · AAF links externally'}
                      {v === 'mxf' && 'Standard Avid Media Composer format · 1 MXF per timeline track'}
                    </div>
                  </div>
                </label>
              ))}
            </div>
          </div>

          <div className="card card-enter delay-2" style={{ marginTop: 16 }}>
            <div className="card-header"><h2>Naming convention</h2></div>
            <div style={{ padding: 16 }}>
              <div className="preset-field" style={{ marginBottom: 12 }}>
                <label>Output template</label>
                <input type="text" value={exportTemplate} style={{ width: '100%' }}
                  onChange={(e) => setExportTemplate(e.target.value)} />
                <div className="hint">Variables: <code>{'{show}'}</code> <code>{'{episode}'}</code> <code>{'{prefix}'}</code> <code>{'{role}'}</code> <code>{'{num}'}</code></div>
              </div>
              <div style={{ fontSize: 12, color: '#888' }}>
                Preview: <strong style={{ color: 'var(--ink)', fontFamily: 'var(--font-mono)' }}>MKR_104_HST_Host_1</strong>
              </div>
            </div>
          </div>

          <div className="card card-enter delay-2" style={{ marginTop: 16 }}>
            <div className="card-header"><h2>Export log</h2><span className={`badge badge-${session.exportStatus}`}>{session.exportStatus}</span></div>
            {running && (
              <div className="export-progress"><div className="export-progress-bar" style={{ width: `${Math.max(pct, 4)}%` }} /></div>
            )}
            <div className="log-box">
              {session.exportLog.length === 0 && (
                <div style={{ color: '#888', fontStyle: 'italic' }}>
                  {session.takes.length ? `Ready to export ${session.takes.length} takes → 1 shoot-day AAF` : 'Ready to export'}
                </div>
              )}
              {session.exportQueue.length > 0 && !running && session.exportDone === 0 && (
                <div style={{ color: 'rgba(var(--ink-rgb),0.6)', marginTop: 4 }}>
                  Queue: {session.exportQueue.map((n) => n.replace(/\.wav$/i, '')).join(' → ')}
                </div>
              )}
              {session.exportLog.map((l, i) => (
                <div key={i} className={l.includes('Wrote') ? 'log-ok' : undefined}>{l}</div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="export-footer">
        <button className="btn btn-secondary" style={{ marginRight: 'auto' }} onClick={() => setTab('route')}>Back to Route</button>
        {session.exportStatus === 'done' ? (
          <button className="btn btn-primary" onClick={session.resetExport}>Reset</button>
        ) : running ? (
          <button className="btn btn-danger-solid" onClick={session.cancelExport}><IconX size={14} /> Cancel export</button>
        ) : (
          <button className="btn btn-primary" onClick={session.startExport}>
            <IconExport size={15} /> Export shoot day for Avid
          </button>
        )}
      </div>
    </>
  );
}

const outPathFor = (takeName: string, dir: string) =>
  `${dir}\\${takeName.replace(/\.wav$/i, '')}.aaf`;