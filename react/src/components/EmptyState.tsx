import type { ReactNode } from 'react';
import { useUi } from '../store/ui';

export function EmptyState({ icon, title, hint, cta, onClick }: {
  icon: ReactNode;
  title: string;
  hint: string;
  cta?: string;
  onClick?: () => void;
}) {
  const setTab = useUi((s) => s.setTab);
  return (
    <div className="empty-state">
      <div className="empty-icon">{icon}</div>
      <div className="empty-title">{title}</div>
      <div className="empty-hint">{hint}</div>
      {cta && (
        <button className="btn btn-secondary" onClick={onClick ?? (() => setTab('home'))}>{cta}</button>
      )}
    </div>
  );
}