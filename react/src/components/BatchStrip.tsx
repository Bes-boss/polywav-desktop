import { useSession } from '../store/session';
import { IconFolder } from './icons';

export function BatchStrip() {
  const session = useSession();
  if (!session.folder) return null;
  return (
    <div className="batch-strip card-enter">
      <div className="batch-dir"><IconFolder size={13} /> {session.folder} &nbsp;·&nbsp; {session.takes.length} WAV detected</div>
      <div className="takes">
        {session.takes.map((t, i) => (
          <span key={t.id} className={`take${session.selectedTake === i ? ' sel' : ''}`}
            onClick={() => session.selectTake(i)}>
            <span className="n">{t.id}</span> {t.channels}ch
          </span>
        ))}
      </div>
      <div className="batch-hint">routing template applies to all takes</div>
    </div>
  );
}