// Platform console (BUILD-PLAN Phase 16) — superadmin operations surface:
// tenant directory (suspend/reactivate with a mandatory typed reason),
// the first-ever viewers for AuditLog / EmailLog / UsageEvent, demo-request
// leads, and the AI trust dashboard. Read-only "view as tenant" hands off to
// the normal dashboard with the server rejecting every mutation.
import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Building2,
  ShieldCheck,
  History,
  Mail,
  Gauge,
  Sparkles,
  LogOut,
  Eye,
  Inbox,
} from "lucide-react";
import api, { setViewAsCompany } from "../../api/client.js";
import { clearAdminAuth } from "../../auth/adminAuth.js";
import { Card, Badge, Skeleton, EmptyState } from "../../components/ui/Card.jsx";
import Button from "../../components/ui/Button.jsx";
import { Input, Label, FormGroup } from "../../components/ui/Field.jsx";
import { useToast } from "../../components/ui/Toast.jsx";

const TABS = [
  { key: "tenants", label: "Tenants", icon: Building2 },
  { key: "trust", label: "AI Trust", icon: ShieldCheck },
  { key: "audit", label: "Audit Logs", icon: History },
  { key: "email", label: "Email Logs", icon: Mail },
  { key: "usage", label: "Usage", icon: Gauge },
  { key: "leads", label: "Demo Leads", icon: Inbox },
];

const STATUS_TONE = {
  active: "green",
  suspended: "red",
  pending_verification: "amber",
  pending_payment: "amber",
  sent: "green",
  failed: "red",
  queued: "amber",
  retrying: "amber",
};

function Pager({ page, total, limit, onPage }) {
  const pages = Math.max(1, Math.ceil(total / limit));
  if (pages <= 1) return null;
  return (
    <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-3 text-sm text-slate-500">
      <span>
        {total} rows · page {page}/{pages}
      </span>
      <div className="flex gap-2">
        <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>
          Prev
        </Button>
        <Button variant="outline" size="sm" disabled={page >= pages} onClick={() => onPage(page + 1)}>
          Next
        </Button>
      </div>
    </div>
  );
}

