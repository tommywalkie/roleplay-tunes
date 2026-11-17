import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';

interface Toast {
  id: number;
  text: string;
  tone: 'info' | 'error';
}

const ToastContext = createContext<(text: string, tone?: Toast['tone']) => void>(() => {});

/** Short messages for things that happen away from where the user is looking. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(0);

  const push = useCallback((text: string, tone: Toast['tone'] = 'info') => {
    const id = ++nextId.current;
    // The same message twice in a row is shown once.
    setToasts((list) => [...list.filter((x) => x.text !== text).slice(-2), { id, text, tone }]);
    setTimeout(() => setToasts((list) => list.filter((x) => x.id !== id)), 5000);
  }, []);

  return (
    <ToastContext.Provider value={push}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 top-4 z-[60] flex flex-col items-center gap-2 px-4"
      >
        {toasts.map((toast) => (
          <p
            key={toast.id}
            role={toast.tone === 'error' ? 'alert' : 'status'}
            className={
              'animate-enter rounded-[10px] border border-line-strong bg-raised px-4 py-2.5 text-[14px] leading-5 ' +
              (toast.tone === 'error' ? 'text-danger' : 'text-ink')
            }
          >
            {toast.text}
          </p>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);
