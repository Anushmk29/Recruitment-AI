// Reports (Phase 12) — server-side analytics over date ranges, replacing the
// old client-side bars over whatever happened to be in memory. Includes the
// evidence-native reports only this engine can produce and the one-click
// Bias Audit Pack export.
import { useCallback, useEffect, useState } from "react";
import {
  BarChart3,
  ShieldCheck,
  Scale,
  TrendingDown,
  Users,
  Bot,
  Award,
  Clock,
  CheckCircle2,
  AlertTriangle,
  XCircle,
} from "lucide-react";
import api from "../../api/client.js";
import { Card, Badge, Skeleton, EmptyState } from "../../components/ui/Card.jsx";
import Button from "../../components/ui/Button.jsx";
import { useToast } from "../../components/ui/Toast.jsx";
import { stageLabel, stageTone } from "../../lib/pipeline.js";

const RANGES = [
  { key: "30", label: "30 days" },
  { key: "90", label: "90 days" },
  { key: "365", label: "1 year" },
];

// Fill color per semantic tone — mirrors Badge's tone vocabulary so a bar and
// its accompanying badge or stage color always agree.
const TONE_FILL = {
  slate: "bg-slate-400",
  brand: "bg-brand-600",
  green: "bg-emerald-500",
  amber: "bg-amber-500",
  red: "bg-red-500",
};

function SectionHeading({ children }) {
  return <h2 className="text-sm font-semibold text-slate-500">{children}</h2>;
}

