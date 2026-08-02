import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { CheckCircle2, XCircle, Info, X } from "lucide-react";

const ToastContext = createContext(null);

const ICONS = {
  success: CheckCircle2,
  error: XCircle,
  info: Info,
};

const TONES = {
  success: "border-emerald-200 bg-emerald-50 text-emerald-800",
  error: "border-red-200 bg-red-50 text-red-800",
  info: "border-brand-200 bg-brand-50 text-brand-800",
};

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const counter = useRef(0);

  const remove = useCallback((id) => {
    setToasts((list) => list.filter((t) => t.id !== id));
  }, []);

  const push = useCallback(
    (message, type = "info", duration = 4000) => {
      const id = ++counter.current;
      setToasts((list) => [...list, { id, message, type }]);
      if (duration) setTimeout(() => remove(id), duration);
      return id;
    },
    [remove]
  );

  // MUST be memoized. This object is the context value, and ToastProvider re-renders
  // on every push AND every auto-dismiss. A fresh literal here changes identity on each
  // of those renders, which re-runs every consumer effect that lists `toast` as a
  // dependency — including the Socket.io connect effect in NotificationContext, whose
  // reconnect then calls disconnect() on a socket still in CONNECTING ("WebSocket is
  // closed before the connection is established"). `push` is already stable via useCallback.
  const toast = useMemo(
    () => ({
      success: (msg, d) => push(msg, "success", d),
      error: (msg, d) => push(msg, "error", d),
      info: (msg, d) => push(msg, "info", d),
    }),
    [push]
  );

  return (
    <ToastContext.Provider value={toast}>
      {children}
      <div className="pointer-events-none fixed bottom-5 right-5 z-[100] flex w-full max-w-sm flex-col gap-2">
        <AnimatePresence>
          {toasts.map((t) => {
            const Icon = ICONS[t.type];
            return (
              <motion.div
                key={t.id}
                initial={{ opacity: 0, y: 12, scale: 0.96 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, scale: 0.96 }}
                className={`pointer-events-auto flex items-start gap-2.5 rounded-xl border px-4 py-3 shadow-soft ${TONES[t.type]}`}
              >
                <Icon className="mt-0.5 h-4 w-4 shrink-0" />
                <p className="flex-1 text-sm font-medium">{t.message}</p>
                <button onClick={() => remove(t.id)} className="text-current/60 hover:text-current">
                  <X className="h-3.5 w-3.5" />
                </button>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within ToastProvider");
  return ctx;
}
