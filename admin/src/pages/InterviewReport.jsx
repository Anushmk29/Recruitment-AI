import { useEffect, useState, useCallback } from "react";
import { useParams, Link } from "react-router-dom";
import { ArrowLeft, Bot, User, Sparkles, Clock, CheckCircle2, AlertTriangle, Download, Mic, ShieldCheck, ShieldAlert, ScanFace, Eye } from "lucide-react";
import api from "../api/client.js";
import { getSocket } from "../lib/socket.js";
import { Card, Badge, Skeleton, EmptyState } from "../components/ui/Card.jsx";
import { Input, Label, FormGroup } from "../components/ui/Field.jsx";
import Button from "../components/ui/Button.jsx";
import { useToast } from "../components/ui/Toast.jsx";
import { stageLabel, stageTone } from "../lib/pipeline.js";

const RECOMMENDATION = {
  strong_hire: { label: "Strong Hire", tone: "green" },
  hire: { label: "Hire", tone: "green" },
  maybe: { label: "Maybe", tone: "amber" },
  no_hire: { label: "No Hire", tone: "red" },
};

function formatWhen(value) {
  if (!value) return "—";
  return new Date(value).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
}

function scoreTone(v) {
  if (v == null) return "bg-slate-200";
  if (v >= 75) return "bg-emerald-500";
  if (v >= 55) return "bg-amber-500";
  return "bg-red-500";
}

function ScoreBar({ label, value }) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-xs">
        <span className="font-medium text-slate-500">{label}</span>
        <span className="font-semibold text-slate-800">{value != null ? `${value}/100` : "—"}</span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
        <div className={`h-full rounded-full ${scoreTone(value)}`} style={{ width: `${Math.max(0, Math.min(100, value || 0))}%` }} />
      </div>
    </div>
  );
}

const RISK_BAND = {
  low: { label: "Low risk", tone: "green", ring: "text-emerald-600", bg: "bg-emerald-500" },
  medium: { label: "Medium risk", tone: "amber", ring: "text-amber-600", bg: "bg-amber-500" },
  high: { label: "High risk", tone: "red", ring: "text-red-600", bg: "bg-red-500" },
};
const SEVERITY_TONE = { low: "slate", medium: "amber", high: "red" };

const VERDICT_META = {
  CLEAR_REJECT: { label: "Clear reject", tone: "red", classes: "border-red-200 bg-red-50 text-red-800" },
  REVIEW: { label: "Review", tone: "amber", classes: "border-amber-200 bg-amber-50 text-amber-800" },
  ADVANCE: { label: "Advance", tone: "green", classes: "border-emerald-200 bg-emerald-50 text-emerald-800" },
};

