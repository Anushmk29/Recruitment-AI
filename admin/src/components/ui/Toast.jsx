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
  // Toasts are this app's only confirmation channel, and some of what they
  // confirm is a recorded hiring decision ("Skipped to AI interview — recorded
  // as your decision"). A visual-only toast means a screen-reader user takes an
  // irreversible action and is told nothing about whether it landed.
  //
  // The announcement is mirrored into two PERSISTENT hidden regions rather than
  // put on the toast elements themselves: a live region has to be in the DOM
  // before its content changes for the change to be announced reliably, and an
  // element that arrives already carrying role="alert" is the case assistive
  // tech handles least consistently. Keying the inner span on the toast id
  // re-announces a repeated identical message, which a static text node would
  // silently swallow.
  const [live, setLive] = useState({ polite: null, assertive: null });
  const counter = useRef(0);

  const remove = useCallback((id) => {
    setToasts((list) => list.filter((t) => t.id !== id));
  }, []);

  const push = useCallback(
    (message, type = "info", duration = 4000) => {
      const id = ++counter.current;
      setToasts((list) => [...list, { id, message, type }]);
      // Failures interrupt; confirmations wait for a pause in speech.
      setLive((prev) =>
        type === "error" ? { ...prev, assertive: { id, message } } : { ...prev, polite: { id, message } }
      );
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
  // closed before the connection is established"). Six error toasts tore the
  // notification socket down six times. `push` is already stable via useCallback.
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

      <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {live.polite && <span key={live.polite.id}>{live.polite.message}</span>}
      </div>
      <div className="sr-only" role="alert" aria-live="assertive" aria-atomic="true">
        {live.assertive && <span key={live.assertive.id}>{live.assertive.message}</span>}
      </div>

      {/* aria-hidden: the visible stack is a duplicate of what the live regions
          above already announce. Without this the same message is read twice. */}
      <div
        aria-hidden="true"
        className="pointer-events-none fixed bottom-5 right-5 z-[100] flex w-full max-w-sm flex-col gap-2"
      >
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
                <button
                  type="button"
                  onClick={() => remove(t.id)}
                  title="Dismiss"
                  // Inside an aria-hidden container this button is unreachable by
                  // keyboard anyway; toasts auto-dismiss, and the action they
                  // report is never gated behind dismissing them.
                  tabIndex={-1}
                  className="-m-1.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-current/60 transition-colors duration-150 hover:bg-black/5 hover:text-current"
                >
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
