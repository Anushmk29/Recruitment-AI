/* Hallmark · genre: modern-minimal · macrostructure: Bento Grid (app-scope)
 * theme: HireFlow AI (DESIGN.md, locked) · accent: verification blue
 * pre-emit critique: P5 H5 E5 S5 R5 V5
 *
 * Every figure on this screen is derived from data the workspace already holds
 * — jobs, candidates, and the interview queue. There are no placeholder charts,
 * no sample series, and no invented deltas: where a comparison period has no
 * data, the delta renders as "—" rather than as a fabricated percentage.
 */

import { useMemo } from "react";
import { Link } from "react-router-dom";
import { Briefcase, Users, Bot, Scale, ArrowUpRight, AlertTriangle, Clock } from "lucide-react";
import { useCompanyData } from "../../context/CompanyDataContext.jsx";
import { Card, Badge, Skeleton, EmptyState } from "../../components/ui/Card.jsx";
import { stageLabel, stageTone } from "../../lib/pipeline.js";
import TrendChart from "../../components/dashboard/TrendChart.jsx";

const DAY = 86_400_000;

function timeAgo(date) {
  const mins = Math.floor((Date.now() - new Date(date).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

/** Initial monogram. No avatar images exist for candidates — a generated face
 *  would be a fabricated likeness of a real applicant. */
function Monogram({ name }) {
  return (
    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-100 text-sm font-bold text-brand-700">
      {(name || "?")[0].toUpperCase()}
    </span>
  );
}

function Delta({ value }) {
  // No prior period to compare against → say so. A "+100%" from a zero base is
  // the most common fabricated-looking stat in a dashboard.
  if (value == null) return <span className="text-xs text-slate-500">no prior period</span>;
  const up = value > 0;
  const flat = value === 0;
  return (
    <span
      className={`text-xs font-semibold tabular-nums ${
        flat ? "text-slate-500" : up ? "text-emerald-700" : "text-red-600"
      }`}
    >
      {flat ? "no change" : `${up ? "+" : ""}${value}% vs prior 30d`}
    </span>
  );
}

export default function DashboardHome() {
  const { me, jobs, allCandidates, queue, loading } = useCompanyData();

  const model = useMemo(() => {
    const now = Date.now();
    const dated = allCandidates.filter((c) => c.createdAt);

    const last30 = dated.filter((c) => now - new Date(c.createdAt).getTime() <= 30 * DAY).length;
    const prior30 = dated.filter((c) => {
      const age = now - new Date(c.createdAt).getTime();
      return age > 30 * DAY && age <= 60 * DAY;
    }).length;
    const applicantDelta = prior30 === 0 ? null : Math.round(((last30 - prior30) / prior30) * 100);

    // Twelve weekly buckets. Weeks, not days: a daily series on a low-volume
    // tenant is mostly zeroes and reads as a broken chart rather than a quiet one.
    const buckets = Array.from({ length: 12 }, (_, i) => {
      const end = now - (11 - i) * 7 * DAY;
      const start = end - 7 * DAY;
      const d = new Date(end);
      return {
        label: `${d.getDate()} ${d.toLocaleString("en", { month: "short" })}`,
        count: dated.filter((c) => {
          const t = new Date(c.createdAt).getTime();
          return t > start && t <= end;
        }).length,
      };
    });

    const scored = allCandidates.filter((c) => c.ats?.decision && c.ats.decision !== "pending");
    const avgScore = scored.length
      ? Math.round(scored.reduce((sum, c) => sum + (c.ats?.overallScore || 0), 0) / scored.length)
      : null;

    // Stage distribution, biggest first, zero-count stages dropped.
    const stageCounts = new Map();
    for (const c of allCandidates) {
      if (!c.status) continue;
      stageCounts.set(c.status, (stageCounts.get(c.status) || 0) + 1);
    }
    const stages = [...stageCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 7);
    const stageMax = stages.length ? stages[0][1] : 0;

    // On-thesis: a job with no approved rubric is scored by the legacy keyword
    // engine. That is a state a recruiter must not be able to miss.
    const unapprovedRubrics = jobs.filter((j) => j.rubricStatus !== "approved");

    return {
      applicantDelta,
      buckets,
      avgScore,
      scoredCount: scored.length,
      stages,
      stageMax,
      unapprovedRubrics,
      recent: [...allCandidates].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 6),
    };
  }, [allCandidates, jobs]);

  const stats = [
    {
      label: "Open jobs",
      value: jobs.length,
      icon: Briefcase,
      foot: `${jobs.filter((j) => j.status === "published").length} published`,
    },
    { label: "Applicants", value: allCandidates.length, icon: Users, delta: model.applicantDelta },
    { label: "Interview queue", value: queue.length, icon: Bot, foot: "passed screening, awaiting interview" },
    {
      label: "Average score",
      value: model.avgScore == null ? "—" : model.avgScore,
      icon: Scale,
      foot: model.avgScore == null ? "nothing scored yet" : `across ${model.scoredCount} scored`,
    },
  ];

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900 [overflow-wrap:anywhere]">
          {greeting()}
          {/* /auth/me returns the sanitized user directly, with `company` nested
              inside it — the name is me.name, not me.user.name. */}
          {me?.name ? `, ${me.name.split(" ")[0]}` : ""}
        </h1>
        <p className="mt-1 text-sm text-slate-500">A live view of the pipeline. Every figure here is computed from your own workspace.</p>
      </header>

      {/* KPI strip — one surface divided by hairlines, rather than four separate
          floating cards. The figures belong to one reading. */}
      <Card className="p-0">
        <div className="grid divide-y divide-slate-200 sm:grid-cols-2 sm:divide-y-0 lg:grid-cols-4 lg:divide-x">
          {stats.map((s) => (
            <div key={s.label} className="p-5 sm:border-b sm:border-slate-200 lg:border-b-0">
              <div className="flex items-center gap-2 text-slate-600">
                <s.icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                <span className="text-xs font-semibold">{s.label}</span>
              </div>
              {loading ? (
                <Skeleton className="mt-3 h-8 w-20" />
              ) : (
                <p className="mt-2 text-3xl font-bold tabular-nums tracking-tight text-slate-900">{s.value}</p>
              )}
              <p className="mt-1">{s.delta !== undefined ? <Delta value={s.delta} /> : <span className="text-xs text-slate-500">{s.foot}</span>}</p>
            </div>
          ))}
        </div>
      </Card>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <h2 className="text-base font-semibold text-slate-900">Applications received</h2>
            <p className="text-xs text-slate-500">Weekly, last 12 weeks</p>
          </div>
          {loading ? <Skeleton className="mt-4 h-44 w-full" /> : <TrendChart buckets={model.buckets} />}
        </Card>

        <Card>
          <h2 className="text-base font-semibold text-slate-900">Pipeline distribution</h2>
          <p className="mt-1 text-xs text-slate-500">Where candidates currently sit</p>
          {loading ? (
            <Skeleton className="mt-4 h-44 w-full" />
          ) : model.stages.length === 0 ? (
            <p className="mt-6 text-sm text-slate-500">No candidates yet.</p>
          ) : (
            <ul className="mt-5 space-y-3">
              {model.stages.map(([stage, count]) => (
                <li key={stage}>
                  <div className="flex items-baseline justify-between gap-3 text-sm">
                    <span className="truncate text-slate-700">{stageLabel(stage)}</span>
                    <span className="shrink-0 font-semibold tabular-nums text-slate-900">{count}</span>
                  </div>
                  {/* Width is the real proportion of the largest stage — the bar
                      is the number, not an illustration of it. */}
                  <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-slate-100">
                    <div
                      className="h-full rounded-full bg-brand-500"
                      style={{ width: `${model.stageMax ? (count / model.stageMax) * 100 : 0}%` }}
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <div className="mb-2 flex items-center justify-between gap-4">
            <h2 className="text-base font-semibold text-slate-900">Recent applicants</h2>
            <Link
              to="/candidates"
              className="inline-flex items-center gap-1 rounded-lg text-xs font-semibold whitespace-nowrap text-brand-700 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
            >
              View all <ArrowUpRight className="h-3 w-3" aria-hidden="true" />
            </Link>
          </div>

          {!loading && model.recent.length === 0 ? (
            <EmptyState
              icon={Users}
              title="No applicants yet"
              description="Applicants appear here as they apply to your published jobs."
            />
          ) : (
            <ul className="divide-y divide-slate-100">
              {model.recent.map((c) => (
                <li key={c._id} className="flex items-center gap-3 py-3">
                  <Monogram name={c.basicDetails?.name} />
                  <div className="min-w-0 flex-1">
                    <Link
                      to={`/candidates/${c._id}`}
                      className="block truncate rounded-lg text-sm font-semibold text-slate-800 hover:text-brand-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
                    >
                      {c.basicDetails?.name}
                    </Link>
                    <p className="truncate text-xs text-slate-500">
                      {c.job?.title || "—"} · {timeAgo(c.createdAt)}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    {c.ats?.overallScore != null && (
                      <span className="text-sm font-bold tabular-nums text-slate-700">{c.ats.overallScore}</span>
                    )}
                    <Badge tone={stageTone(c.status)}>{stageLabel(c.status)}</Badge>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {/* Needs attention — the tile that replaces a decorative "insights"
            panel with the two states that actually block a recruiter. */}
        <Card>
          <h2 className="text-base font-semibold text-slate-900">Needs a person</h2>
          <p className="mt-1 text-xs text-slate-500">Nothing here resolves itself</p>

          <div className="mt-5 space-y-4">
            <Link
              to="/review-queue"
              className="flex items-start gap-3 rounded-xl border border-slate-200 p-3 transition-colors duration-150 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
            >
              <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-amber-50 text-amber-700">
                <Scale className="h-4 w-4" aria-hidden="true" />
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-semibold text-slate-800">
                  <span className="tabular-nums">{queue.length}</span> in the review queue
                </span>
                <span className="block text-xs text-slate-500">Scores the engine was not confident about</span>
              </span>
            </Link>

            {model.unapprovedRubrics.length > 0 && (
              <Link
                to="/jobs"
                className="flex items-start gap-3 rounded-xl border border-slate-200 p-3 transition-colors duration-150 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
              >
                <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-red-50 text-red-600">
                  <AlertTriangle className="h-4 w-4" aria-hidden="true" />
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-slate-800">
                    <span className="tabular-nums">{model.unapprovedRubrics.length}</span> job
                    {model.unapprovedRubrics.length === 1 ? "" : "s"} without an approved rubric
                  </span>
                  <span className="block text-xs text-slate-500">
                    Those candidates are scored by the legacy keyword engine, not the evidence engine
                  </span>
                </span>
              </Link>
            )}

            {!loading && queue.length === 0 && model.unapprovedRubrics.length === 0 && (
              <p className="flex items-center gap-2 text-sm text-slate-500">
                <Clock className="h-4 w-4" aria-hidden="true" /> Nothing is waiting on you.
              </p>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}
