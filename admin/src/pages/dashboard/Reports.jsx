import { BarChart3 } from "lucide-react";
import { useCompanyData } from "../../context/CompanyDataContext.jsx";
import { Card, Skeleton, EmptyState } from "../../components/ui/Card.jsx";
import { ALL_STAGES, stageLabel, normalizeStage } from "../../lib/pipeline.js";

function Bar({ label, value, total, color }) {
  const pct = total ? Math.round((value / total) * 100) : 0;
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-sm">
        <span className="font-medium text-slate-600">{label}</span>
        <span className="text-slate-400">{value} ({pct}%)</span>
      </div>
      <div className="h-2.5 w-full rounded-full bg-slate-100">
        <div className={`h-2.5 rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export default function Reports() {
  const { allCandidates, jobs, loading } = useCompanyData();

  const total = allCandidates.length;
  const passCount = allCandidates.filter((c) => c.ats?.decision === "pass").length;
  const failCount = allCandidates.filter((c) => c.ats?.decision === "fail").length;
  const pendingCount = allCandidates.filter((c) => !c.ats?.decision || c.ats.decision === "pending").length;

  const byStatus = ALL_STAGES.map((status) => ({
    status,
    count: allCandidates.filter((c) => normalizeStage(c.status) === status).length,
  })).filter((s) => s.count > 0);

  const byJob = jobs
    .map((job) => ({ job, count: allCandidates.filter((c) => (c.job?._id || c.job) === job._id).length }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 6);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Reports</h1>
        <p className="mt-1 text-sm text-slate-500">Hiring funnel and ATS performance across your company.</p>
      </div>

      {loading ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <Card><Skeleton className="h-40 w-full" /></Card>
          <Card><Skeleton className="h-40 w-full" /></Card>
        </div>
      ) : total === 0 ? (
        <Card>
          <EmptyState icon={BarChart3} title="No data yet" description="Reports will populate once candidates start applying to your jobs." />
        </Card>
      ) : (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <h2 className="mb-5 text-base font-semibold text-slate-900">ATS Decision Breakdown</h2>
            <div className="space-y-4">
              <Bar label="Passed" value={passCount} total={total} color="bg-emerald-500" />
              <Bar label="Failed" value={failCount} total={total} color="bg-red-400" />
              <Bar label="Pending" value={pendingCount} total={total} color="bg-slate-300" />
            </div>
          </Card>

          <Card>
            <h2 className="mb-5 text-base font-semibold text-slate-900">Pipeline by Status</h2>
            <div className="space-y-4">
              {byStatus.map((s) => (
                <Bar key={s.status} label={stageLabel(s.status)} value={s.count} total={total} color="bg-brand-600" />
              ))}
            </div>
          </Card>

          <Card className="lg:col-span-2">
            <h2 className="mb-5 text-base font-semibold text-slate-900">Applicants by Job</h2>
            <div className="space-y-4">
              {byJob.map(({ job, count }) => (
                <Bar key={job._id} label={job.title} value={count} total={total} color="bg-brand-400" />
              ))}
              {byJob.length === 0 && <p className="text-sm text-slate-400">No jobs yet.</p>}
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
