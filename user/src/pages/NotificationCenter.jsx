import { useEffect, useState, useCallback } from "react";
import { Bell, CheckCheck, Trash2, Search } from "lucide-react";
import api from "../api/client.js";
import { accountAuthHeader } from "../auth/accountAuth.js";
import { Card, Badge, Skeleton, EmptyState, IconTile } from "../components/ui/Card.jsx";
import { PageHero } from "../components/ui/Panels.jsx";
import { Input, Select } from "../components/ui/Field.jsx";
import Button from "../components/ui/Button.jsx";
import { useNotifications } from "../context/NotificationContext.jsx";

const TYPE_OPTIONS = [
  { value: "", label: "All types" },
  { value: "welcome", label: "Welcome" },
  { value: "application_submitted", label: "Application Submitted" },
  { value: "assessment_invite", label: "Assessment Invite" },
  { value: "assessment_reminder", label: "Assessment Reminder" },
  { value: "interview_invite", label: "Interview Invite" },
  { value: "interview_reminder", label: "Interview Reminder" },
  { value: "next_round_scheduled", label: "Next Round" },
  { value: "rejection", label: "Rejection" },
  { value: "profile_updated", label: "Profile Updated" },
  { value: "password_changed", label: "Password Changed" },
];

const TONE_BY_TYPE = {
  rejection: "red",
  interview_invite: "brand",
  assessment_invite: "brand",
  // A reminder is a deadline the candidate is still blocking, so it reads as
  // "act now" rather than as another neutral status line.
  assessment_reminder: "amber",
  next_round_scheduled: "green",
};

function timeAgo(date) {
  const seconds = Math.floor((Date.now() - new Date(date).getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export default function NotificationCenter() {
  const { refreshUnreadCount, refreshRecent } = useNotifications() || {};
  const [data, setData] = useState(null);
  const [page, setPage] = useState(1);
  const [type, setType] = useState("");
  const [read, setRead] = useState("");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get("/notifications", {
        headers: accountAuthHeader(),
        params: { page, limit: 10, type: type || undefined, read: read || undefined, search: search || undefined },
      });
      setData(res.data);
    } finally {
      setLoading(false);
    }
  }, [page, type, read, search]);

  useEffect(() => {
    load();
  }, [load]);

  async function markRead(id) {
    await api.patch(`/notifications/${id}/read`, {}, { headers: accountAuthHeader() });
    await load();
    refreshUnreadCount?.();
    refreshRecent?.();
  }

  async function markAllRead() {
    await api.patch("/notifications/read-all", {}, { headers: accountAuthHeader() });
    await load();
    refreshUnreadCount?.();
    refreshRecent?.();
  }

  async function remove(id) {
    await api.delete(`/notifications/${id}`, { headers: accountAuthHeader() });
    await load();
    refreshUnreadCount?.();
    refreshRecent?.();
  }

  return (
    <div className="space-y-6">
      <PageHero
        eyebrow="Activity"
        eyebrowIcon={Bell}
        title="Notifications"
        description="Your application, interview, and account updates."
        action={
          <Button variant="secondary" size="sm" onClick={markAllRead}>
            <CheckCheck className="h-4 w-4" aria-hidden="true" /> Mark all read
          </Button>
        }
      />

      <Card>
        {/* The filter bar reads as one control group rather than three loose
            fields dropped above the list. */}
        <div className="mb-5 grid gap-3 rounded-2xl border border-slate-200 bg-canvas p-4 sm:grid-cols-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input
              className="pl-9"
              placeholder="Search notifications…"
              value={search}
              onChange={(e) => {
                setPage(1);
                setSearch(e.target.value);
              }}
            />
          </div>
          <Select
            value={type}
            onChange={(e) => {
              setPage(1);
              setType(e.target.value);
            }}
          >
            {TYPE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </Select>
          <Select
            value={read}
            onChange={(e) => {
              setPage(1);
              setRead(e.target.value);
            }}
          >
            <option value="">All</option>
            <option value="false">Unread</option>
            <option value="true">Read</option>
          </Select>
        </div>

        {loading && (
          <div className="space-y-3">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
        )}

        {!loading && data?.notifications.length === 0 && (
          <EmptyState icon={Bell} title="No notifications found" description="Try adjusting your filters or search." />
        )}

        {!loading && data?.notifications.length > 0 && (
          // Discrete bordered rows rather than hairline-divided ones: unread
          // carries a tinted ground, and a tint that bleeds edge-to-edge across
          // a divided list has no shape to read as "this item".
          <ul className="space-y-2.5">
            {data.notifications.map((n) => (
              <li
                key={n._id}
                className={`flex items-start gap-3 rounded-xl border p-4 ${
                  n.read ? "border-slate-200 bg-white" : "border-brand-200 bg-brand-50/50"
                }`}
              >
                <IconTile icon={Bell} size="sm" tone={n.read ? "slate" : "brand"} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-semibold text-slate-800">{n.title}</p>
                    <Badge tone={TONE_BY_TYPE[n.type] || "slate"}>{n.type.replace(/_/g, " ")}</Badge>
                    {/* The dot is redundant with the tinted ground and the border
                        for a sighted reader, and was invisible to everyone else.
                        The state now has a name instead of a colour. */}
                    {!n.read && <span className="sr-only">Unread</span>}
                  </div>
                  <p className="mt-1 text-sm text-slate-600">{n.message}</p>
                  {/* Was `slate-400` at 11px — 2.5:1, and timestamps are exactly
                      the thing someone squints at. */}
                  <p className="mt-1.5 text-xs text-slate-500">{timeAgo(n.createdAt)}</p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  {!n.read && (
                    <button
                      onClick={() => markRead(n._id)}
                      className="rounded-lg px-2 py-1 text-xs font-semibold text-brand-700 hover:bg-brand-50"
                    >
                      Mark read
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => remove(n._id)}
                    className="rounded-lg p-1.5 text-slate-500 transition-colors hover:bg-red-50 hover:text-red-600"
                    // Names WHICH notification. Eight identical "Delete
                    // notification" buttons cannot be told apart by voice
                    // control or in a screen reader's element list.
                    aria-label={`Delete notification: ${n.title}`}
                  >
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}

        {!loading && data?.totalPages > 1 && (
          <div className="mt-4 flex items-center justify-between border-t border-slate-100 pt-4">
            <p className="text-xs text-slate-500">
              Page {data.page} of {data.totalPages} ({data.total} total)
            </p>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                Previous
              </Button>
              <Button variant="outline" size="sm" disabled={page >= data.totalPages} onClick={() => setPage((p) => p + 1)}>
                Next
              </Button>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
