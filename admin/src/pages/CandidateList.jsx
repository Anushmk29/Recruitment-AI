import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { ArrowLeft, Users } from "lucide-react";
import api from "../api/client.js";
import { Card, Badge, Skeleton, EmptyState } from "../components/ui/Card.jsx";
import { Select } from "../components/ui/Field.jsx";

const STATUSES = ["applied", "shortlisted", "next_round", "rejected"];

function statusTone(status) {
  return { applied: "slate", interview_queue: "brand", shortlisted: "green", next_round: "brand", rejected: "red" }[status] || "slate";
}

export default function CandidateList() {
  const { id } = useParams();
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

  async function handleStatusChange(candidateId, status) {
    await api.patch(`/candidates/${candidateId}/status`, { status });
    load();
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
                        value={c.status}
                        onChange={(e) => handleStatusChange(c._id, e.target.value)}
                        className="w-auto py-1.5 text-xs"
                      >
                        {STATUSES.map((s) => (
                          <option key={s} value={s}>
                            {s.replace("_", " ")}
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
