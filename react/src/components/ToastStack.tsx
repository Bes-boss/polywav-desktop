import { useSession } from '../store/session';

export function ToastStack() {
  const toasts = useSession((s) => s.toasts);
  const dismiss = useSession((s) => s.dismissToast);
  if (!toasts.length) return null;
  return (
    <>
      {toasts.map((t) => (
        <div key={t.id} className="toast show" onClick={() => dismiss(t.id)}>{t.msg}</div>
      ))}
    </>
  );
}