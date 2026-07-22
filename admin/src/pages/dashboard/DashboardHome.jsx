import { Link } from "react-router-dom";
import { Briefcase, Users, Bot, TrendingUp, Clock, ArrowUpRight } from "lucide-react";
import { useCompanyData } from "../../context/CompanyDataContext.jsx";
import { Card, Badge, Skeleton, EmptyState } from "../../components/ui/Card.jsx";
import { stageLabel, stageTone } from "../../lib/pipeline.js";

function timeAgo(date) {
  const diff = Date.now() - new Date(date).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export default function DashboardHome() {
  const { jobs, allCandidates, queue, loading } = useCompanyData();

  const publishedJobs = jobs.filter((j) => j.status === "published").length;
  const passed = allCandidates.filter((c) => c.ats?.decision === "pass").length;
  const scored = allCandidates.filter((c) => c.ats?.decision && c.ats.decision !== "pending");
  const avgScore = scored.length ? Math.round(scored.reduce((sum, c) => sum + (c.ats?.overallScore || 0), 0) / scored.length) : 0;

  const recentCandidates = [...allCandidates]
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, 6);

  const stats = [
    { label: "Total Jobs", value: jobs.length, sub: `${publishedJobs} published`, icon: Briefcase },
    { label: "Total Applicants", value: allCandidates.length, sub: "across all jobs", icon: Users },
    { label: "AI Interview Queue", value: queue.length, sub: "passed ATS, awaiting interview", icon: Bot },
    { label: "Avg. ATS Score", value: `${avgScore}%`, sub: `${passed} candidates passed`, icon: TrendingUp },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Dashboard</h1>
        <p className="mt-1 text-sm text-slate-500">A live overview of your hiring pipeline.</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {loading
          ? Array.from({ length: 4 }).map((_, i) => (
              <Card key={i}>
                <Skeleton className="h-4 w-20" />
                <Skeleton className="mt-3 h-8 w-16" />
              </Card>
            ))
          : stats.map((s) => (
              <Card key={s.label}>
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">{s.label}</span>
                  <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-50 text-brand-600">
                    <s.icon className="h-4 w-4" />
                  </span>
                </div>
                <div className="mt-2 text-2xl font-bold text-slate-900">{s.value}</div>
                <p className="mt-0.5 text-xs text-slate-400">{s.sub}</p>
              </Card>
            ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-base font-semibold text-slate-900">Recent Applicants</h2>
            <Link to="/candidates" className="flex items-center gap-1 text-xs font-semibold text-brand-700 hover:underline">
              View all <ArrowUpRight className="h-3 w-3" />
            </Link>
          </div>
          {!loading && recentCandidates.length === 0 && (
            <EmptyState icon={Users} title="No applicants yet" description="New applicants will show up here as candidates apply to your published jobs." />
          )}
          <div className="divide-y divide-slate-100">
            {recentCandidates.map((c) => (
              <div key={c._id} className="flex items-center justify-between py-3">
                <div className="min-w-0">
                  <Link to={`/candidates/${c._id}`} className="truncate text-sm font-semibold text-slate-800 hover:text-brand-700">
                    {c.basicDetails?.name}
                  </Link>
                  <p className="truncate text-xs text-slate-400">{c.job?.title || "—"}</p>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  {c.ats?.overallScore != null && (
                    <span className="text-sm font-bold text-slate-700">{c.ats.overallScore}%</span>
                  )}
                  <Badge tone={stageTone(c.status)}>{stageLabel(c.status)}</Badge>
                </div>
              </div>
            ))}
          </div>
        </Card>

        <Card>
          <h2 className="mb-4 text-base font-semibold text-slate-900">Recent Activity</h2>
          {!loading && recentCandidates.length === 0 && (
            <p className="text-sm text-slate-400">Nothing to show yet.</p>
          )}
          <ul className="space-y-4">
            {recentCandidates.slice(0, 5).map((c) => (
              <li key={c._id} className="flex gap-3">
                <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-400">
                  <Clock className="h-3.5 w-3.5" />
                </span>
                <div className="text-sm">
                  <p className="text-slate-700">
                    <span className="font-semibold">{c.basicDetails?.name}</span> applied to{" "}
                    <span className="font-medium">{c.job?.title || "a job"}</span>
                  </p>
                  <p className="text-xs text-slate-400">{timeAgo(c.createdAt)}</p>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </div>
  );
}