// A labelled proportion bar: value, share, and a fill on one row. Used for
// the funnel and the screening-decision breakdown, where every row needs to
// stand on its own without cross-referencing a legend.
function ProportionRow({ icon: Icon, label, value, total, tone = "brand" }) {
  const pct = total ? Math.round((value / total) * 100) : 0;
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between gap-3 text-sm">
        <span className="flex items-center gap-1.5 font-medium text-slate-700">
          {Icon && <Icon className="h-3.5 w-3.5 shrink-0 text-slate-500" />}
          {label}
        </span>
        <span className="shrink-0 tabular-nums text-slate-500">
          <span className="font-semibold text-slate-800">{value}</span> <span className="text-slate-500">· {pct}%</span>
        </span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
        <div className={`h-full rounded-full ${TONE_FILL[tone]}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

// Compact ranked-list row — a proportional fill sits behind the label so
// relative magnitude reads at a glance without a second axis or a chart.
function RankedRow({ label, value, maxValue, tone = "brand" }) {
  const pct = maxValue ? Math.max(value ? 6 : 0, Math.round((value / maxValue) * 100)) : 0;
  return (
    <div className="relative overflow-hidden rounded-lg bg-slate-50">
      <div className={`absolute inset-y-0 left-0 ${TONE_FILL[tone]} opacity-[0.14]`} style={{ width: `${pct}%` }} />
      <div className="relative flex items-center justify-between gap-3 px-3 py-2 text-sm">
        <span className="text-slate-700">{label}</span>
        <span className="shrink-0 tabular-nums font-semibold text-slate-800">{value}</span>
      </div>
    </div>
  );
}

// Verified / contradicted / inconclusive as a single stacked bar — the same
// "show the work" instinct as the per-candidate score explanation, applied
// to an aggregate instead of one person.
function VerdictSplit({ verified, contradicted, inconclusive, total, className = "" }) {
  if (!total) return <div className={`h-1.5 w-full rounded-full bg-slate-100 ${className}`} />;
  const seg = (n) => `${Math.max(0, (n / total) * 100)}%`;
  return (
    <div className={`flex h-1.5 w-full overflow-hidden rounded-full bg-slate-100 ${className}`}>
      <div className="bg-emerald-500" style={{ width: seg(verified) }} />
      <div className="bg-red-400" style={{ width: seg(contradicted) }} />
      <div className="bg-amber-400" style={{ width: seg(inconclusive) }} />
    </div>
  );
}

function KpiStat({ icon: Icon, label, value, hint }) {
  return (
    <div className="flex flex-col gap-2 px-5 py-4">
      <div className="flex items-center gap-1.5 text-slate-500">
        {Icon && <Icon className="h-3.5 w-3.5" />}
        <span className="text-xs font-semibold text-slate-500">{label}</span>
      </div>
      <p className="text-3xl font-bold tabular-nums text-slate-900">{value ?? "—"}</p>
      {hint && <p className="text-[11px] leading-snug text-slate-500">{hint}</p>}
    </div>
  );
}

// Score-distribution histogram with the count printed above each bar — a
// hover-only tooltip is not a legible primary reading for a recruiter
// scanning quickly.
function ScoreHistogram({ bins }) {
  const max = Math.max(1, ...bins.map((b) => b.count));
  return (
    <div>
      <div className="flex h-32 items-end gap-1.5 border-b border-slate-200">
        {bins.map((b) => (
          <div key={b.lo} className="flex flex-1 flex-col items-center justify-end gap-1">
            <span className="text-[10px] font-semibold tabular-nums text-slate-500">{b.count || ""}</span>
            <div
              className="w-full rounded-t bg-brand-500"
              style={{ height: `${b.count ? Math.max(4, Math.round((b.count / max) * 100)) : 0}%` }}
              title={`${b.lo}–${b.hi}: ${b.count} candidate${b.count === 1 ? "" : "s"}`}
            />
          </div>
        ))}
      </div>
      <div className="mt-1.5 flex gap-1.5">
        {bins.map((b) => (
          <span key={b.lo} className="flex-1 text-center text-[10px] text-slate-500">
            {b.lo}
          </span>
        ))}
      </div>
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
  const maxElimination = Math.max(1, ...((evidence?.topEliminators || []).map((e) => e.eliminations)));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 [overflow-wrap:anywhere]">Reports</h1>
          <p className="mt-1 text-sm text-slate-500">Hiring funnel, score distribution, and evidence-quality signals for the selected period.</p>
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
        <div className="space-y-6">
          <Card className="p-0">
            <div className="grid grid-cols-1 divide-y divide-slate-100 sm:grid-cols-5 sm:divide-x sm:divide-y-0">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="p-5">
                  <Skeleton className="h-3 w-20" />
                  <Skeleton className="mt-3 h-8 w-14" />
                </div>
              ))}
            </div>
          </Card>
          <div className="grid gap-4 sm:grid-cols-2">
            <Card><Skeleton className="h-40 w-full" /></Card>
            <Card><Skeleton className="h-40 w-full" /></Card>
          </div>
        </div>
      ) : !overview || overview.totals.candidates === 0 ? (
        <Card>
          <EmptyState icon={BarChart3} title="No data in this period" description="Reports populate once candidates apply within the selected range." />
        </Card>
      ) : (
        <>
          {/* KPI strip — one ledger row rather than five same-size cards */}
          <Card className="p-0">
            <div className="grid grid-cols-1 divide-y divide-slate-100 sm:grid-cols-5 sm:divide-x sm:divide-y-0">
              <KpiStat icon={Users} label="Candidates" value={totals.candidates} />
              <KpiStat icon={Bot} label="AI interviews completed" value={totals.interviewsCompleted} />
              <KpiStat icon={CheckCircle2} label="Offers accepted" value={totals.offersAccepted} />
              <KpiStat icon={Award} label="Joined" value={totals.hires} />
              <KpiStat
                icon={Clock}
                label="Time to hire"
                value={overview.timeToHire.medianDays != null ? `${overview.timeToHire.medianDays}d` : "—"}
                hint={overview.timeToHire.n ? `median of ${overview.timeToHire.n} hires · mean ${overview.timeToHire.meanDays}d` : "no completed hires in range"}
              />
            </div>
          </Card>

          <SectionHeading>Pipeline health</SectionHeading>
          <div className="grid gap-6 lg:grid-cols-3">
            <Card>
              <div className="mb-4 flex items-center justify-between">
                <h3 className="text-base font-semibold text-slate-900">Screening decisions</h3>
                <Badge tone="slate">{screening.scoreSource === "evidence" ? "evidence engine" : "legacy ATS"}</Badge>
              </div>
              <div className="space-y-4">
                <ProportionRow icon={CheckCircle2} label="Advance" value={screening.decisions.pass} total={totals.candidates} tone="green" />
                <ProportionRow icon={AlertTriangle} label="Human review" value={screening.decisions.review} total={totals.candidates} tone="amber" />
                <ProportionRow icon={XCircle} label="Decline" value={screening.decisions.fail} total={totals.candidates} tone="red" />
              </div>
              <p className="mt-4 border-t border-slate-100 pt-3 text-xs text-slate-500">
                {screening.reviewRate != null ? `${Math.round(screening.reviewRate * 100)}%` : "—"} routed to human review. That band exists by
                design — ambiguous evidence goes to a person instead of a falsely confident score.
              </p>
            </Card>

            <Card>
              <h3 className="mb-1 text-base font-semibold text-slate-900">Score distribution</h3>
              <p className="mb-3 text-xs text-slate-500">Candidates by screening score, this period.</p>
              <ScoreHistogram bins={screening.scoreDistribution} />
            </Card>

            <Card>
              <h3 className="mb-1 text-base font-semibold text-slate-900">Funnel</h3>
              <p className="mb-3 text-xs text-slate-500">Stage reached, of {overview.funnel.total} candidates.</p>
              <div className="space-y-3">
                {funnelStages.map((s) => (
                  <ProportionRow key={s.stage} label={stageLabel(s.stage)} value={s.count} total={overview.funnel.total} tone={stageTone(s.stage)} />
                ))}
              </div>
              <p className="mt-3 border-t border-slate-100 pt-3 text-xs text-slate-500">{overview.funnel.rejected} rejected in period.</p>
            </Card>
          </div>

          {/* Evidence-native — reports only this architecture can produce */}
          <SectionHeading>Evidence intelligence</SectionHeading>
          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <h3 className="mb-1 flex items-center gap-2 text-base font-semibold text-slate-900">
                <Scale className="h-4 w-4 text-brand-600" /> What eliminates candidates
              </h3>
              <p className="mb-3 text-xs text-slate-500">Rubric criteria most often responsible for a decline, ranked by frequency.</p>
              <div className="space-y-2">
                {(evidence?.topEliminators || []).slice(0, 6).map((e) => (
                  <RankedRow key={e.criterionId} label={e.label} value={e.eliminations} maxValue={maxElimination} tone="red" />
                ))}
                {(!evidence || evidence.topEliminators.length === 0) && (
                  <p className="text-sm text-slate-500">No evidence-engine declines in this period yet.</p>
                )}
              </div>
            </Card>

            <Card>
              <h3 className="mb-1 flex items-center gap-2 text-base font-semibold text-slate-900">
                <TrendingDown className="h-4 w-4 text-brand-600" /> Claim verification by skill
              </h3>
              <p className="mb-3 text-xs text-slate-500">
                Skills claimed on a résumé but most often contradicted once tested in the interview — patterns of overstatement no keyword
                scanner can catch.
              </p>
              <div className="space-y-2.5">
                {(evidence?.claimVerificationBySkill || []).slice(0, 6).map((s) => (
                  <div key={s.skill} className="rounded-lg bg-slate-50 px-3 py-2.5">
                    <div className="flex items-center justify-between gap-3 text-sm">
                      <span className="font-medium text-slate-700">{s.skill}</span>
                      <span className="shrink-0 tabular-nums text-xs text-slate-500">
                        {s.verified} verified · {s.contradicted} contradicted · {s.inconclusive} unclear
                      </span>
                    </div>
                    <VerdictSplit className="mt-2" verified={s.verified} contradicted={s.contradicted} inconclusive={s.inconclusive} total={s.probed} />
                  </div>
                ))}
                {(!evidence || evidence.claimVerificationBySkill.length === 0) && (
                  <p className="text-sm text-slate-500">No assessed claim-probes in this period yet.</p>
                )}
              </div>
            </Card>

            {/* Phase 15.9 — source quality by downstream truth, not click volume */}
            {sources?.length > 0 && (
              <Card className="lg:col-span-2">
                <h3 className="mb-1 text-base font-semibold text-slate-900">Source quality</h3>
                <p className="mb-3 text-xs text-slate-500">
                  Pass rate, interview verification, and advance rate by source — measured by what happened after the click, not by volume.
                  Source never influences a score.
                </p>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead>
                      <tr className="border-b border-slate-200 text-xs font-semibold text-slate-500">
                        <th className="py-2 pr-4">Source</th>
                        <th className="py-2 pr-4 text-right">Applied</th>
                        <th className="py-2 pr-4 text-right">Pass rate</th>
                        <th className="py-2 pr-4">Claims verified</th>
                        <th className="py-2 pr-4 text-right">Advance rate</th>
                        <th className="py-2 text-right">Hires</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sources.map((s) => (
                        <tr key={s.channel} className="border-b border-slate-50 hover:bg-slate-50/60">
                          <td className="py-2.5 pr-4 font-medium text-slate-700">{s.channel}</td>
                          <td className="py-2.5 pr-4 text-right tabular-nums text-slate-600">{s.applied}</td>
                          <td className="py-2.5 pr-4 text-right tabular-nums text-slate-600">
                            {s.atsPassRate != null ? `${Math.round(s.atsPassRate * 100)}%` : "—"}
                          </td>
                          <td className="py-2.5 pr-4">
                            {s.probed > 0 ? (
                              <div className="flex items-center gap-2">
                                <VerdictSplit
                                  className="w-14"
                                  verified={s.verified}
                                  contradicted={s.contradicted}
                                  inconclusive={Math.max(0, s.probed - s.verified - s.contradicted)}
                                  total={s.probed}
                                />
                                <span className="shrink-0 tabular-nums text-xs text-slate-500">
                                  {s.verified}/{s.probed}
                                </span>
                              </div>
                            ) : (
                              <span className="text-xs text-slate-500">no probes yet</span>
                            )}
                          </td>
                          <td className="py-2.5 pr-4 text-right tabular-nums text-slate-600">
                            {s.advanceRate != null ? `${Math.round(s.advanceRate * 100)}%` : "—"}
                          </td>
                          <td className="py-2.5 text-right tabular-nums text-slate-600">{s.hires}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            )}

            {evidence?.lowValueCriteria?.length > 0 && (
              <Card className="lg:col-span-2">
                <h3 className="mb-1 text-base font-semibold text-slate-900">Criteria with no predictive value</h3>
                <p className="mb-3 text-xs text-slate-500">
                  These criteria show no relationship to who actually advances — worth a look in the rubric editor. Nothing here is auto-tuned.
                </p>
                <div className="grid gap-2 sm:grid-cols-2">
                  {evidence.lowValueCriteria.slice(0, 6).map((c) => (
                    <div key={`${c.rubricId}-${c.criterionId}`} className="flex items-center justify-between gap-3 rounded-lg bg-amber-50 px-3 py-2 text-sm">
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
