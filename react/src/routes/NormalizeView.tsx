import { useMemo, useState } from 'react';
import { useSession } from '../store/session';
import { applyTemplate, parseName } from '../lib/normalize';
import { BatchStrip } from '../components/BatchStrip';
import { EmptyState } from '../components/EmptyState';
import { IconNormalize, IconWand, IconX } from '../components/icons';
import { useUi } from '../store/ui';

const PARTS = [
  { key: 'PREFIX', token: '{prefix}', label: 'Prefix' },
  { key: 'ROLE', token: '{role}', label: 'Role' },
  { key: 'NUM', token: '{num:02d}', label: '# (0-pad)' },
  { key: 'NUM', token: '{num}', label: '# (raw)' },
  { key: 'SIDE', token: '{side}', label: 'Side' },
];

export function NormalizeView() {
  const { pattern, template, setPattern, setTemplate, rows } = useSession();
  const setTab = useUi((s) => s.setTab);
  const [testRaw, setTestRaw] = useState('MRK_Host_1');
  const [draggedIdx, setDraggedIdx] = useState<number | null>(null);

  const testCaps = useMemo(() => parseName(testRaw, pattern), [testRaw, pattern]);
  const testOut = useMemo(() => applyTemplate(testCaps, template), [testCaps, template]);

  const parts: { token: string; key: string }[] = useMemo(() => {
    const found: { token: string; key: string }[] = [];
    for (const part of PARTS) {
      if (template.includes(part.token)) found.push(part);
    }
    return found;
  }, [template]);

  if (!rows.length) {
    return (
      <EmptyState
        icon={<IconNormalize size={30} />}
        title="No channels to normalize"
        hint="Load a shoot-day folder first — the naming pattern and template will apply to every take."
        cta="Go to Home"
        onClick={() => setTab('home')}
      />
    );
  }

  const cyclePart = (idx: number) => {
    const cur = parts[idx];
    const candidates = PARTS.filter((p) => p.token === cur.token || p.key === cur.key || (cur.token === '{num}' && p.token === '{num:02d}'));
    const alt = candidates.find((c) => c.token !== cur.token);
    if (!alt) return;
    setTemplate(template.replace(cur.token, alt.token));
  };

  const removePart = (idx: number) => {
    const cur = parts[idx];
    setTemplate(template.replace(cur.token, '').replace(/_{2,}/g, '_').replace(/^_+|_+$/g, ''));
  };

  const onDropPart = (targetIdx: number) => {
    if (draggedIdx === null || draggedIdx === targetIdx) return;
    const next = [...parts];
    const [moved] = next.splice(draggedIdx, 1);
    next.splice(targetIdx, 0, moved);
    setTemplate(next.map((p) => p.token).join('_'));
    setDraggedIdx(null);
  };

  return (
    <>
      <BatchStrip />
      <div className="preset-panel">
        <div className="preset-field">
          <label>Naming pattern</label>
          <input type="text" value={pattern} onChange={(e) => setPattern(e.target.value)}
            spellCheck={false} data-wire="parse-pattern" />
          <div className="hint">Use <code>{'(?<name>...)'}</code> to extract parts from the channel name</div>
        </div>
        <div className="preset-field">
          <label>Output template</label>
          <div className="template-chips">
            {parts.map((p, i) => (
              <span
                key={`${p.token}-${i}`}
                className={`tpl-chip${draggedIdx === i ? ' dragging' : ''}`}
                draggable
                onDragStart={() => setDraggedIdx(i)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => { e.preventDefault(); onDropPart(i); }}
                onClick={() => cyclePart(i)}
                title="Click to cycle · Drag to reorder"
              >
                <span className="chip-key">{p.key}</span>{p.token}
                <button className="chip-x" onClick={() => removePart(i)} aria-label={`Remove ${p.key}`}><IconX size={10} /></button>
              </span>
            ))}
            {parts.length === 0 && <span className="tpl-chip empty">+ add a part</span>}
          </div>
          <div className="hint">Click a chip to cycle its format · Drag to reorder · <code>{'{num:02d}'}</code> for zero-pad</div>
        </div>
      </div>

      <div className="card card-enter">
        <div className="card-header"><h2>Normalization preview</h2><span className="badge">{rows.length}</span></div>
        <div className="card-body parse-table-wrap">
          <table className="parse-table">
            <thead>
              <tr>
                <th style={{ width: 44 }}>#</th><th>Raw channel</th>
                <th style={{ minWidth: 80 }}>Prefix</th><th style={{ minWidth: 80 }}>Type</th>
                <th style={{ minWidth: 80 }}>Role</th><th style={{ minWidth: 50 }}>#</th>
                <th>Suffix</th><th>Normalized name</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const caps = parseName(r.raw, pattern);
                const out = applyTemplate(caps, template) || r.name;
                return (
                  <tr key={r.ch}>
                    <td>{String(r.ch).padStart(2, '0')}</td>
                    <td className="raw-name">{r.raw}</td>
                    <td className="capture-group cap-prefix">{caps.prefix}</td>
                    <td>{caps.type}</td>
                    <td className="capture-group cap-role">{caps.role}</td>
                    <td className="capture-group cap-num">{caps.num}</td>
                    <td className="capture-group cap-suffix">{caps.suffix}</td>
                    <td className="normalized">{out}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="test-rename">
        <label><IconWand size={13} /> Test rename</label>
        <input type="text" value={testRaw} onChange={(e) => setTestRaw(e.target.value)} placeholder="Type a channel name..." />
        <span style={{ color: '#bbb', fontSize: 12 }}>→</span>
        <span className="test-result">{testOut || testRaw}</span>
      </div>
    </>
  );
}