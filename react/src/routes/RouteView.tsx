import { useEffect } from 'react';
import { useSession } from '../store/session';
import { useSettings } from '../store/settings';
import { useUi } from '../store/ui';
import { DEMO_GROUPS, groupForTrack } from '../data/demo';
import { BatchStrip } from '../components/BatchStrip';
import { EmptyState } from '../components/EmptyState';
import { IconGrip, IconUndo, IconRedo, IconPlus, IconRoute, IconExport, IconChevronUp, IconChevronDown } from '../components/icons';

const AO_OPTS = Array.from({ length: 64 }, (_, i) => `A${i + 1}`);

export function RouteView() {
  const session = useSession();
  const settings = useSettings((s) => s.settings);
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
        icon={<IconRoute size={30} />}
        title="Nothing routed yet"
        hint="Load a shoot-day folder, then route its channels to Avid tracks here."
        cta="Go to Home"
        onClick={() => setTab('home')}
      />
    );
  }

  const assigned = session.rows.filter((r) => r.track).length;
  const take = session.selectedTake !== null ? session.takes[session.selectedTake] : null;
  const canUndo = session.past.length > 0;
  const canRedo = session.future.length > 0;

  const groups = DEMO_GROUPS.filter((g) =>
    g.tracks.some((t) => session.rows.some((r) => r.track === t)),
  );
  const byTrack = new Map<string, string[]>();
  session.rows.filter((r) => r.track).forEach((r) => {
    const t = r.track as string;
    if (!byTrack.has(t)) byTrack.set(t, []);
    byTrack.get(t)!.push(r.name);
  });
  const trackList = [...byTrack.entries()].map(([track, names]) => ({
    track, label: `${track} · ${names.join(', ')}`, count: names.length,
  }));
  const unassignedCount = session.rows.length - assigned;

  return (
    <>
      <BatchStrip />
      <div className="route-layout">
        <div className="card card-enter">
          <div className="card-header">
            <h2>
              Source channels{' '}
              <span className="tpl-note">
                {take ? `${take.id} · ${take.channels} ch × ${session.takes.length} takes` : ''}
              </span>
            </h2>
            <div className="card-actions">
              <button className="btn small" onClick={session.autoAssign} title="Auto-assign unassigned channels">Auto-assign</button>
              <button className="btn small" onClick={session.clearRouting} title="Clear all assignments">Clear</button>
              <span className="badge">{session.rows.length}</span>
            </div>
          </div>
          <div className="card-body-scroll">
            <table className="routing-table">
              <thead>
                <tr>
                  <th style={{ width: 28 }} />
                  <th style={{ width: 44 }}>#</th>
                  <th>Channel <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0, color: '#999' }}>(normalized)</span></th>
                  <th style={{ minWidth: 160 }}>Avid track</th>
                  <th>
                    Track name<span className="stack-hint" title="Channels sharing a track stack in this order into the AAF timeline">stack order ▼</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {session.rows.map((r) => {
                  const grp = groupForTrack(r.track);
                  const stack = r.track
                    ? session.rows.filter((x) => x.track === r.track)
                    : [];
                  const idx = stack.findIndex((x) => x.ch === r.ch);
                  return (
                    <tr key={r.ch} className={r.track ? undefined : 'row-dim'}>
                      <td className="drag-handle"><IconGrip size={13} /></td>
                      <td className="ch-num">{String(r.ch).padStart(2, '0')}</td>
                      <td className="ch-name">
                        {r.name}
                        {settings.showRawBext && <span className="bext-tag">{r.bext}</span>}
                      </td>
                      <td>
                        <select
                          className={`track-select${r.track ? ' assigned' : ''}`}
                          value={r.track ?? ''}
                          onChange={(e) => session.setTrack(r.ch, e.target.value || null)}
                        >
                          <option value="">— Unassigned —</option>
                          {AO_OPTS.map((a) => <option key={a} value={a}>{a}</option>)}
                        </select>
                      </td>
                      <td className="track-preview">
                        {r.track ? (
                          <span className="stack-cell">
                            {stack.length > 1 && (
                              <span className="stack-btns" title="Stacking order into the AAF timeline (one track per clip)">
                                <button className="stack-btn" disabled={idx === 0}
                                  onClick={() => session.placeAt(r.ch, r.track, stack[idx - 1]?.ch ?? null)}
                                  aria-label={`Move ${r.name} up the ${r.track} stack`}><IconChevronUp size={11} /></button>
                                <button className="stack-btn" disabled={idx === stack.length - 1}
                                  onClick={() => session.placeAt(r.ch, r.track, stack[idx + 2]?.ch ?? null)}
                                  aria-label={`Move ${r.name} down the ${r.track} stack`}><IconChevronDown size={11} /></button>
                              </span>
                            )}
                            {r.track}{grp ? <span className="grp">{grp.name}</span> : null}
                          </span>
                        ) : <span className="unassigned">—</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        <div className="card card-enter delay-1">
          <div className="card-header"><h2>Track layout</h2><span className="badge">{trackList.length} tracks</span></div>
          <ul className="summary-list">
            {groups.map((g) => (
              <li key={g.name} className="summary-group-header">
                <span className="grp-dot" style={{ background: g.color }} />{g.name}
              </li>
            ))}
            {trackList.map((t) => (
              <li key={t.track}>
                <span className="track-label">{t.label}</span>
                <span className="track-count">{t.count} ch</span>
              </li>
            ))}
            {unassignedCount > 0 && (
              <>
                <li className="summary-group-header" style={{ color: '#888' }}>Unassigned</li>
                <li>
                  <span className="track-label" style={{ color: '#999' }}>Unassigned channels</span>
                  <span className="track-count">{unassignedCount} ch</span>
                </li>
              </>
            )}
          </ul>
        </div>
      </div>

      <div className="bottom-bar">
        <div className="info">
          <strong>{assigned}</strong> of <strong>{session.rows.length}</strong> channels assigned ·{' '}
          Structure: <strong>{settings.mode === 'group' ? 'Group Clip' : settings.mode}</strong> ·{' '}
          Media: <strong>{settings.essence === 'embedded' ? 'Embedded in AAF' : settings.essence}</strong> ·{' '}
          <span className="tpl">{session.takes.length} takes → 1 AAF · single timeline</span>
        </div>
        <div className="btn-row">
          <button className={`btn-undo${canUndo ? ' enabled' : ''}`} disabled={!canUndo} onClick={session.undo} title="Undo (Ctrl+Z)"><IconUndo size={13} /> Undo</button>
          <button className={`btn-redo${canRedo ? ' enabled' : ''}`} disabled={!canRedo} onClick={session.redo} title="Redo (Ctrl+Shift+Z)"><IconRedo size={13} /> Redo</button>
          <button className="btn btn-secondary" onClick={() => session.toast('Import another polywav (batch folder)')}><IconPlus size={14} /> Import</button>
          <button className="btn btn-primary" onClick={() => setTab('export')}><IconExport size={15} /> Export for Avid</button>
        </div>
      </div>
    </>
  );
}