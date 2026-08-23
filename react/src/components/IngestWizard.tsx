import { useState } from 'react';
import { useUi } from '../store/ui';
import { useSettings } from '../store/settings';
import { useSession } from '../store/session';
import { api } from '../api/electron';
import { IconSparkle, IconX, IconTV, IconCook, IconMusicNote, IconSliders } from './icons';

const STEPS = ['Template', 'Naming', 'Routing', 'Export', 'Save'];

const TEMPLATES = [
  { icon: IconTV, name: 'Panel Show', desc: 'Talk show, debate, interview — fixed panel mics' },
  { icon: IconCook, name: 'Cooking Show', desc: 'Multi-kitchen, reality — dynamic mic count, iso tracks' },
  { icon: IconMusicNote, name: 'Music', desc: 'Band, orchestra, live performance — track naming by instrument' },
  { icon: IconSliders, name: 'Custom', desc: 'Start from scratch with your own settings' },
] as const;

export function IngestWizard() {
  const { closeWizard, wizardStep, setWizardStep } = useUi();
  const settings = useSettings((s) => s.settings);
  const setSetting = useSettings((s) => s.setSetting);
  const setSettings = useSettings((s) => s.setSettings);
  const toast = useSession((s) => s.toast);
  const [template, setTemplate] = useState<string>('Panel Show');
  const [separator, setSeparator] = useState('_');
  const [trackGroup, setTrackGroup] = useState('A1-A8');

  const summary = yamlSummary(settings, template, separator, trackGroup);

  const next = () => {
    if (wizardStep < 4) setWizardStep(wizardStep + 1);
    else {
      setSettings({
        mode: settings.mode,
        essence: settings.essence,
        sampleRate: settings.sampleRate,
        bitDepth: settings.bitDepth,
        namingTemplate: separator === ' ' ? '{prefix} {role} {num}' : `{prefix}${separator}{role}${separator}{num}`,
        presetName: template,
      });
      // The wizard promised a YAML preset — actually write it (parity fix H4).
      void api.presetsSave({ name: template, yamlText: summary, force: true })
        .then((r) => {
          toast(r.ok ? `Preset "${template}" saved` : r.exists ? `Preset "${template}" exists — not overwritten` : 'Preset save failed');
        })
        .catch(() => toast('Preset save failed'));
      toast(`Wizard complete — preset "${template}" saved`);
      closeWizard();
    }
  };

  return (
    <div className="overlay open" role="dialog" aria-modal="true" aria-labelledby="wizardTitle">
      <div className="wizard-modal">
        <div className="wizard-header">
          <h2 id="wizardTitle"><IconSparkle size={16} /> Setup Wizard</h2>
          <button className="wizard-close" onClick={closeWizard} aria-label="Close wizard"><IconX size={14} /></button>
        </div>

        <div className="wizard-steps">
          {STEPS.map((s, i) => (
            <StepF key={s} index={i} total={STEPS.length} label={s} active={i === wizardStep} done={i < wizardStep} />
          ))}
        </div>

        <div className="wizard-body">
          {wizardStep === 0 && (
            <div className="wizard-step-panel" style={{ display: 'block' }}>
              <h3><span>01</span> Project template</h3>
              <p>Choose a template that matches your show. This sets naming, routing, and export defaults.</p>
              <div className="wizard-templates">
                {TEMPLATES.map((t) => (
                  <div key={t.name} className={`wizard-tmpl-card${template === t.name ? ' sel' : ''}`}
                    role="button" tabIndex={0} onClick={() => setTemplate(t.name)}>
                    <div className="tmpl-icon"><t.icon size={22} /></div>
                    <div className="tmpl-name">{t.name}</div>
                    <div className="tmpl-desc">{t.desc}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {wizardStep === 1 && (
            <div className="wizard-step-panel" style={{ display: 'block' }}>
              <h3><span>02</span> Naming convention</h3>
              <p>Configure how normalized channel names are built from source metadata.</p>
              <div className="wizard-row">
                <div><div className="row-label">Template pattern</div><div className="row-desc">{'Variables: {prefix} {role} {num} {side}'}</div></div>
                <div className="row-control">
                  <input type="text" value={settings.namingTemplate} style={{ width: 200, fontFamily: 'var(--font-mono)', fontSize: 12 }}
                    onChange={(e) => setSetting('namingTemplate', e.target.value)} />
                </div>
              </div>
              <div className="wizard-row">
                <div><div className="row-label">Separator</div><div className="row-desc">Character between name components</div></div>
                <div className="row-control">
                  <select value={separator} onChange={(e) => setSeparator(e.target.value)}>
                    <option value="_">Underscore _</option>
                    <option value="-">Hyphen -</option>
                    <option value=".">Dot .</option>
                    <option value=" ">Space</option>
                  </select>
                </div>
              </div>
              <div className="wizard-row">
                <div><div className="row-label">Preview</div><div className="row-desc">Live preview of the naming pattern</div></div>
                <div className="row-control">
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--tomato)' }}>
                    {settings.namingTemplate.replace('{prefix}', 'ISO').replace('{role}', 'Presenter').replace('{num}', '01')}
                  </span>
                </div>
              </div>
            </div>
          )}

          {wizardStep === 2 && (
            <div className="wizard-step-panel" style={{ display: 'block' }}>
              <h3><span>03</span> Track routing defaults</h3>
              <p>Set how channels are assigned to Avid tracks by default.</p>
              <div className="wizard-row">
                <div><div className="row-label">Auto-assign routing</div><div className="row-desc">Automatically route channels to AO tracks based on role</div></div>
                <div className="row-control">
                  <label className="toggle-switch">
                    <input type="checkbox" checked={settings.autoAssign} onChange={(e) => setSetting('autoAssign', e.target.checked)} />
                    <span className="toggle-slider" />
                  </label>
                </div>
              </div>
              <div className="wizard-row">
                <div><div className="row-label">Default track group</div><div className="row-desc">AO track range for auto-assignment</div></div>
                <div className="row-control">
                  <select value={trackGroup} onChange={(e) => setTrackGroup(e.target.value)}>
                    <option value="A1-A8">A1–A8 (standard)</option>
                    <option value="A9-A16">A9–A16 (extended)</option>
                    <option value="A17-A24">A17–A24 (large)</option>
                    <option value="A25-A32">A25–A32 (full)</option>
                  </select>
                </div>
              </div>
              <div className="wizard-row">
                <div><div className="row-label">Mix gain (dB)</div><div className="row-desc">Default gain applied to all routed channels</div></div>
                <div className="row-control">
                  <input type="number" value={settings.mixGain} step={0.5} min={-24} max={6} style={{ width: 80 }}
                    onChange={(e) => setSetting('mixGain', Number(e.target.value))} />
                </div>
              </div>
            </div>
          )}

          {wizardStep === 3 && (
            <div className="wizard-step-panel" style={{ display: 'block' }}>
              <h3><span>04</span> Export preferences</h3>
              <p>Configure how your AAF and media files are written.</p>
              <div className="wizard-row">
                <div><div className="row-label">Output structure</div><div className="row-desc">How tracks are organised in the AAF</div></div>
                <div className="row-control">
                  <select value={settings.mode} onChange={(e) => setSetting('mode', e.target.value as 'group' | 'sequence' | 'mixed')}>
                    <option value="group">Group Clip</option><option value="sequence">Sequence</option><option value="mixed">Mixed</option>
                  </select>
                </div>
              </div>
              <div className="wizard-row">
                <div><div className="row-label">Media format</div><div className="row-desc">How audio essence is stored</div></div>
                <div className="row-control">
                  <select value={settings.essence} onChange={(e) => setSetting('essence', e.target.value as typeof settings.essence)}>
                    <option value="embedded">Embedded in AAF</option><option value="external">Separate WAV files</option><option value="mxf">Avid MXF (OP-Atom)</option>
                  </select>
                </div>
              </div>
              <div className="wizard-row">
                <div><div className="row-label">Sample rate</div><div className="row-desc">Output sample rate</div></div>
                <div className="row-control">
                  <select value={settings.sampleRate} onChange={(e) => setSetting('sampleRate', e.target.value as typeof settings.sampleRate)}>
                    <option value="auto">Auto (from source)</option><option value="48000">48000 Hz</option><option value="96000">96000 Hz</option><option value="192000">192000 Hz</option>
                  </select>
                </div>
              </div>
              <div className="wizard-row">
                <div><div className="row-label">Output AAF directory</div><div className="row-desc">Where the AAF file gets written</div></div>
                <div className="row-control"><input type="text" value={settings.outputAafDir} style={{ width: 160 }} onChange={(e) => setSetting('outputAafDir', e.target.value)} /></div>
              </div>
              <div className="wizard-row">
                <div><div className="row-label">Media directory</div><div className="row-desc">Where MXF / WAV files get written</div></div>
                <div className="row-control"><input type="text" value={settings.outputMxfDir} style={{ width: 160 }} onChange={(e) => setSetting('outputMxfDir', e.target.value)} /></div>
              </div>
            </div>
          )}

          {wizardStep === 4 && (
            <div className="wizard-step-panel" style={{ display: 'block' }}>
              <h3><span>05</span> Summary &amp; save</h3>
              <p>Review your configuration before saving. A YAML preset will also be saved.</p>
              <div className="wizard-summary">{summary}</div>
            </div>
          )}
        </div>

        <div className="wizard-footer">
          <div className="wizard-footer-left">Step {wizardStep + 1} of 5</div>
          <div className="wizard-footer-right">
            <button className="wizard-btn" disabled={wizardStep === 0} onClick={() => setWizardStep(wizardStep - 1)}>Back</button>
            <button className="wizard-btn primary" onClick={next}>{wizardStep === 4 ? 'Save preset' : 'Next'}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function StepF({ index, total, label, active, done }: { index: number; total: number; label: string; active: boolean; done: boolean }) {
  return (
    <>
      <div className={`wizard-step-dot${active ? ' active' : ''}${done ? ' done' : ''}`}>
        <span className="wizard-dot" />
        <span className="wizard-step-label">{label}</span>
      </div>
      {index < total - 1 && <div className="wizard-steps-sep" />}
    </>
  );
}

function yamlSummary(s: ReturnType<typeof useSettings.getState>['settings'], template: string, sep: string, trackGroup: string): string {
  return [
    `# ${template}`,
    `name: "${template}"`,
    `mode: ${s.mode}`,
    `essence: ${s.essence}`,
    `sampleRate: ${s.sampleRate}`,
    `bitDepth: ${s.bitDepth}`,
    `trackGroup: "${trackGroup}"`,
    `namingTemplate: "{prefix}${sep}{role}${sep}{num}"`,
    `mixGain: ${s.mixGain}`,
    `outputAafDir: "${s.outputAafDir}"`,
    `outputMxfDir: "${s.outputMxfDir}"`,
  ].join('\n');
}