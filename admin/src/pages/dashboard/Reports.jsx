// Reports (Phase 12) — server-side analytics over date ranges, replacing the
// old client-side bars over whatever happened to be in memory. Includes the
// evidence-native reports only this engine can produce and the one-click
// Bias Audit Pack export.
import { useCallback, useEffect, useState } from "react";
import { BarChart3, ShieldCheck, Scale, TrendingDown } from "lucide-react";
import api from "../../api/client.js";
import { Card, Badge, Skeleton, EmptyState } from "../../components/ui/Card.jsx";
import Button from "../../components/ui/Button.jsx";
import { useToast } from "../../components/ui/Toast.jsx";
import { stageLabel } from "../../lib/pipeline.js";

const RANGES = [
  { key: "30", label: "30 days" },
  { key: "90", label: "90 days" },
  { key: "365", label: "1 year" },
];

function Bar({ label, value, total, color, suffix }) {
  const pct = total ? Math.round((value / total) * 100) : 0;
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-sm">
        <span className="font-medium text-slate-600">{label}</span>
        <span className="text-slate-400">
          {value}
          {suffix ? ` ${suffix}` : ""} ({pct}%)
        </span>
      </div>
      <div className="h-2.5 w-full rounded-full bg-slate-100">
        <div className={`h-2.5 rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function Stat({ label, value, hint }) {
  return (
    <div className="rounded-2xl bg-slate-50 p-4">
      <p className="text-2xl font-bold text-slate-900">{value ?? "—"}</p>
      <p className="text-xs font-medium text-slate-500">{label}</p>
      {hint && <p className="mt-0.5 text-[11px] text-slate-400">{hint}</p>}
    </div>
  );
}

export default function Reports() {
  const toast = useToast();
  const [days, setDays] = useState("90");
  const [overview, setOverview] = useState(null);
  const [evidence, setEvidence] = useState(null);
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState(false);

  const [sources, setSources] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    const from = new Date(Date.now() - Number(days) * 86400000).toISOString().slice(0, 10);
    try {
      const [ov, ev, src] = await Promise.all([
        api.get("/analytics/overview", { params: { from } }),
        api.get("/analytics/evidence", { params: { from } }).catch(() => ({ data: null })),
        api.get("/analytics/sources", { params: { from } }).catch(() => ({ data: null })),
      ]);
      setOverview(ov.data);
      setEvidence(ev.data);
      setSources(src.data?.sources || null);
    } catch (err) {
      toast.error(err.response?.data?.error || "Could not load analytics");
    } finally {
      setLoading(false);
    }
  }, [days, toast]);

  useEffect(() => {
    load();
  }, [load]);

  async function downloadAuditPack() {
    setDownloading(true);
    try {
      const res = await api.get("/analytics/audit-pack", { responseType: "blob" });
      const url = URL.createObjectURL(new Blob([res.data], { type: "application/json" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = `bias-audit-pack-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      toast.error("Could not export the audit pack.");
    } finally {
      setDownloading(false);
    }
  }

  const totals = overview?.totals;
  const screening = overview?.screening;
  const funnelStages = (overview?.funnel?.stages || []).filter((s) => s.count > 0);
  const maxScoreBin = Math.max(1, ...(screening?.scoreDistribution || []).map((b) => b.count));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Reports</h1>
          <p className="mt-1 text-sm text-slate-500">Pass rates, time-to-hire, score distributions — computed server-side over real data.</p>
        </div>
        <div className="flex items-center gap-2">
          {RANGES.map((r) => (
            <button
              key={r.key}
              onClick={() => setDays(r.key)}
              className={`rounded-xl border px-3 py-1.5 text-sm font-semibold transition ${
                days === r.key ? "border-brand-500 bg-brand-50 text-brand-700" : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
              }`}
            >
              {r.label}
            </button>
          ))}
          <Button variant="outline" size="sm" loading={downloading} onClick={downloadAuditPack}>
            <ShieldCheck className="h-4 w-4" /> Bias Audit Pack
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <Card><Skeleton className="h-40 w-full" /></Card>
          <Card><Skeleton className="h-40 w-full" /></Card>
        </div>
      ) : !overview || overview.totals.candidates === 0 ? (
        <Card>
          <EmptyState icon={BarChart3} title="No data in this period" description="Reports populate once candidates apply within the selected range." />
        </Card>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <Stat label="Candidates" value={totals.candidates} />
            <Stat label="AI interviews completed" value={totals.interviewsCompleted} />
            <Stat label="Offers accepted" value={totals.offersAccepted} />
            <Stat label="Joined" value={totals.hires} />
            <Stat
              label="Time to hire"
              value={overview.timeToHire.medianDays != null ? `${overview.timeToHire.medianDays}d` : "—"}
              hint={overview.timeToHire.n ? `median of ${overview.timeToHire.n} hires (mean ${overview.timeToHire.meanDays}d)` : "no completed hires in range"}
            />
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-base font-semibold text-slate-900">Screening decisions</h2>
                <Badge tone="slate">{screening.scoreSource === "evidence" ? "evidence engine" : "legacy ATS"}</Badge>
              </div>
              <div className="space-y-4">
                <Bar label="Advance" value={screening.decisions.pass} total={totals.candidates} color="bg-emerald-500" />
                <Bar label="Human review" value={screening.decisions.review} total={totals.candidates} color="bg-amber-400" />
                <Bar label="Decline" value={screening.decisions.fail} total={totals.candidates} color="bg-red-400" />
              </div>
              <p className="mt-4 border-t border-slate-100 pt-3 text-xs text-slate-400">
                Review rate {screening.reviewRate != null ? `${Math.round(screening.reviewRate * 100)}%` : "—"} — the middle band is where
                human attention belongs; 0% would mean overconfidence.
              </p>
            </Card>

            <Card>
              <h2 className="mb-4 text-base font-semibold text-slate-900">Score distribution</h2>
              <div className="flex h-40 items-end gap-1.5">
                {screening.scoreDistribution.map((b) => (
                  <div key={b.lo} className="flex flex-1 flex-col items-center gap-1">
                    <div
                      className="w-full rounded-t bg-brand-500/80"
                      style={{ height: `${Math.round((b.count / maxScoreBin) * 100)}%`, minHeight: b.count ? 4 : 0 }}
                      title={`${b.lo}–${b.hi}: ${b.count}`}
                    />
                    <span className="text-[10px] text-slate-400">{b.lo}</span>
                  </div>
                ))}
              </div>
            </Card>

            <Card>
              <h2 className="mb-4 text-base font-semibold text-slate-900">Funnel (stage reached)</h2>
              <div className="space-y-3">
                {funnelStages.map((s) => (
                  <Bar key={s.stage} label={stageLabel(s.stage)} value={s.count} total={overview.funnel.total} color="bg-brand-600" />
                ))}
              </div>
              <p className="mt-3 text-xs text-slate-400">{overview.funnel.rejected} rejected in period.</p>
            </Card>

            {/* Evidence-native — reports only this architecture can produce */}
            <Card>
              <h2 className="mb-1 flex items-center gap-2 text-base font-semibold text-slate-900">
                <Scale className="h-4 w-4 text-brand-600" /> What eliminates candidates
              </h2>
              <p className="mb-3 text-xs text-slate-400">Criteria most often unmet among declined candidates (evidence engine).</p>
              <div className="space-y-2">
                {(evidence?.topEliminators || []).slice(0, 6).map((e) => (
                  <div key={e.criterionId} className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 text-sm">
                    <span className="text-slate-700">{e.label}</span>
                    <Badge tone="red">{e.eliminations}</Badge>
                  </div>
                ))}
                {(!evidence || evidence.topEliminators.length === 0) && (
                  <p className="text-sm text-slate-400">No evidence-engine declines in this period yet.</p>
                )}
              </div>
            </Card>

            <Card>
              <h2 className="mb-1 flex items-center gap-2 text-base font-semibold text-slate-900">
                <TrendingDown className="h-4 w-4 text-brand-600" /> Claim verification by skill
              </h2>
              <p className="mb-3 text-xs text-slate-400">
                Which claimed skills most often fail interview verification — résumé-inflation patterns no click-counting tool can see.
              </p>
              <div className="space-y-2">
                {(evidence?.claimVerificationBySkill || []).slice(0, 6).map((s) => (
                  <div key={s.skill} className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 text-sm">
                    <span className="text-slate-700">{s.skill}</span>
                    <span className="text-xs text-slate-500">
                      {s.verified}✓ · {s.contradicted}✗ · {s.inconclusive}? of {s.probed} probed
                    </span>
                  </div>
                ))}
                {(!evidence || evidence.claimVerificationBySkill.length === 0) && (
                  <p className="text-sm text-slate-400">No assessed claim-probes in this period yet.</p>
                )}
              </div>
            </Card>

            {/* Phase 15.9 — source quality by downstream truth, not click volume */}
            {sources?.length > 0 && (
              <Card className="lg:col-span-2">
                <h2 className="mb-1 text-base font-semibold text-slate-900">Source quality</h2>
                <p className="mb-3 text-xs text-slate-400">
                  Per source: screening pass rate, interview claim-verification rate, advance rate, hires — measured by
                  what happened downstream, not by click volume. Source never affects a score.
                </p>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead>
                      <tr className="border-b border-slate-100 text-xs uppercase tracking-wide text-slate-400">
                        <th className="py-2 pr-4 font-semibold">Source</th>
                        <th className="py-2 pr-4 font-semibold">Applied</th>
                        <th className="py-2 pr-4 font-semibold">Pass rate</th>
                        <th className="py-2 pr-4 font-semibold">Claims verified</th>
                        <th className="py-2 pr-4 font-semibold">Advance rate</th>
                        <th className="py-2 font-semibold">Hires</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sources.map((s) => (
                        <tr key={s.channel} className="border-b border-slate-50">
                          <td className="py-2 pr-4 font-medium text-slate-700">{s.channel}</td>
                          <td className="py-2 pr-4 text-slate-600">{s.applied}</td>
                          <td className="py-2 pr-4 text-slate-600">{s.atsPassRate != null ? `${Math.round(s.atsPassRate * 100)}%` : "—"}</td>
                          <td className="py-2 pr-4 text-slate-600">
                            {s.probed > 0 ? `${s.verified}✓ / ${s.contradicted}✗ of ${s.probed}` : "no probes yet"}
                          </td>
                          <td className="py-2 pr-4 text-slate-600">{s.advanceRate != null ? `${Math.round(s.advanceRate * 100)}%` : "—"}</td>
                          <td className="py-2 text-slate-600">{s.hires}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            )}

            {evidence?.lowValueCriteria?.length > 0 && (
              <Card>
                <h2 className="mb-1 text-base font-semibold text-slate-900">Criteria with no predictive value</h2>
                <p className="mb-3 text-xs text-slate-400">
                  Outcome-joined analysis — these criteria don't separate advanced from rejected candidates. Review them in the rubric
                  editor; nothing is auto-tuned.
                </p>
                <div className="space-y-2">
                  {evidence.lowValueCriteria.slice(0, 6).map((c) => (
                    <div key={`${c.rubricId}-${c.criterionId}`} className="flex items-center justify-between rounded-lg bg-amber-50 px-3 py-2 text-sm">
                      <span className="text-slate-700">{c.label}</span>
                      <Badge tone={c.insight === "inverse" ? "red" : "amber"}>{c.insight === "inverse" ? "anti-predictive" : "no signal"}</Badge>
                    </div>
                  ))}
                </div>
              </Card>
            )}
          </div>
        </>
      )}
    </div>
  );
}
