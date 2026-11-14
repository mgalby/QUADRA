import { useEffect } from 'react';

export interface ToastData {
  id: number;
  text: string;
  action?: { label: string; run: () => void };
}

/** Avviso in fondo allo schermo che sparisce da solo dopo 5 secondi. */
export function Toast({ toast, onClose }: { toast: ToastData; onClose: () => void }) {
  useEffect(() => {
    const timer = setTimeout(onClose, 5000);
    return () => clearTimeout(timer);
  }, [toast.id, onClose]);

  return (
    <div className="toast" role="status">
      <span>{toast.text}</span>
      {toast.action && (
        <button type="button" onClick={() => { toast.action!.run(); onClose(); }}>
          {toast.action.label}
        </button>
      )}
    </div>
  );
}
