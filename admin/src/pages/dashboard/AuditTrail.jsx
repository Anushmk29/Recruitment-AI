// Audit Trail (Phase 13) — the first read path AuditLog has ever had. The
// backend has written an audit row for every authenticated mutation since the
// hardening waves; until now nothing could display them. Company-scoped: an
// admin sees only their own tenant's trail (the cross-tenant view is the
// Phase 16 platform console).
import { useCallback, useEffect, useState } from "react";
import { History, ChevronLeft, ChevronRight } from "lucide-react";
import api from "../../api/client.js";
import { Card, Badge, Skeleton, EmptyState } from "../../components/ui/Card.jsx";
import Button from "../../components/ui/Button.jsx";
import { Input, Label, FormGroup } from "../../components/ui/Field.jsx";
import { useToast } from "../../components/ui/Toast.jsx";

function statusTone(code) {
  if (!code) return "slate";
  if (code < 300) return "emerald";
  if (code < 500) return "amber";
  return "red";
}

export default function AuditTrail() {
  const toast = useToast();
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [limit] = useState(25);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({ action: "", actorEmail: "", from: "", to: "" });
  const [applied, setApplied] = useState(filters);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = { page, limit };
      if (applied.action) params.action = applied.action;
      if (applied.actorEmail) params.actorEmail = applied.actorEmail;
      if (applied.from) params.from = applied.from;
      if (applied.to) params.to = applied.to;
      const res = await api.get("/audit-logs", { params });
      setItems(res.data.items || []);
      setTotal(res.data.total || 0);
    } catch (err) {
      toast.error(err.response?.data?.error || "Could not load the audit trail");
    } finally {
      setLoading(false);
    }
  }, [page, limit, applied, toast]);

  useEffect(() => {
    load();
  }, [load]);

  const pages = Math.max(1, Math.ceil(total / limit));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900 [overflow-wrap:anywhere]">Audit Trail</h1>
        <p className="mt-1 text-sm text-slate-500">
          Every mutating action in your workspace — who did what, when, and with what outcome. Read-only and
          append-only.
        </p>
      </div>

      <Card>
        <form
          className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5"
          onSubmit={(e) => {
            e.preventDefault();
            setPage(1);
            setApplied(filters);
          }}
        >
          <FormGroup>
            <Label>Action</Label>
            <Input
              placeholder="e.g. candidate.erase or POST /api/jobs"
              value={filters.action}
              onChange={(e) => setFilters((f) => ({ ...f, action: e.target.value }))}
            />
          </FormGroup>
          <FormGroup>
            <Label>Actor email</Label>
            <Input
              placeholder="user@company.com"
              value={filters.actorEmail}
              onChange={(e) => setFilters((f) => ({ ...f, actorEmail: e.target.value }))}
            />
          </FormGroup>
          <FormGroup>
            <Label>From</Label>
            <Input type="date" value={filters.from} onChange={(e) => setFilters((f) => ({ ...f, from: e.target.value }))} />
          </FormGroup>
          <FormGroup>
            <Label>To</Label>
            <Input type="date" value={filters.to} onChange={(e) => setFilters((f) => ({ ...f, to: e.target.value }))} />
          </FormGroup>
          <div className="flex items-end pb-4">
            <Button type="submit" className="w-full">
              Filter
            </Button>
          </div>
        </form>
      </Card>

      <Card>
        {loading ? (
          <div className="space-y-3">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
          </div>
        ) : items.length === 0 ? (
          <EmptyState
            icon={History}
            title="No audit entries"
            description="Entries appear here as soon as anyone in your workspace performs a mutating action."
          />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-xs font-semibold text-slate-600">
                    <th className="py-2.5 pr-4 font-semibold">When</th>
                    <th className="py-2.5 pr-4 font-semibold">Actor</th>
                    <th className="py-2.5 pr-4 font-semibold">Action</th>
                    <th className="py-2.5 pr-4 font-semibold">Target</th>
                    <th className="py-2.5 font-semibold">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((row) => (
                    <tr key={row._id} className="border-b border-slate-50 align-top">
                      <td className="whitespace-nowrap py-2.5 pr-4 text-slate-500">
                        {new Date(row.createdAt).toLocaleString()}
                      </td>
                      <td className="py-2.5 pr-4">
                        <span className="font-medium text-slate-700">{row.actorEmail || "system"}</span>
                        {row.actorRole && <span className="ml-1.5 text-xs text-slate-500">({row.actorRole})</span>}
                      </td>
                      <td className="py-2.5 pr-4 font-mono text-xs text-slate-700">{row.action}</td>
                      <td className="py-2.5 pr-4 text-xs text-slate-500">
                        {row.resourceType ? `${row.resourceType} ${row.resourceId || ""}` : "—"}
                      </td>
                      <td className="py-2.5">
                        <Badge tone={statusTone(row.statusCode)}>{row.statusCode || "—"}</Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="mt-4 flex items-center justify-between border-t border-slate-100 pt-3 text-sm text-slate-500">
              <span>
                {total} entr{total === 1 ? "y" : "ies"} · page {page} of {pages}
              </span>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                  <ChevronLeft className="h-4 w-4" /> Prev
                </Button>
                <Button variant="outline" size="sm" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>
                  Next <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </>
        )}
      </Card>
    </div>
  );
}
