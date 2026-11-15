import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { CheckCircle2, Info, TriangleAlert, XCircle, X } from 'lucide-react';

const ToastContext = createContext(null);

const STYLES = {
  success: { icon: CheckCircle2, accent: 'text-success', bar: 'bg-success' },
  error: { icon: XCircle, accent: 'text-danger', bar: 'bg-danger' },
  warning: { icon: TriangleAlert, accent: 'text-warning', bar: 'bg-warning' },
  info: { icon: Info, accent: 'text-forest', bar: 'bg-forest' },
};

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const idRef = useRef(0);

  const dismiss = useCallback((id) => setToasts((list) => list.filter((t) => t.id !== id)), []);

  const show = useCallback(
    (type, message, { title, action, duration = 4000 } = {}) => {
      const id = ++idRef.current;
      setToasts((list) => [...list.slice(-3), { id, type, message, title, action }]);
      if (duration) setTimeout(() => dismiss(id), duration);
      return id;
    },
    [dismiss],
  );

  const toast = useMemo(
    () => ({
      success: (m, o) => show('success', m, o),
      error: (m, o) => show('error', m, o),
      warning: (m, o) => show('warning', m, o),
      info: (m, o) => show('info', m, o),
      dismiss,
    }),
    [show, dismiss],
  );

  return (
    <ToastContext.Provider value={toast}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 bottom-0 z-[100] flex flex-col items-center gap-2 p-4 sm:items-end sm:p-6"
      >
        <AnimatePresence initial={false}>
          {toasts.map((t) => {
            const S = STYLES[t.type] || STYLES.info;
            const Icon = S.icon;
            return (
              <motion.div
                key={t.id}
                layout
                initial={{ opacity: 0, y: 16, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, x: 40, transition: { duration: 0.18 } }}
                role={t.type === 'error' ? 'alert' : 'status'}
                className="pointer-events-auto relative flex w-full max-w-sm overflow-hidden rounded-2xl border border-line bg-white shadow-lift"
              >
                <span className={`w-1 ${S.bar}`} />
                <div className="flex flex-1 items-start gap-3 p-4">
                  <Icon className={`mt-0.5 size-5 shrink-0 ${S.accent}`} />
                  <div className="min-w-0 flex-1">
                    {t.title && <p className="text-sm font-semibold text-ink">{t.title}</p>}
                    <p className="text-sm text-ink-soft">{t.message}</p>
                    {t.action && (
                      <button
                        onClick={() => {
                          t.action.onClick();
                          dismiss(t.id);
                        }}
                        className="mt-1.5 text-sm font-semibold text-accent hover:underline"
                      >
                        {t.action.label}
                      </button>
                    )}
                  </div>
                  <button onClick={() => dismiss(t.id)} aria-label="Dismiss notification" className="rounded-md p-1 text-muted hover:bg-cream hover:text-ink">
                    <X className="size-4" />
                  </button>
                </div>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);
