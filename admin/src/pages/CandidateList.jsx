import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { ArrowLeft, Users, AlertTriangle } from "lucide-react";
import api from "../api/client.js";
import { Card, Badge, Avatar, Skeleton, EmptyState } from "../components/ui/Card.jsx";
import { RecordRow, RecordList } from "../components/ui/Panels.jsx";
import StageMenu from "../components/ui/StageMenu.jsx";
import { useToast } from "../components/ui/Toast.jsx";
import { stageLabel, stageTone } from "../lib/pipeline.js";

export default function CandidateList() {
  const { id } = useParams();
  const toast = useToast();
  const [job, setJob] = useState(null);
  const [candidates, setCandidates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [movingId, setMovingId] = useState(null);

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
    setMovingId(candidateId);
    try {
      await api.patch(`/candidates/${candidateId}/stage`, { stage });
      toast.success(`Moved to ${stageLabel(stage)}`);
      load();
    } catch (err) {
      toast.error(err.response?.data?.error || "Could not move candidate");
    } finally {
      setMovingId(null);
    }
  }

  return (
    <div className="space-y-6">
      <Link to="/jobs" className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-brand-700">
        <ArrowLeft className="h-4 w-4" /> Back to jobs
      </Link>
      <h1 className="text-2xl font-bold tracking-tight text-slate-900 [overflow-wrap:anywhere]">Candidates{job ? ` — ${job.title}` : ""}</h1>

      {job && job.rubricStatus && job.rubricStatus !== "approved" && (
        <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          <AlertTriangle className="mt-0.5 h-4 w-4 flex-none" />
          <div>
            <p className="font-medium">This job has no approved scoring rubric.</p>
            <p className="mt-0.5">
              Every candidate below is being scored by the legacy keyword matcher, not the evidence-based rubric
              engine.{" "}
              <Link to={`/jobs/${job._id}/rubric`} className="font-medium underline hover:text-amber-900">
                Review and approve the rubric
              </Link>{" "}
              to switch this job to evidence-based scoring.
            </p>
          </div>
        </div>
      )}

      {loading ? (
        <Card padding="none" className="divide-y divide-slate-100 overflow-hidden">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="px-4 py-3">
              <Skeleton className="h-9 w-full" />
            </div>
          ))}
        </Card>
      ) : candidates.length === 0 ? (
        <EmptyState icon={Users} title="No candidates yet" description="Applicants for this job will appear here." />
      ) : (
        <RecordList label={`Candidates for ${job?.title || "this job"}`}>
          {candidates.map((c) => (
            <RecordRow
              key={c._id}
              avatar={<Avatar name={c.basicDetails?.name} size="sm" />}
              title={c.basicDetails?.name || "Unnamed applicant"}
              subtitle={c.basicDetails?.email}
              link={{ as: Link, to: `/candidates/${c._id}` }}
              meta={[{ label: "Applied", value: new Date(c.createdAt).toLocaleDateString() }]}
              trailing={
                <>
                  {/* Own sub-column, right-aligned — see CandidatesAll. */}
                  <span className="flex justify-end xl:min-w-24">
                    {c.ats?.overallScore != null ? (
                      <Badge
                        tone={c.ats.decision === "pass" ? "green" : c.ats.decision === "fail" ? "red" : "slate"}
                        className="tabular-nums"
                      >
                        {c.ats.overallScore}%
                      </Badge>
                    ) : (
                      <Badge tone="slate">Not scored</Badge>
                    )}
                  </span>
                  <Badge tone={stageTone(c.status)}>{stageLabel(c.status)}</Badge>
                </>
              }
              note={
                // The old table showed this as a lone amber triangle with a
                // `title` tooltip — invisible on touch, invisible to a screen
                // reader, and exactly the kind of caveat the Honest Reading
                // Rule says must not be decorative. Here it is a sentence.
                c.ats?.overallScore != null && c.ats.engine !== "evidence" ? (
                  <span className="inline-flex items-center gap-1.5 font-medium text-amber-700">
                    <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                    Legacy keyword match — rubric not approved
                  </span>
                ) : null
              }
              actions={
                <StageMenu
                  status={c.status}
                  name={c.basicDetails?.name}
                  busy={movingId === c._id}
                  onMove={(stage) => handleStatusChange(c._id, c.status, stage)}
                />
              }
            />
          ))}
        </RecordList>
      )}
    </div>
  );
}