function TenantsTab() {
  const toast = useToast();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [page, setPage] = useState(1);
  const [q, setQ] = useState("");
  const [reasonFor, setReasonFor] = useState(null); // { tenant, action }
  const [reason, setReason] = useState("");

  const load = useCallback(async () => {
    try {
      const res = await api.get("/platform/tenants", { params: { page, q: q || undefined } });
      setData(res.data);
    } catch (err) {
      toast.error(err.response?.data?.error || "Could not load tenants");
    }
  }, [page, q, toast]);

  useEffect(() => {
    load();
  }, [load]);

  async function submitStatusChange() {
    const { tenant, action } = reasonFor;
    try {
      await api.post(`/platform/tenants/${tenant.id}/${action}`, { reason });
      toast.success(`${tenant.name} ${action === "suspend" ? "suspended" : "reactivated"}`);
      setReasonFor(null);
      setReason("");
      load();
    } catch (err) {
      toast.error(err.response?.data?.error || "Action failed");
    }
  }

  function viewAsTenant(t) {
    setViewAsCompany({ id: t.id, name: t.name });
    navigate("/");
  }

  return (
    <Card>
      <div className="mb-4 flex items-center gap-3">
        <Input placeholder="Search tenants…" value={q} onChange={(e) => { setPage(1); setQ(e.target.value); }} className="max-w-xs" />
      </div>
      {!data ? (
        <Skeleton className="h-40 w-full" />
      ) : data.items.length === 0 ? (
        <EmptyState icon={Building2} title="No tenants" description="Tenant workspaces appear here once companies register." />
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-xs uppercase tracking-wide text-slate-400">
                  <th className="py-2 pr-4 font-semibold">Tenant</th>
                  <th className="py-2 pr-4 font-semibold">Status</th>
                  <th className="py-2 pr-4 font-semibold">Plan</th>
                  <th className="py-2 pr-4 font-semibold">Jobs</th>
                  <th className="py-2 pr-4 font-semibold">Candidates</th>
                  <th className="py-2 font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((t) => (
                  <tr key={t.id} className="border-b border-slate-50">
                    <td className="py-2.5 pr-4">
                      <p className="font-medium text-slate-800">{t.name}</p>
                      <p className="text-xs text-slate-400">{t.companyCode} · {t.city || "—"}, {t.country || "—"}</p>
                    </td>
                    <td className="py-2.5 pr-4">
                      <Badge tone={STATUS_TONE[t.status] || "slate"}>{t.status}</Badge>
                    </td>
                    <td className="py-2.5 pr-4 text-slate-600">
                      {t.subscription ? `${t.subscription.plan || "—"} (${t.subscription.status})` : "none"}
                    </td>
                    <td className="py-2.5 pr-4 text-slate-600">{t.counts.jobs}</td>
                    <td className="py-2.5 pr-4 text-slate-600">{t.counts.candidates}</td>
                    <td className="py-2.5">
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => viewAsTenant(t)}
                          className="flex items-center gap-1 text-xs font-medium text-brand-700 hover:underline"
                          title="Read-only view of this tenant's dashboard"
                        >
                          <Eye className="h-3.5 w-3.5" /> View as
                        </button>
                        {t.status === "active" ? (
                          <button
                            onClick={() => setReasonFor({ tenant: t, action: "suspend" })}
                            className="text-xs font-medium text-red-600 hover:underline"
                          >
                            Suspend
                          </button>
                        ) : t.status === "suspended" ? (
                          <button
                            onClick={() => setReasonFor({ tenant: t, action: "reactivate" })}
                            className="text-xs font-medium text-emerald-600 hover:underline"
                          >
                            Reactivate
                          </button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pager page={data.page} total={data.total} limit={data.limit} onPage={setPage} />
        </>
      )}

      {reasonFor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4" onClick={() => setReasonFor(null)}>
          <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-base font-semibold text-slate-900">
              {reasonFor.action === "suspend" ? "Suspend" : "Reactivate"} {reasonFor.tenant.name}
            </h3>
            <p className="mt-1 text-sm text-slate-500">
              Every platform mutation requires a reason — it lands in the audit trail with your name on it.
            </p>
            <FormGroup className="mt-3">
              <Label required>Reason</Label>
              <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. non-payment escalation #4821" />
            </FormGroup>
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setReasonFor(null)}>
                Cancel
              </Button>
              <Button size="sm" disabled={reason.trim().length < 4} onClick={submitStatusChange}>
                Confirm
              </Button>
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}

function TrustTab() {
  const toast = useToast();
  const [data, setData] = useState(null);

  useEffect(() => {
    api
      .get("/platform/trust")
      .then((res) => setData(res.data))
      .catch((err) => toast.error(err.response?.data?.error || "Could not load trust metrics"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!data) return <Card><Skeleton className="h-40 w-full" /></Card>;

  const breakerTone = data.breaker === "closed" ? "green" : data.breaker === "half_open" ? "amber" : "red";
  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <p className="text-xs font-medium text-slate-400">LLM circuit breaker</p>
          <p className="mt-1"><Badge tone={breakerTone}>{data.breaker}</Badge></p>
        </Card>
        <Card>
          <p className="text-xs font-medium text-slate-400">Assessments (30d)</p>
          <p className="mt-1 text-2xl font-bold text-slate-900">{data.assessments.total}</p>
        </Card>
        <Card>
          <p className="text-xs font-medium text-slate-400">Review rate</p>
          <p className="mt-1 text-2xl font-bold text-slate-900">
            {data.assessments.reviewRate != null ? `${Math.round(data.assessments.reviewRate * 100)}%` : "—"}
          </p>
          <p className="text-[11px] text-slate-400">0% would mean overconfidence</p>
        </Card>
        <Card>
          <p className="text-xs font-medium text-slate-400">Ensemble agreement</p>
          <p className="mt-1 text-2xl font-bold text-slate-900">{data.assessments.meanEnsembleAgreement ?? "—"}</p>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <h3 className="mb-3 text-base font-semibold text-slate-900">Counterfactual bias probes (30d)</h3>
          <p className="text-sm text-slate-600">
            Ran on {data.assessments.counterfactuals.ran} assessment(s) · identical result{" "}
            {data.assessments.counterfactuals.identical} · <span className="font-semibold text-red-600">{data.assessments.counterfactuals.leaks} leak(s)</span>
          </p>
          <p className="mt-2 text-xs text-slate-400">
            A leak = swapping demographic proxies changed the outcome. Anything above zero is an incident, not a statistic.
          </p>
        </Card>
        <Card>
          <h3 className="mb-3 text-base font-semibold text-slate-900">Scoring engine mix (30d)</h3>
          <div className="space-y-1.5 text-sm text-slate-600">
            {Object.entries(data.engineMix).length === 0 && <p className="text-slate-400">No scored candidates in range.</p>}
            {Object.entries(data.engineMix).map(([engine, n]) => (
              <p key={engine}>
                <Badge tone={engine === "evidence" ? "green" : engine === "fallback-legacy" ? "amber" : "slate"}>{engine}</Badge>{" "}
                {n} candidate(s)
              </p>
            ))}
          </div>
          <p className="mt-2 text-xs text-slate-400">fallback-legacy = the labelled no-AI path carried the decision — uncertainty stays visible.</p>
        </Card>
      </div>

      <Card>
        <h3 className="mb-3 text-base font-semibold text-slate-900">LLM spend by kind (30d)</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-xs uppercase tracking-wide text-slate-400">
                <th className="py-2 pr-4 font-semibold">Kind</th>
                <th className="py-2 pr-4 font-semibold">Calls</th>
                <th className="py-2 pr-4 font-semibold">Cost</th>
                <th className="py-2 font-semibold">Fallback calls</th>
              </tr>
            </thead>
            <tbody>
              {data.spendByKind.map((r) => (
                <tr key={r.kind} className="border-b border-slate-50">
                  <td className="py-2 pr-4 font-mono text-xs text-slate-700">{r.kind}</td>
                  <td className="py-2 pr-4 text-slate-600">{r.calls}</td>
                  <td className="py-2 pr-4 text-slate-600">₹{(r.costCents / 100).toFixed(2)}</td>
                  <td className="py-2 text-slate-600">{r.fallback}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card>
        <h3 className="mb-3 text-base font-semibold text-slate-900">Per-tenant assessment volume (30d)</h3>
        <div className="space-y-1.5 text-sm">
          {data.tenants.map((t) => (
            <div key={t.company} className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2">
              <span className="text-slate-700">{t.companyName}</span>
              <span className="text-xs text-slate-500">
                {t.assessments} assessed · review {t.reviewRate != null ? `${Math.round(t.reviewRate * 100)}%` : "—"}
              </span>
            </div>
          ))}
          {data.tenants.length === 0 && <p className="text-slate-400">No evidence-engine assessments in range.</p>}
        </div>
      </Card>
    </div>
  );
}

function LogTab({ endpoint, columns, filters }) {
  const toast = useToast();
  const [data, setData] = useState(null);
  const [page, setPage] = useState(1);
  const [filterValues, setFilterValues] = useState({});

  const load = useCallback(async () => {
    try {
      const params = { page };
      for (const [k, v] of Object.entries(filterValues)) if (v) params[k] = v;
      const res = await api.get(endpoint, { params });
      setData(res.data);
    } catch (err) {
      toast.error(err.response?.data?.error || "Could not load");
    }
  }, [endpoint, page, filterValues, toast]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <Card>
      {filters?.length > 0 && (
        <div className="mb-4 flex flex-wrap gap-3">
          {filters.map((f) => (
            <Input
              key={f.key}
              placeholder={f.label}
              value={filterValues[f.key] || ""}
              onChange={(e) => {
                setPage(1);
                setFilterValues((v) => ({ ...v, [f.key]: e.target.value }));
              }}
              className="max-w-[200px]"
            />
          ))}
        </div>
      )}
      {!data ? (
        <Skeleton className="h-40 w-full" />
      ) : (data.items || data.rows || []).length === 0 ? (
        <p className="py-8 text-center text-sm text-slate-400">No rows in range.</p>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-xs uppercase tracking-wide text-slate-400">
                  {columns.map((c) => (
                    <th key={c.label} className="py-2 pr-4 font-semibold">{c.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(data.items || data.rows).map((row, i) => (
                  <tr key={row._id || i} className="border-b border-slate-50 align-top">
                    {columns.map((c) => (
                      <td key={c.label} className="py-2 pr-4 text-slate-600">{c.render(row)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {data.total != null && <Pager page={data.page} total={data.total} limit={data.limit} onPage={setPage} />}
        </>
      )}
    </Card>
  );
}

export default function PlatformConsole() {
  const navigate = useNavigate();
  const [tab, setTab] = useState("tenants");

  function logout() {
    clearAdminAuth();
    navigate("/login");
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-slate-900 px-5 py-3 text-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between">
          <p className="flex items-center gap-2 font-display text-base font-bold">
            <Sparkles className="h-4.5 w-4.5 text-brand-300" /> HireFlow AI — Platform Console
          </p>
          <button onClick={logout} className="flex items-center gap-1.5 text-sm text-slate-300 hover:text-white">
            <LogOut className="h-4 w-4" /> Log out
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-6xl space-y-6 px-5 py-6">
        <div className="flex flex-wrap gap-2">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`flex items-center gap-1.5 rounded-xl border px-3.5 py-2 text-sm font-semibold transition ${
                tab === t.key ? "border-brand-500 bg-brand-50 text-brand-700" : "border-slate-200 bg-white text-slate-600 hover:bg-slate-100"
              }`}
            >
              <t.icon className="h-4 w-4" /> {t.label}
            </button>
          ))}
        </div>

        {tab === "tenants" && <TenantsTab />}
        {tab === "trust" && <TrustTab />}
        {tab === "audit" && (
          <LogTab
            endpoint="/platform/audit-logs"
            filters={[
              { key: "action", label: "Action prefix" },
              { key: "actorEmail", label: "Actor email" },
            ]}
            columns={[
              { label: "When", render: (r) => new Date(r.createdAt).toLocaleString() },
              { label: "Actor", render: (r) => r.actorEmail || "system" },
              { label: "Action", render: (r) => <span className="font-mono text-xs">{r.action}</span> },
              { label: "Target", render: (r) => (r.resourceType ? `${r.resourceType} ${r.resourceId || ""}` : "—") },
              { label: "Status", render: (r) => r.statusCode || "—" },
            ]}
          />
        )}
        {tab === "email" && (
          <LogTab
            endpoint="/platform/email-logs"
            filters={[
              { key: "to", label: "Recipient email" },
              { key: "status", label: "Status (sent/failed…)" },
              { key: "category", label: "Category" },
            ]}
            columns={[
              { label: "When", render: (r) => new Date(r.createdAt).toLocaleString() },
              { label: "To", render: (r) => r.to },
              { label: "Subject", render: (r) => r.subject },
              { label: "Category", render: (r) => r.category || "—" },
              { label: "Status", render: (r) => <Badge tone={STATUS_TONE[r.status] || "slate"}>{r.status}</Badge> },
              { label: "Error", render: (r) => r.error || "—" },
            ]}
          />
        )}
        {tab === "usage" && (
          <LogTab
            endpoint="/platform/usage"
            filters={[]}
            columns={[
              { label: "Tenant", render: (r) => r.companyName },
              { label: "Kind", render: (r) => <span className="font-mono text-xs">{r.kind}</span> },
              { label: "Calls", render: (r) => r.calls },
              { label: "Tokens", render: (r) => r.totalTokens },
              { label: "Cost", render: (r) => `₹${(r.costCents / 100).toFixed(2)}` },
              { label: "Cached", render: (r) => r.cached },
              { label: "Fallback", render: (r) => r.fallback },
            ]}
          />
        )}
        {tab === "leads" && (
          <LogTab
            endpoint="/platform/demo-requests"
            filters={[]}
            columns={[
              { label: "When", render: (r) => new Date(r.createdAt).toLocaleString() },
              { label: "Company", render: (r) => r.companyName },
              { label: "Email", render: (r) => r.email },
              { label: "Phone", render: (r) => r.phone || "—" },
              { label: "Size", render: (r) => r.companySize || "—" },
              { label: "Message", render: (r) => <span className="line-clamp-2 max-w-xs text-xs">{r.message || "—"}</span> },
            ]}
          />
        )}
      </main>
    </div>
  );
}
