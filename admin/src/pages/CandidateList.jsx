import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { ArrowLeft, Users } from "lucide-react";
import api from "../api/client.js";
import { Card, Badge, Skeleton, EmptyState } from "../components/ui/Card.jsx";
import { Select } from "../components/ui/Field.jsx";
import { useToast } from "../components/ui/Toast.jsx";
import { allowedNextStages, stageLabel } from "../lib/pipeline.js";

export default function CandidateList() {
  const { id } = useParams();
  const toast = useToast();
  const [job, setJob] = useState(null);
  const [candidates, setCandidates] = useState([]);
  const [loading, setLoading] = useState(true);

  function load() {
    setLoading(true);
    Promise.all([api.get(`/jobs/${id}`), api.get(`/jobs/${id}/candidates`)])
      .then(([jobRes, candRes]) => {
        setJob(jobRes.data);
        setCandidates(candRes.data);
      })
      .finally(() => setLoading(false));
  }

  useEffect(load, [id]);

  async function handleStatusChange(candidateId, currentStatus, stage) {
    if (!stage || stage === currentStatus) return;
    try {
      await api.patch(`/candidates/${candidateId}/stage`, { stage });
      toast.success(`Moved to ${stageLabel(stage)}`);
      load();
    } catch (err) {
      toast.error(err.response?.data?.error || "Could not move candidate");
    }
  }

  return (
    <div className="space-y-6">
      <Link to="/jobs" className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-brand-700">
        <ArrowLeft className="h-4 w-4" /> Back to jobs
      </Link>
      <h1 className="text-2xl font-bold text-slate-900">Candidates{job ? ` — ${job.title}` : ""}</h1>

      <Card className="p-0">
        {loading ? (
          <div className="space-y-3 p-6">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-14 w-full" />
            ))}
          </div>
        ) : candidates.length === 0 ? (
          <div className="p-6">
            <EmptyState icon={Users} title="No candidates yet" description="Applicants for this job will appear here." />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-100 text-xs uppercase tracking-wide text-slate-400">
                <tr>
                  <th className="px-6 py-3 font-medium">Name</th>
                  <th className="px-6 py-3 font-medium">Email</th>
                  <th className="px-6 py-3 font-medium">ATS Score</th>
                  <th className="px-6 py-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {candidates.map((c) => (
                  <tr key={c._id}>
                    <td className="px-6 py-3 font-medium text-slate-800">
                      <Link to={`/candidates/${c._id}`} className="hover:text-brand-700">
                        {c.basicDetails?.name}
                      </Link>
                    </td>
                    <td className="px-6 py-3 text-slate-500">{c.basicDetails?.email}</td>
                    <td className="px-6 py-3">
                      {c.ats?.overallScore != null ? (
                        <Badge tone={c.ats.decision === "pass" ? "green" : c.ats.decision === "fail" ? "red" : "slate"}>
                          {c.ats.overallScore}%
                        </Badge>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-6 py-3">
                      <Select
                        value=""
                        onChange={(e) => handleStatusChange(c._id, c.status, e.target.value)}
                        className="w-auto py-1.5 text-xs"
                      >
                        <option value="">{stageLabel(c.status)}</option>
                        {allowedNextStages(c.status).map((s) => (
                          <option key={s} value={s}>
                            → {stageLabel(s)}
                          </option>
                        ))}
                      </Select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
