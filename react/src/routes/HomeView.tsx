import { useState } from 'react';
import { useUi } from '../store/ui';
import { useSession } from '../store/session';
import { useRecents } from '../store/settings';
import { api } from '../api/electron';
import { IconSparkle, IconUpload, IconFolder, IconWave, IconChevronRight, IconRoute, IconNormalize, IconExport, IconX } from '../components/icons';

export function HomeView() {
  const { openWizard, setTab } = useUi();
  const session = useSession();
  const { recents, clearRecents, addRecent } = useRecents();
  const [dragOver, setDragOver] = useState(false);

  const pickFolder = async () => {
    const dir = await api.openDirectory();
    if (dir) {
      await session.loadFolder(dir);
      addRecent({ name: dir.split('\\').pop() ?? dir, path: dir });
    }
  };

  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) {
      // Electron >=32 removed File.path; pathForFile goes through webUtils.
      const p = api.pathForFile(file as unknown);
      if (p) {
        const dir = p.replace(/\\[^\\]+$/, '');
        await session.loadFolder(dir);
        addRecent({ name: dir.split('\\').pop() ?? dir, path: dir });
        return;
      }
    }
    await pickFolder();
  };

  const loaded = session.folder !== null;
  const take = session.selectedTake !== null ? session.takes[session.selectedTake] : null;

  return (
    <>
      {!loaded && (
        <div className="hero-wrap hero-enter">
          <div className="hero-content">
            <div className="hero-eyebrow">Audio Ingest Pipeline</div>
            <h1 className="hero-title">Polywav<span className="accent"> Ingest</span><span className="title-dot" /></h1>
            <p className="hero-subtitle">Routing · Normalization · AAF Export</p>
            <p className="hero-desc">
              Load a multichannel broadcast WAV, name your channels, route them to Avid tracks, then export an AAF for Media Composer.
            </p>
            <button className="wizard-cta" onClick={openWizard}>
              <span className="wiz-cta-icon"><IconSparkle size={18} /></span>
              <span className="wiz-cta-text">
                <span className="wiz-cta-title">Setup Wizard</span>
                <span className="wiz-cta-dot">·</span>
                <span className="wiz-cta-desc">Configure templates, naming defaults, routing &amp; export</span>
              </span>
              <span className="wiz-cta-arrow"><IconChevronRight size={15} /></span>
            </button>

            <div
              className={`drop-zone${dragOver ? ' drag-over' : ''}`}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={onDrop}
              onClick={pickFolder}
            >
              <span className="drop-zone-icon"><IconUpload size={34} /></span>
              <div className="drop-zone-title">{dragOver ? 'Let go to load it' : 'Drop it here'}</div>
              <p className="drop-zone-hint">No setup. No questions. Just your file — or a whole shoot-day folder of takes.</p>
              <button className="drop-zone-btn" onClick={(e) => { e.stopPropagation(); pickFolder(); }}>Browse files</button>
              <div className="drop-formats">
                <span className="drop-format">.WAV</span><span className="drop-format">.AAF</span><span className="drop-format">.MXF</span><span className="drop-format">FOLDER</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Recents stay visible after load (shipping parity) — above the loaded card */}
      {(loaded || recents.length > 0) && (
        <div className="recent-section" style={{ maxWidth: 640, margin: loaded ? '8px auto 0' : undefined }}>
          <div className="recent-header"><h3><IconFolder size={13} /> Recent folders</h3><button className="recent-clear" onClick={clearRecents}>Clear</button></div>
          <div className="recent-list">
            {recents.length === 0 && <div className="recent-empty">No folders loaded yet</div>}
            {recents.map((r) => (
              <div key={r.path} className="recent-item" onClick={() => { void session.loadFolder(r.path); }}>
                <span className="file-icon"><IconFolder size={17} /></span>
                <div>
                  <div className="file-name">{r.name}</div>
                  <div className="file-meta">{r.path}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {loaded && (
        <div className="file-loaded-card card-enter">
          <div className="fl-header">
            <span className="fl-icon"><IconWave size={20} /></span>
            <div>
              <div className="fl-label">Loaded folder</div>
              <div className="fl-filename">{session.folder}</div>
            </div>
            <button className="fl-new-btn" onClick={pickFolder}><IconX size={11} /> Load new</button>
          </div>
          <div className="fl-details">
            {session.takes.map((t) => (
              <div key={t.id} className="fl-take">
                <span className="fl-take-name">{t.name}</span>
                <span className="fl-take-meta">{t.channels} ch</span>
              </div>
            ))}
            <div className="fl-meta-row">{take ? `${take.sampleRate} Hz · ${take.bits}-bit` : ''}</div>
          </div>
          <div className="fl-actions">
            <button className="btn btn-primary" onClick={() => setTab('route')}><IconRoute size={15} /> Route channels</button>
            <button className="btn btn-secondary" onClick={() => setTab('normalize')}><IconNormalize size={15} /> Normalize</button>
            <button className="btn btn-secondary" onClick={() => setTab('export')}><IconExport size={15} /> Export</button>
          </div>
        </div>
      )}
    </>
  );
}