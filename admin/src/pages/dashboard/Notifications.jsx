import { useEffect, useState, useCallback } from "react";
import { Bell, CheckCheck, Trash2, Search } from "lucide-react";
import api from "../../api/client.js";
import { Card, Badge, Skeleton, EmptyState } from "../../components/ui/Card.jsx";
import { Input, Select } from "../../components/ui/Field.jsx";
import Button from "../../components/ui/Button.jsx";
import { useNotifications } from "../../context/NotificationContext.jsx";

const TYPE_OPTIONS = [
  { value: "", label: "All types" },
  { value: "email_verified", label: "Email Verified" },
  { value: "workspace_ready", label: "Workspace Ready" },
  { value: "payment_success", label: "Payment Success" },
  { value: "payment_failed", label: "Payment Failed" },
  { value: "invoice_generated", label: "Invoice Generated" },
  { value: "subscription_renewal", label: "Subscription Renewal" },
  { value: "new_candidate_applied", label: "New Candidate Applied" },
  { value: "ats_completed", label: "ATS Completed" },
  { value: "assessment_decision_needed", label: "Assessment Decision Needed" },
  { value: "assessment_contradiction", label: "Assessment Contradiction" },
  { value: "assessment_softlock", label: "Assessment Paused (Integrity)" },
  { value: "candidate_shortlisted", label: "Candidate Shortlisted" },
  { value: "candidate_rejected", label: "Candidate Rejected" },
  { value: "password_changed", label: "Password Changed" },
  { value: "system_alert", label: "System Alert" },
];

const TONE_BY_TYPE = {
  payment_failed: "red",
  candidate_rejected: "red",
  // Both are "a human must look at this" signals, never an automatic action —
  // they must not read as routine status noise in the list.
  assessment_contradiction: "amber",
  assessment_softlock: "amber",
  assessment_decision_needed: "brand",
  candidate_shortlisted: "green",
  payment_success: "green",
  workspace_ready: "green",
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

export default function Notifications() {
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
      const res = await api.get("/admin-notifications", {
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
    await api.patch(`/admin-notifications/${id}/read`);
    await load();
    refreshUnreadCount?.();
    refreshRecent?.();
  }

  async function markAllRead() {
    await api.patch("/admin-notifications/read-all");
    await load();
    refreshUnreadCount?.();
    refreshRecent?.();
  }

  async function remove(id) {
    await api.delete(`/admin-notifications/${id}`);
    await load();
    refreshUnreadCount?.();
    refreshRecent?.();
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Notifications</h1>
          <p className="mt-1 text-sm text-slate-500">Workspace, ATS, and billing alerts for your company.</p>
        </div>
        <Button variant="outline" size="sm" onClick={markAllRead}>
          <CheckCheck className="h-4 w-4" /> Mark all read
        </Button>
      </div>

      <Card>
        <div className="mb-4 grid gap-3 sm:grid-cols-3">
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
          <div className="divide-y divide-slate-100">
            {data.notifications.map((n) => (
              <div key={n._id} className={`flex items-start gap-3 py-4 ${n.read ? "" : "bg-brand-50/40"} -mx-2 px-2 rounded-lg`}>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-semibold text-slate-800">{n.title}</p>
                    <Badge tone={TONE_BY_TYPE[n.type] || "slate"}>{n.type.replace(/_/g, " ")}</Badge>
                    {!n.read && <span className="h-1.5 w-1.5 rounded-full bg-brand-600" />}
                  </div>
                  <p className="mt-1 text-sm text-slate-500">{n.message}</p>
                  <p className="mt-1 text-xs text-slate-400">{timeAgo(n.createdAt)}</p>
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
                    onClick={() => remove(n._id)}
                    className="rounded-lg p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600"
                    aria-label="Delete notification"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
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