// §1: the single headline call, above everything else. Color-coded so a recruiter
// reaches a hire/no-hire read in seconds without having to parse raw scores.
function VerdictBanner({ verdict }) {
  if (!verdict) return null;
  const meta = VERDICT_META[verdict.verdict] || VERDICT_META.REVIEW;
  return (
    <div className={`rounded-2xl border-2 p-5 ${meta.classes}`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-bold uppercase tracking-wide">{meta.label}</h2>
        <Badge tone={meta.tone}>Confidence: {verdict.confidence}</Badge>
      </div>
      <p className="mt-1.5 text-sm font-medium">{verdict.reason}</p>
    </div>
  );
}

const COMPETENCY_LABELS = {
  frontend: "Frontend",
  backend: "Backend",
  database: "Database",
  system_design: "System design",
  debugging: "Debugging",
  learning: "Learning",
  general: "General",
};

// §9: one row per question, tagged with the competency it probes plus a quoted
// evidence snippet — shows a recruiter where the candidate is strong/weak, not just
// one global number.
function CompetencyTable({ rows }) {
  if (!rows || rows.length === 0) return null;
  return (
    <Card>
      <h3 className="mb-3 text-base font-semibold text-slate-900">Competency breakdown</h3>
      <div className="space-y-2.5">
        {rows.map((r, i) => (
          <div key={i} className="rounded-xl bg-slate-50 p-3">
            <div className="flex items-center justify-between gap-2">
              <Badge tone="brand">{COMPETENCY_LABELS[r.competency] || r.competency}</Badge>
              <span className="text-sm font-semibold text-slate-800">{r.score != null ? `${r.score}/100` : "—"}</span>
            </div>
            {r.evidence && <p className="mt-2 text-xs italic text-slate-500">&ldquo;{r.evidence}&rdquo;</p>}
          </div>
        ))}
      </div>
    </Card>
  );
}

// §5: explicit action verb + one-line justification — the report's final word.
function RecommendedActionCard({ action }) {
  if (!action) return null;
  return (
    <Card className="border-2 border-slate-800 bg-slate-900 text-white">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-300">Recommended action</p>
      <p className="mt-1 text-lg font-bold">{action.action}</p>
      <p className="mt-1 text-sm text-slate-300">{action.justification}</p>
    </Card>
  );
}

function IdentityRow({ identityMatch }) {
  const s = identityMatch?.status || "unknown";
  const map = {
    match: { icon: ShieldCheck, cls: "text-emerald-600", text: "Face matched the identity photo" },
    mismatch: { icon: ShieldAlert, cls: "text-red-600", text: "Face did NOT match the identity photo" },
    unknown: { icon: ScanFace, cls: "text-slate-400", text: "Identity not checked during the interview" },
  };
  const { icon: Icon, cls, text } = map[s] || map.unknown;
  return (
    <div className="flex items-center gap-2 text-sm text-slate-600">
      <Icon className={`h-4 w-4 shrink-0 ${cls}`} /> {text}
      {identityMatch?.distance != null && <span className="text-xs text-slate-400">(distance {identityMatch.distance})</span>}
    </div>
  );
}

function IntegrityCard({ proctoring }) {
  const band = RISK_BAND[proctoring.displayRiskBand] || RISK_BAND.low;
  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="flex items-center gap-2 text-base font-semibold text-slate-900">
          <Eye className="h-4 w-4 text-brand-600" /> Integrity & Proctoring
        </h3>
        <Badge tone={band.tone}>{band.label}</Badge>
      </div>

      {proctoring.identityGateNote && (
        <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs font-medium text-amber-700">{proctoring.identityGateNote}</p>
      )}

      <div className="mt-4 flex items-center gap-4">
        <div className="flex h-20 w-20 shrink-0 flex-col items-center justify-center rounded-2xl bg-slate-900 text-white">
          <span className="text-2xl font-bold">{proctoring.displayRiskScore ?? 0}</span>
          <span className="text-[10px] uppercase tracking-wide text-slate-300">Risk</span>
        </div>
        <div className="flex-1 space-y-2">
          <IdentityRow identityMatch={proctoring.identityMatch} />
          <div className="flex items-center gap-2 text-sm text-slate-600">
            {proctoring.visionEnabled ? (
              <><CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" /> Camera monitoring was active</>
            ) : (
              <><AlertTriangle className="h-4 w-4 shrink-0 text-amber-500" /> Camera monitoring off — browser signals only</>
            )}
          </div>
          <div className="text-xs text-slate-400">
            {proctoring.totalEvents} flag{proctoring.totalEvents === 1 ? "" : "s"} recorded
            {proctoring.consent?.given ? " · candidate consented" : proctoring.consent?.declined ? " · candidate declined proctoring" : ""}
          </div>
        </div>
      </div>

      {proctoring.breakdown?.length > 0 && (
        <div className="mt-4 space-y-2">
          {proctoring.breakdown.map((row) => (
            <div key={row.type} className="flex flex-wrap items-baseline gap-2">
              <Badge tone={SEVERITY_TONE[row.severity] || "slate"}>
                {row.label} · {row.count}×
              </Badge>
              {row.benignExplanation && <span className="text-xs text-slate-400">{row.benignExplanation}</span>}
            </div>
          ))}
        </div>
      )}

      <p className="mt-4 border-t border-slate-100 pt-3 text-xs text-slate-400">
        Integrity flags are advisory signals for your review — not proof of misconduct, and never on their own a reason to reject.
      </p>
    </Card>
  );
}

