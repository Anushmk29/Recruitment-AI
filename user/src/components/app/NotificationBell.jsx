import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Bell, CheckCheck } from "lucide-react";
import { useNotifications } from "../../context/NotificationContext.jsx";

function timeAgo(date) {
  const seconds = Math.floor((Date.now() - new Date(date).getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export default function NotificationBell() {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const buttonRef = useRef(null);
  const reduceMotion = useReducedMotion();
  const { unreadCount, recent, markRead, markAllRead } = useNotifications() || {};

  // Escape closes the panel and returns focus to the bell. Without it the only
  // way out of an open popover was a mouse click on the scrim — which is not a
  // gesture a keyboard user has.
  useEffect(() => {
    if (!open) return;
    function onKeyDown(event) {
      if (event.key !== "Escape") return;
      setOpen(false);
      buttonRef.current?.focus();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open]);

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        // The count was rendered as a red dot and nothing else. Putting it in
        // the accessible name is what makes "you have three unread" reach
        // someone who cannot see the badge.
        aria-label={unreadCount > 0 ? `Notifications, ${unreadCount} unread` : "Notifications"}
        aria-expanded={open}
        aria-haspopup="true"
        className="tap-target relative flex items-center justify-center rounded-full p-2 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-200"
      >
        <Bell className="h-5 w-5" aria-hidden="true" />
        {unreadCount > 0 && (
          // `red-600`, not `red-500`: white on red-500 is 3.76:1, and this ships
          // at 10px. Hidden from assistive tech because the same number is
          // already in the button's name above — announcing it twice is worse
          // than announcing it once.
          <span
            aria-hidden="true"
            className="absolute -right-0.5 -top-0.5 flex h-4.5 min-w-4.5 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-bold text-white"
          >
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </button>

      <AnimatePresence>
        {open && (
          <>
            <div className="fixed inset-0 z-40" aria-hidden="true" onClick={() => setOpen(false)} />
            <motion.div
              // Under reduced motion the panel arrives already in place and only
              // fades: the state change stays legible, the travel goes away.
              initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -8 }}
              transition={{ duration: 0.15, ease: [0.16, 1, 0.3, 1] }}
              aria-label="Notifications"
              // `max-w` keeps the 320px panel inside the viewport on a 360px
              // phone, where `right-0` alone would push it off the left edge.
              className="absolute right-0 z-50 mt-2 w-80 max-w-[calc(100vw-2.5rem)] rounded-xl border border-slate-200 bg-white shadow-soft"
            >
              <div className="flex items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
                <p className="text-sm font-semibold text-slate-800">Notifications</p>
                <button
                  type="button"
                  onClick={() => markAllRead?.()}
                  className="tap-target -m-1 flex items-center gap-1 rounded-lg p-1 text-xs font-semibold text-brand-700 transition-colors hover:bg-brand-50 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300"
                >
                  <CheckCheck className="h-3.5 w-3.5" aria-hidden="true" /> Mark all read
                </button>
              </div>

              <div className="max-h-80 overflow-y-auto">
                {(!recent || recent.length === 0) && (
                  <p className="px-4 py-6 text-center text-sm text-slate-500">No notifications yet.</p>
                )}
                {recent?.map((n) => (
                  <button
                    key={n._id}
                    type="button"
                    onClick={() => !n.read && markRead?.(n._id)}
                    className={`block w-full border-b border-slate-100 px-4 py-3 text-left transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-300 ${
                      n.read ? "" : "bg-brand-50/50"
                    }`}
                  >
                    <p className="text-sm font-semibold text-slate-800">
                      {n.title}
                      {!n.read && <span className="sr-only"> (unread)</span>}
                    </p>
                    <p className="mt-0.5 line-clamp-2 text-xs text-slate-500">{n.message}</p>
                    <p className="mt-1 text-[11px] text-slate-500">{timeAgo(n.createdAt)}</p>
                  </button>
                ))}
              </div>

              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  navigate("/notifications");
                }}
                className="block w-full rounded-b-xl bg-slate-50 px-4 py-2.5 text-center text-xs font-semibold text-brand-700 transition-colors hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-300"
              >
                View all notifications
              </button>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
