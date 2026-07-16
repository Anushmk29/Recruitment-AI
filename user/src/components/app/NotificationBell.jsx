import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
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
  const { unreadCount, recent, markRead, markAllRead } = useNotifications() || {};

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="relative rounded-full p-2 text-slate-500 transition hover:bg-slate-100"
        aria-label="Notifications"
      >
        <Bell className="h-5 w-5" />
        {unreadCount > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4.5 min-w-4.5 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </button>

      <AnimatePresence>
        {open && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
            <motion.div
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.15 }}
              className="absolute right-0 z-50 mt-2 w-80 rounded-xl border border-slate-200 bg-white shadow-soft"
            >
              <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
                <p className="text-sm font-semibold text-slate-800">Notifications</p>
                <button
                  onClick={() => markAllRead?.()}
                  className="flex items-center gap-1 text-xs font-semibold text-brand-700 hover:underline"
                >
                  <CheckCheck className="h-3.5 w-3.5" /> Mark all read
                </button>
              </div>

              <div className="max-h-80 overflow-y-auto">
                {(!recent || recent.length === 0) && (
                  <p className="px-4 py-6 text-center text-sm text-slate-400">No notifications yet.</p>
                )}
                {recent?.map((n) => (
                  <button
                    key={n._id}
                    onClick={() => !n.read && markRead?.(n._id)}
                    className={`block w-full border-b border-slate-50 px-4 py-3 text-left transition hover:bg-slate-50 ${
                      n.read ? "" : "bg-brand-50/50"
                    }`}
                  >
                    <p className="text-sm font-semibold text-slate-800">{n.title}</p>
                    <p className="mt-0.5 line-clamp-2 text-xs text-slate-500">{n.message}</p>
                    <p className="mt-1 text-[11px] text-slate-400">{timeAgo(n.createdAt)}</p>
                  </button>
                ))}
              </div>

              <button
                onClick={() => {
                  setOpen(false);
                  navigate("/notifications");
                }}
                className="block w-full rounded-b-xl bg-slate-50 px-4 py-2.5 text-center text-xs font-semibold text-brand-700 hover:bg-slate-100"
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