function Bubble({ role, text, score, delivery, spoken, wordCount, durationSec, responsive }) {
  const isAi = role === "ai";
  return (
    <div className={`flex gap-2.5 ${isAi ? "" : "flex-row-reverse"}`}>
      <div
        className={
          "flex h-8 w-8 shrink-0 items-center justify-center rounded-full " +
          (isAi ? "bg-brand-100 text-brand-700" : "bg-slate-200 text-slate-600")
        }
      >
        {isAi ? <Bot className="h-4 w-4" /> : <User className="h-4 w-4" />}
      </div>
      <div className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-sm ${isAi ? "bg-slate-50 text-slate-700" : "bg-brand-600 text-white"}`}>
        <p>{text}</p>
        {!isAi && (score != null || (spoken && delivery != null)) && (
          <p className="mt-1 text-[11px] font-semibold text-brand-100">
            {score != null && <>Answer score: {score}/100</>}
            {spoken && delivery != null && <>{score != null ? " · " : ""}Delivery: {delivery}/100</>}
          </p>
        )}
        {!isAi && wordCount != null && (
          <p className="mt-0.5 text-[11px] text-brand-100/90">
            {wordCount} word{wordCount === 1 ? "" : "s"} · {durationSec != null ? `${durationSec}s` : "duration unknown"} ·{" "}
            <span className={responsive ? "" : "font-semibold text-amber-200"}>{responsive ? "Responsive" : "Non-responsive"}</span>
          </p>
        )}
      </div>
    </div>
  );
}

export default function InterviewReport() {
  const { id } = useParams();
  const toast = useToast();
  const [report, setReport] = useState(null);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [movingTo, setMovingTo] = useState("");
  const [downloading, setDownloading] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await api.get(`/candidates/${id}/interview-report`);
      setReport(res.data);
    } catch (err) {
      setError(err.response?.data?.error || "Could not load the interview report.");
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  // Live-refresh if the candidate's stage changes elsewhere.
  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;
    function onStage(payload) {
      if (payload?.candidateId === id) load();
    }
    socket.on("candidate:stage", onStage);
    return () => socket.off("candidate:stage", onStage);
  }, [id, load]);

  async function downloadPdf() {
    setDownloading(true);
    try {
      const res = await api.get(`/candidates/${id}/interview-report/pdf`, { responseType: "blob" });
      const url = URL.createObjectURL(new Blob([res.data], { type: "application/pdf" }));
      const slug = (report?.candidate?.name || "candidate").replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase() || "candidate";
      const a = document.createElement("a");
      a.href = url;
      a.download = `interview-report-${slug}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      toast.error("Could not generate the PDF. Please try again.");
    } finally {
      setDownloading(false);
    }
  }

  async function moveStage(stage) {
    setMovingTo(stage);
    try {
      await api.patch(`/candidates/${id}/stage`, { stage, note: note || undefined });
      toast.success(`Moved to ${stageLabel(stage)}`);
      setNote("");
      await load();
    } catch (err) {
      toast.error(err.response?.data?.error || "Could not move candidate");
    } finally {
      setMovingTo("");
    }
  }

  if (!report) {
    return (
      <div className="space-y-4">
        {error ? (
          <Card className="text-center text-sm font-medium text-red-600">{error}</Card>
        ) : (
          <>
            <Skeleton className="h-6 w-48" />
            <Skeleton className="h-48 w-full" />
          </>
        )}
      </div>
    );
  }

  const { candidate, job, interview, allowedNextStages = [], stage, decisionTrail } = report;
  const ev = interview?.evaluation;
  const rec = ev?.recommendation ? RECOMMENDATION[ev.recommendation] : null;

  return (
    <div className="space-y-6">
      <Link to={`/candidates/${id}`} className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-brand-700">
        <ArrowLeft className="h-4 w-4" /> Back to candidate
      </Link>

      <VerdictBanner verdict={interview?.verdict} />

      <Card>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="flex items-center gap-2 text-2xl font-bold text-slate-900">
              <Sparkles className="h-5 w-5 text-brand-600" /> AI Interview Report
            </h1>
            <p className="mt-1 text-sm text-slate-500">
              {candidate?.name} · <span className="font-medium text-slate-700">{job?.title}</span>
            </p>
            {decisionTrail && (
              <p className="mt-1 text-xs text-slate-400">
                Moved to &ldquo;{decisionTrail.stageLabel}&rdquo; by {decisionTrail.by || "system"} · {formatWhen(decisionTrail.at)}
                {decisionTrail.note ? ` — ${decisionTrail.note}` : ""}
              </p>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={stageTone(stage)}>{stageLabel(stage)}</Badge>
            {interview?.engine === "fallback" && (
              <Badge tone="amber">
                <AlertTriangle className="mr-1 h-3 w-3" /> Fallback engine — placeholder scores
              </Badge>
            )}
            {interview?.status && <Badge tone={interview.status === "completed" ? "green" : "slate"}>{interview.status}</Badge>}
            {interview?.modality === "voice" && (
              <Badge tone="brand">
                <Mic className="mr-1 h-3 w-3" /> Voice
              </Badge>
            )}
            {report.hasInterview && (
              <Button variant="outline" size="sm" loading={downloading} onClick={downloadPdf}>
                <Download className="h-3.5 w-3.5" /> Download PDF
              </Button>
            )}
          </div>
        </div>

        {/* §4: identity + duration flags surfaced immediately, not buried in Integrity */}
        {report.hasInterview && (
          <div className="mt-3 flex flex-wrap items-center gap-4 border-t border-slate-100 pt-3">
            <IdentityRow identityMatch={report.proctoring?.identityMatch} />
            {interview?.durationFlag?.abnormallyShort && (
              <div className="flex items-center gap-1.5 text-sm font-medium text-amber-700">
                <AlertTriangle className="h-4 w-4 shrink-0" /> Abnormally short session — averaging {interview.durationFlag.secondsPerQuestion}s/question
              </div>
            )}
          </div>
        )}
      </Card>

      {!report.hasInterview ? (
        <Card>
          <EmptyState
            icon={Bot}
            title="No AI interview yet"
            description="This candidate hasn't completed the AI interview. The report appears here once the interview is finished."
          />
        </Card>
      ) : (
        <>
          {/* Evaluation */}
          <Card>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h3 className="text-base font-semibold text-slate-900">Evaluation</h3>
              {rec && <Badge tone={rec.tone}>Recommendation: {rec.label}</Badge>}
            </div>

            {ev ? (
              <>
                {interview.substance && (
                  <p className="mt-3 text-sm font-medium text-slate-500">
                    Responsive answers: {interview.substance.responsiveCount} / {interview.substance.totalAnswers}
                  </p>
                )}

                {ev.generatedBy === "fallback" && (
                  <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-700">
                    Deterministic fallback — every score below is a PLACEHOLDER from answer-completeness heuristics, not a real evaluation.
                  </p>
                )}

                <div className="mt-4 flex items-center gap-4">
                  <div className={`flex h-20 w-20 shrink-0 flex-col items-center justify-center rounded-2xl text-white ${ev.generatedBy === "fallback" ? "bg-slate-400" : "bg-slate-900"}`}>
                    <span className="text-2xl font-bold">{ev.overallScore ?? "—"}</span>
                    <span className="text-[10px] uppercase tracking-wide text-slate-300">{ev.generatedBy === "fallback" ? "Placeholder" : "Overall"}</span>
                  </div>
                  {interview.competencyTriplet ? (
                    <div className="grid flex-1 gap-3 sm:grid-cols-3">
                      <ScoreBar label="Communication" value={interview.competencyTriplet.communication} />
                      <ScoreBar label="Technical" value={interview.competencyTriplet.technicalKnowledge} />
                      <ScoreBar label="Problem Solving" value={interview.competencyTriplet.problemSolving} />
                    </div>
                  ) : (
                    <p className="flex-1 text-sm text-slate-400">
                      Communication / Technical / Problem solving:{" "}
                      {ev.generatedBy === "fallback" ? "PLACEHOLDER — not a real evaluation." : "not separately measured for this interview."}
                    </p>
                  )}
                </div>

                {ev.summary && <p className="mt-4 rounded-xl bg-slate-50 p-3 text-sm text-slate-600">{ev.summary}</p>}

                <div className="mt-4 grid gap-4 sm:grid-cols-2">
                  {ev.strengths?.length > 0 && (
                    <div>
                      <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-400">Strengths</p>
                      <ul className="space-y-1">
                        {ev.strengths.map((s, i) => (
                          <li key={i} className="flex items-start gap-1.5 text-sm text-slate-600">
                            <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" /> {s}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {ev.weaknesses?.length > 0 && (
                    <div>
                      <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-400">Weaknesses</p>
                      <ul className="space-y-1">
                        {ev.weaknesses.map((s, i) => (
                          <li key={i} className="flex items-start gap-1.5 text-sm text-slate-600">
                            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" /> {s}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>

                {ev.missingSkills?.length > 0 && (
                  <div className="mt-4">
                    <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-400">Skills to probe</p>
                    <div className="flex flex-wrap gap-1.5">
                      {ev.missingSkills.map((s) => (
                        <Badge key={s} tone="red">{s}</Badge>
                      ))}
                    </div>
                  </div>
                )}

                {/* §6: voice delivery/confidence are secondary signal quality, not competency —
                    kept visually de-emphasized and clearly labeled to avoid accent/audio bias. */}
                {(ev.delivery != null || ev.confidence != null) && (
                  <div className="mt-4 border-t border-slate-100 pt-3">
                    <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-400">Signal quality (secondary — voice delivery, not competency)</p>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <ScoreBar label="Delivery (voice)" value={ev.delivery} />
                      <ScoreBar label="Confidence (voice)" value={ev.confidence} />
                    </div>
                    <p className="mt-2 text-xs text-slate-400">
                      Measures speaking pace and fluency, not technical ability — can reflect accent or audio quality rather than skill.
                    </p>
                  </div>
                )}

                <p className="mt-4 border-t border-slate-100 pt-3 text-xs text-slate-400">
                  Generated by {ev.generatedBy === "fallback" ? "deterministic fallback (AI provider not configured)" : "AI"}
                  {ev.generatedAt ? ` · ${formatWhen(ev.generatedAt)}` : ""}
                  {interview.startedAt ? ` · interview ${formatWhen(interview.startedAt)}` : ""}
                </p>
              </>
            ) : (
              <p className="mt-3 text-sm text-slate-400">Evaluation not available yet.</p>
            )}
          </Card>

          <CompetencyTable rows={interview.competencyTable} />

          {/* Integrity / proctoring */}
          {report.proctoring && <IntegrityCard proctoring={report.proctoring} />}

          {/* Decision actions */}
          {allowedNextStages.length > 0 && (
            <Card>
              <h3 className="mb-3 text-base font-semibold text-slate-900">Decision</h3>
              <FormGroup className="mb-3">
                <Label>Note (optional)</Label>
                <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Reason / internal note recorded on the timeline" />
              </FormGroup>
              <div className="flex flex-wrap gap-2">
                {allowedNextStages.map((s) => (
                  <Button
                    key={s.stage}
                    variant={s.stage === "rejected" ? "outline" : "primary"}
                    size="sm"
                    loading={movingTo === s.stage}
                    onClick={() => moveStage(s.stage)}
                  >
                    {s.label}
                  </Button>
                ))}
              </div>
            </Card>
          )}

          {/* Transcript */}
          <Card>
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-base font-semibold text-slate-900">Transcript</h3>
              <div className="flex items-center gap-3 text-xs text-slate-400">
                {interview.substance && (
                  <span>Responsive: {interview.substance.responsiveCount}/{interview.substance.totalAnswers}</span>
                )}
                <span className="inline-flex items-center gap-1">
                  <Clock className="h-3 w-3" /> {interview.questionCount}/{interview.maxQuestions} questions
                </span>
              </div>
            </div>
            <div className="space-y-4">
              {(interview.transcript || []).map((t, i) => (
                <Bubble
                  key={i}
                  role={t.role}
                  text={t.text}
                  score={t.answerScore}
                  delivery={t.deliveryScore}
                  spoken={t.inputMode === "voice"}
                  wordCount={t.wordCount}
                  durationSec={t.durationSec}
                  responsive={t.responsive}
                />
              ))}
              {(!interview.transcript || interview.transcript.length === 0) && (
                <p className="text-sm text-slate-400">No transcript recorded.</p>
              )}
            </div>
          </Card>

          <RecommendedActionCard action={interview.recommendedAction} />
        </>
      )}
    </div>
  );
}
