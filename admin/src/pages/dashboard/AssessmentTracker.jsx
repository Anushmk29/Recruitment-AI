import { useCallback, useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { ArrowLeft, Send, SkipForward, RefreshCw, PauseCircle, PlayCircle, StopCircle, ClipboardList } from "lucide-react";
import api from "../../api/client.js";
import { getSocket } from "../../lib/socket.js";
import { useToast } from "../../components/ui/Toast.jsx";
import { Card, Badge, Skeleton, EmptyState } from "../../components/ui/Card.jsx";
import { Select, Label } from "../../components/ui/Field.jsx";
import Button from "../../components/ui/Button.jsx";

// Per-job assessment tracker (ASSESSMENT-ENGINE-PLAN A2.7): live status tile,
// the AWAITING-DECISION queue (the recruiter gate is a queue, not a hunt — every
// ATS-passed candidate with no decision surfaces here with Send/Skip inline),
// and per-session actions including the soft-lock resume/end (typed reason).

const STATUS_META = {
  scheduled: { label: "Not started", tone: "slate" },
  in_progress: { label: "In progress", tone: "brand" },
  paused: { label: "Paused (soft-lock)", tone: "amber" },
  completed: { label: "Completed", tone: "green" },
  expired: { label: "Expired", tone: "red" },
  cancelled: { label: "Cancelled", tone: "slate" },
};

const TIER_SOURCE_LABEL = {
  claim_derived: "from résumé claims",
  recruiter_override: "recruiter override",
  paper_fixed: "paper default",
};

export default function AssessmentTracker() {
  const { id: jobId } = useParams();
  const toast = useToast();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);
  const [difficulty, setDifficulty] = useState({}); // candidateId → override

  const load = useCallback(async () => {
    try {
      const res = await api.get(`/assessments/job/${jobId}/overview`);
      setData(res.data);
    } catch (err) {
      toast.error(err.response?.data?.error || "Failed to load assessment overview");
    } finally {
      setLoading(false);
    }
  }, [jobId, toast]);

  useEffect(() => {
    load();
  }, [load]);

  // Live tile: session status changes and stage moves both refresh the board.
  useEffect(() => {
    const socket = getSocket();
    if (!socket) return undefined;
    const refresh = () => load();
    socket.on("assessment:update", refresh);
    socket.on("candidate:stage", refresh);
    return () => {
      socket.off("assessment:update", refresh);
      socket.off("candidate:stage", refresh);
    };
  }, [load]);

  async function send(candidateId) {
    setBusyId(candidateId);
    try {
      await api.post(`/assessments/candidate/${candidateId}/send`, {
        difficultyOverride: difficulty[candidateId] || undefined,
      });
      toast.success("Assessment sent — invitation email on its way");
      await load();
    } catch (err) {
      toast.error(err.response?.data?.error || "Send failed");
    } finally {
      setBusyId(null);
    }
  }

  async function skip(candidateId) {
    setBusyId(candidateId);
    try {
      await api.post(`/assessments/candidate/${candidateId}/skip`);
      toast.success("Skipped to AI interview — recorded as your decision, invitation sent");
      await load();
    } catch (err) {
      toast.error(err.response?.data?.error || "Skip failed");
    } finally {
      setBusyId(null);
    }
  }

  async function sessionAction(sessionId, action) {
    let body = {};
    if (action === "resume" || action === "end") {
      const reason = window.prompt(
        action === "resume"
          ? "Reason for resuming (recorded in the audit log):"
          : "Reason for ending this assessment (recorded in the audit log; existing answers are scored):"
      );
      if (!reason) return;
      body = { reason };
    }
    setBusyId(sessionId);
    try {
      await api.post(`/assessments/sessions/${sessionId}/${action}`, body);
      toast.success(action === "resend" ? "Fresh link emailed" : `Session ${action}d`);
      await load();
    } catch (err) {
      toast.error(err.response?.data?.error || `${action} failed`);
    } finally {
      setBusyId(null);
    }
  }

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }
  if (!data) return null;

  const total = Object.values(data.counts).reduce((a, b) => a + b, 0);
  const pct = (n) => (total ? Math.round((n / total) * 100) : 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Button as={Link} to={`/jobs/${jobId}/edit`} variant="ghost" className="!px-2">
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-xl font-bold text-slate-900">Assessments</h1>
            <p className="text-sm text-slate-500">
              {data.job.title} · policy: <strong>{data.job.assessmentPolicy}</strong> · paper: {data.paperStatus}
            </p>
          </div>
        </div>
        <Button as={Link} to={`/jobs/${jobId}/assessment`} variant="secondary">
          <ClipboardList className="h-4 w-4" /> Assessment paper
        </Button>
      </div>

      {/* Status tile */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {["scheduled", "in_progress", "paused", "completed", "expired"].map((k) => (
          <Card key={k} className="!p-4 text-center">
            <p className="text-2xl font-bold text-slate-800">{data.counts[k] || 0}</p>
            <p className="text-xs text-slate-500">
              {STATUS_META[k].label} {total > 0 && <span className="text-slate-300">· {pct(data.counts[k] || 0)}%</span>}
            </p>
          </Card>
        ))}
      </div>

      {/* Awaiting decision — the recruiter gate */}
      {data.job.assessmentPolicy === "manual" && (
        <Card>
          <h2 className="text-base font-semibold text-slate-800">Awaiting your decision</h2>
          <p className="mt-1 text-sm text-slate-500">
            These candidates passed screening. Send the assessment — or skip a candidate (a senior hire, say) straight to the AI
            interview. Either way it's recorded as your decision; a skip never reads as missing data and costs nothing.
          </p>
          <div className="mt-4 space-y-2">
            {data.awaitingDecision.length === 0 && <p className="text-sm text-slate-400">Nobody waiting — all decided.</p>}
            {data.awaitingDecision.map((c) => (
              <div key={c._id} className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-slate-50/60 p-3">
                <div className="min-w-[12rem] flex-1">
                  <Link to={`/candidates/${c._id}`} className="text-sm font-semibold text-slate-800 hover:text-brand-700">
                    {c.basicDetails?.name}
                  </Link>
                  <p className="text-xs text-slate-400">
                    {c.basicDetails?.email} · ATS {c.ats?.overallScore ?? "—"}
                  </p>
                </div>
                <div>
                  <Label className="!text-[11px]">Difficulty</Label>
                  <Select
                    value={difficulty[c._id] || ""}
                    onChange={(e) => setDifficulty((d) => ({ ...d, [c._id]: e.target.value }))}
                    className="!py-1.5 text-xs"
                  >
                    <option value="">Auto (from résumé claims)</option>
                    <option value="easy">Easy</option>
                    <option value="medium">Medium</option>
                    <option value="hard">Hard</option>
                  </Select>
                </div>
                <Button onClick={() => send(c._id)} disabled={busyId === c._id}>
                  <Send className="h-4 w-4" /> Send assessment
                </Button>
                <Button variant="secondary" onClick={() => skip(c._id)} disabled={busyId === c._id}>
                  <SkipForward className="h-4 w-4" /> Skip to AI interview
                </Button>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Sessions */}
      <Card>
        <h2 className="text-base font-semibold text-slate-800">Sessions</h2>
        {data.sessions.length === 0 ? (
          <EmptyState
            icon={ClipboardList}
            title="No assessments yet"
            description='Assessments run only for candidates you assign. Approve a paper, set the job policy to "manual", and decide per candidate above.'
          />
        ) : (
          <div className="mt-4 space-y-2">
            {data.sessions.map((s) => (
              <div key={s.id} className="rounded-xl border border-slate-200 p-3">
                <div className="flex flex-wrap items-center gap-3">
                  <div className="min-w-[12rem] flex-1">
                    {s.candidate ? (
                      <Link to={`/candidates/${s.candidate.id}`} className="text-sm font-semibold text-slate-800 hover:text-brand-700">
                        {s.candidate.name}
                      </Link>
                    ) : (
                      <span className="text-sm text-slate-400">(candidate removed)</span>
                    )}
                    <p className="text-xs text-slate-400">
                      assigned by {s.assignment?.assignedByName} ({s.assignment?.mode}) ·{" "}
                      {new Date(s.assignment?.at).toLocaleString()}
                    </p>
                  </div>
                  <Badge tone={(STATUS_META[s.status] || STATUS_META.scheduled).tone}>
                    {(STATUS_META[s.status] || STATUS_META.scheduled).label}
                  </Badge>
                  {s.difficultyTier?.value && (
                    <Badge tone="slate">
                      {s.difficultyTier.value} tier · {TIER_SOURCE_LABEL[s.difficultyTier.source] || s.difficultyTier.source}
                    </Badge>
                  )}
                  {s.result && (
                    <Badge tone="brand">
                      {s.result.totalCorrect}/{s.result.totalItems} correct
                      {s.result.completedBy === "expiry" ? " (partial — closed by expiry)" : ""}
                    </Badge>
                  )}
                  {s.proctoring?.totalEvents > 0 && (
                    <Badge tone={s.proctoring.riskBand === "high" ? "red" : s.proctoring.riskBand === "medium" ? "amber" : "slate"}>
                      integrity: {s.proctoring.riskBand} ({s.proctoring.totalEvents} events)
                    </Badge>
                  )}
                  <div className="flex gap-1.5">
                    {["scheduled", "expired"].includes(s.status) && (
                      <Button variant="ghost" onClick={() => sessionAction(s.id, "resend")} disabled={busyId === s.id} title="Send a fresh link">
                        <RefreshCw className="h-4 w-4" />
                      </Button>
                    )}
                    {s.status === "paused" && (
                      <Button variant="secondary" onClick={() => sessionAction(s.id, "resume")} disabled={busyId === s.id}>
                        <PlayCircle className="h-4 w-4" /> Resume
                      </Button>
                    )}
                    {["in_progress", "paused"].includes(s.status) && (
                      <Button variant="ghost" onClick={() => sessionAction(s.id, "end")} disabled={busyId === s.id} title="End & score existing answers">
                        <StopCircle className="h-4 w-4" />
                      </Button>
                    )}
                    {s.status === "scheduled" && (
                      <Button variant="ghost" onClick={() => sessionAction(s.id, "cancel")} disabled={busyId === s.id} title="Cancel invitation">
                        <PauseCircle className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                </div>
                {s.result?.claimVerdicts?.length > 0 && (
                  <p className="mt-2 text-xs text-slate-500">
                    Claim verdicts:{" "}
                    {s.result.claimVerdicts.map((v) => `${v.claimId}: ${v.verdict} (${v.correctCount}/${v.itemCount})`).join(" · ")}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
