import { useEffect, useState, useCallback } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { ArrowLeft, Link2, Globe, FileText, Mail, Phone, MapPin, Download, Clock, CheckCircle2, XCircle, Sparkles, Trash2, Send, CalendarClock } from "lucide-react";
import api from "../api/client.js";
import { getSocket } from "../lib/socket.js";
import { Card, Badge, Skeleton } from "../components/ui/Card.jsx";
import { Select, Input, Textarea, Label, FormGroup } from "../components/ui/Field.jsx";
import Button from "../components/ui/Button.jsx";
import { useToast } from "../components/ui/Toast.jsx";
import { STAGES, stageLabel, stageTone, normalizeStage, isTerminal } from "../lib/pipeline.js";

function Section({ title, children }) {
  return (
    <Card>
      <h3 className="mb-3 text-base font-semibold text-slate-900">{title}</h3>
      {children}
    </Card>
  );
}

function formatWhen(value) {
  if (!value) return "—";
  return new Date(value).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
}

// Format a Date as the `YYYY-MM-DDTHH:mm` string a datetime-local input expects,
// in the browser's local timezone (toISOString would shift it to UTC).
function toLocalInputValue(date) {
  const d = new Date(date);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const SESSION_STATUS_TONE = {
  scheduled: "brand",
  in_progress: "amber",
  completed: "green",
  expired: "red",
  cancelled: "slate",
};

// Compact horizontal stepper across the ordered pipeline. The terminal
// `rejected` stage is rendered as a standalone red marker.
function StageProgress({ status }) {
  const current = normalizeStage(status);
  const rejected = current === "rejected";
  const currentIdx = STAGES.indexOf(current);

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {STAGES.map((s, i) => {
        const reached = !rejected && currentIdx >= i;
        const isCurrent = !rejected && currentIdx === i;
        return (
          <span
            key={s}
            className={
              "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium " +
              (isCurrent
                ? "bg-brand-600 text-white"
                : reached
                ? "bg-brand-100 text-brand-700"
                : "bg-slate-100 text-slate-400")
            }
          >
            {stageLabel(s)}
          </span>
        );
      })}
      {rejected && (
        <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-semibold text-red-700">
          <XCircle className="h-3 w-3" /> Rejected
        </span>
      )}
    </div>
  );
}

export default function CandidateDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const [candidate, setCandidate] = useState(null);
  const [timeline, setTimeline] = useState(null);
  const [session, setSession] = useState(null);
  const [selectedStage, setSelectedStage] = useState("");
  const [note, setNote] = useState("");
  const [offerMessage, setOfferMessage] = useState("");
  const [moving, setMoving] = useState(false);
  const [erasing, setErasing] = useState(false);
  const [resending, setResending] = useState(false);
  const [rescheduling, setRescheduling] = useState(false);
  const [newInterviewAt, setNewInterviewAt] = useState("");
  // The freshly-minted interview link, shown right after resend/reschedule so the
  // recruiter can copy it directly (it can't be re-fetched later — only its hash is stored).
  const [lastLink, setLastLink] = useState("");

  const load = useCallback(async () => {
    const [cRes, tRes, sRes] = await Promise.all([
      api.get(`/candidates/${id}`),
      api.get(`/candidates/${id}/timeline`).catch(() => ({ data: null })),
      // 404 = candidate never reached the interview stage — no session yet.
      api.get(`/interview-sessions/candidate/${id}`).catch(() => ({ data: null })),
    ]);
    setCandidate(cRes.data);
    setTimeline(tRes.data);
    setSession(sRes.data);
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  // Live-refresh if this candidate's stage changes elsewhere.
  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;
    function onStage(payload) {
      if (payload?.candidateId === id) load();
    }
    socket.on("candidate:stage", onStage);
    return () => socket.off("candidate:stage", onStage);
  }, [id, load]);

  async function handleMove() {
    if (!selectedStage) return;
    setMoving(true);
    try {
      await api.patch(`/candidates/${id}/stage`, {
        stage: selectedStage,
        note: note || undefined,
        offerMessage: selectedStage === "offer_sent" ? offerMessage || undefined : undefined,
      });
      toast.success(`Moved to ${stageLabel(selectedStage)}`);
      setSelectedStage("");
      setNote("");
      setOfferMessage("");
      await load();
    } catch (err) {
      toast.error(err.response?.data?.error || "Could not move candidate");
    } finally {
      setMoving(false);
    }
  }

  // Re-send the interview invitation. Rotates the magic-link token and refreshes the
  // validity window, keeping the currently scheduled time — the candidate gets a fresh
  // working link by email + in-app notification.
  async function handleResend() {
    setResending(true);
    try {
      const { data } = await api.post(`/interview-sessions/candidate/${id}/resend`);
      if (data?.interviewUrl) setLastLink(data.interviewUrl);
      toast.success("Interview link re-sent to the candidate");
      await load();
    } catch (err) {
      toast.error(err.response?.data?.error || "Could not resend the interview link");
    } finally {
      setResending(false);
    }
  }

  // Reschedule to a new date/time. `newInterviewAt` is a datetime-local value (local
  // time, no zone); new Date() interprets it as local and toISOString() normalizes to
  // UTC for the API.
  async function handleReschedule() {
    if (!newInterviewAt) return;
    setRescheduling(true);
    try {
      const { data } = await api.post(`/interview-sessions/candidate/${id}/reschedule`, {
        interviewAt: new Date(newInterviewAt).toISOString(),
      });
      if (data?.interviewUrl) setLastLink(data.interviewUrl);
      toast.success("Interview rescheduled and a new link was sent");
      setNewInterviewAt("");
      await load();
    } catch (err) {
      toast.error(err.response?.data?.error || "Could not reschedule the interview");
    } finally {
      setRescheduling(false);
    }
  }

  async function handleCopyLink() {
    try {
      await navigator.clipboard.writeText(lastLink);
      toast.success("Interview link copied to clipboard");
    } catch {
      toast.error("Could not copy — select the link and copy it manually");
    }
  }

  // DPDP right-to-erasure. Irreversible hard-delete of the candidate + all artifacts
  // (resume, identity photo, interview transcript, queue, usage). Double-confirmed.
  async function handleErase() {
    if (!window.confirm("Permanently erase ALL data for this candidate (resume, interview, everything)? This cannot be undone.")) {
      return;
    }
    setErasing(true);
    try {
      await api.delete(`/data-rights/candidates/${id}`, {
        data: { reason: "data-principal erasure request" },
      });
      toast.success("Candidate data erased");
      navigate(`/jobs/${candidate.job?._id}/candidates`, { replace: true });
    } catch (err) {
      toast.error(err.response?.data?.error || "Could not erase candidate data");
      setErasing(false);
    }
  }

  if (!candidate) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-6 w-40" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  const { basicDetails, experience, education, skills, projects, certificates, ats, offer } = candidate;
  const nextStages = timeline?.allowedNextStages || [];
  const terminal = isTerminal(candidate.status);

  // Once the candidate has actually started or finished the interview, the link can no
  // longer be resent/rescheduled (mirrors the backend guard). Otherwise recruiters can
  // recover from a missed or expired slot themselves.
  const interviewLocked =
    ["in_progress", "completed"].includes(session?.status) ||
    ["in_progress", "completed"].includes(session?.aiInterview?.status);
  const interviewExpired = session?.status === "expired" || (session?.expiresAt && new Date(session.expiresAt) < new Date());

  return (
    <div className="space-y-6">
      <Link
        to={`/jobs/${candidate.job?._id}/candidates`}
        className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-brand-700"
      >
        <ArrowLeft className="h-4 w-4" /> Back to candidates
      </Link>

      <Card>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">{basicDetails.name}</h1>
            <p className="mt-1 text-sm text-slate-500">
              Applied for <span className="font-medium text-slate-700">{candidate.job?.title}</span>
            </p>
          </div>
          <div className="flex items-center gap-3">
            {ats?.overallScore != null && (
              <Badge tone={ats.decision === "pass" ? "green" : ats.decision === "fail" ? "red" : "slate"}>
                ATS {ats.overallScore}%
              </Badge>
            )}
            <Badge tone={stageTone(candidate.status)}>{stageLabel(candidate.status)}</Badge>
            <Link
              to={`/candidates/${candidate._id}/interview-report`}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50"
            >
              <Sparkles className="h-4 w-4" /> AI Report
            </Link>
            <a
              href={`${api.defaults.baseURL}/candidates/${candidate._id}/export`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50"
            >
              <Download className="h-4 w-4" /> Export
            </a>
            <button
              type="button"
              onClick={handleErase}
              disabled={erasing}
              title="Erase all data for this candidate (DPDP right to erasure)"
              className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 px-3 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
            >
              <Trash2 className="h-4 w-4" /> {erasing ? "Erasing…" : "Erase"}
            </button>
          </div>
        </div>

        <div className="mt-5 border-t border-slate-100 pt-5">
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-400">Hiring Progress</p>
          <StageProgress status={candidate.status} />
        </div>

        <div className="mt-5 grid gap-3 border-t border-slate-100 pt-5 sm:grid-cols-2">
          <div className="flex items-center gap-2 text-sm text-slate-600">
            <Mail className="h-4 w-4 text-slate-400" /> {basicDetails.email}
          </div>
          <div className="flex items-center gap-2 text-sm text-slate-600">
            <Phone className="h-4 w-4 text-slate-400" /> {basicDetails.phone || "—"}
          </div>
          <div className="flex items-center gap-2 text-sm text-slate-600">
            <MapPin className="h-4 w-4 text-slate-400" /> {basicDetails.location || "—"}
          </div>
          <div className="flex items-center gap-2 text-sm text-slate-600">
            <FileText className="h-4 w-4 text-slate-400" />
            <a
              href={`${api.defaults.baseURL}/candidates/${candidate._id}/resume`}
              target="_blank"
              rel="noreferrer"
              className="font-medium text-brand-700 hover:underline"
            >
              {candidate.resumeOriginalName}
            </a>
          </div>
          {basicDetails.linkedinUrl && (
            <div className="flex items-center gap-2 text-sm text-slate-600">
              <Link2 className="h-4 w-4 text-slate-400" />
              <a href={basicDetails.linkedinUrl} target="_blank" rel="noreferrer" className="font-medium text-brand-700 hover:underline">
                LinkedIn
              </a>
            </div>
          )}
          {basicDetails.portfolioUrl && (
            <div className="flex items-center gap-2 text-sm text-slate-600">
              <Globe className="h-4 w-4 text-slate-400" />
              <a href={basicDetails.portfolioUrl} target="_blank" rel="noreferrer" className="font-medium text-brand-700 hover:underline">
                Portfolio
              </a>
            </div>
          )}
        </div>
      </Card>

      {/* Stage control */}
      <Section title="Move candidate">
        {terminal ? (
          <p className="text-sm text-slate-500">
            This candidate is at a final stage (<span className="font-medium">{stageLabel(candidate.status)}</span>). No further
            transitions are available.
          </p>
        ) : nextStages.length === 0 ? (
          <p className="text-sm text-slate-400">No stage transitions available.</p>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            <FormGroup>
              <Label>Next stage</Label>
              <Select value={selectedStage} onChange={(e) => setSelectedStage(e.target.value)}>
                <option value="">Select a stage…</option>
                {nextStages.map((s) => (
                  <option key={s.stage} value={s.stage}>
                    {s.label}
                  </option>
                ))}
              </Select>
            </FormGroup>
            <FormGroup>
              <Label>Note (optional)</Label>
              <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Internal note / reason" />
            </FormGroup>
            {selectedStage === "offer_sent" && (
              <FormGroup className="sm:col-span-2">
                <Label>Offer message</Label>
                <Textarea
                  rows={3}
                  value={offerMessage}
                  onChange={(e) => setOfferMessage(e.target.value)}
                  placeholder="Details included in the offer email to the candidate."
                />
              </FormGroup>
            )}
            <div className="sm:col-span-2">
              <Button onClick={handleMove} loading={moving} disabled={!selectedStage}>
                Move to {selectedStage ? stageLabel(selectedStage) : "stage"}
              </Button>
            </div>
          </div>
        )}
      </Section>

      {/* AI interview link — resend / reschedule */}
      {session && (
        <Section title="AI Interview">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-xl bg-slate-50 p-3">
              <p className="text-xs text-slate-400">Scheduled for</p>
              <p className="mt-1 text-sm font-semibold text-slate-900">{formatWhen(session.interviewAt)}</p>
            </div>
            <div className="rounded-xl bg-slate-50 p-3">
              <p className="text-xs text-slate-400">Link valid until</p>
              <p className="mt-1 text-sm font-semibold text-slate-900">{formatWhen(session.expiresAt)}</p>
            </div>
            <div className="rounded-xl bg-slate-50 p-3">
              <p className="text-xs text-slate-400">Status</p>
              <p className="mt-1">
                <Badge tone={SESSION_STATUS_TONE[session.status] || "slate"}>
                  {session.status?.replace("_", " ") || "—"}
                </Badge>
              </p>
            </div>
          </div>

          {interviewLocked ? (
            <p className="mt-4 text-sm text-slate-500">
              The candidate has already {session.status === "completed" || session.aiInterview?.status === "completed" ? "completed" : "started"} this
              interview, so the link can no longer be resent or rescheduled.
            </p>
          ) : (
            <>
              {interviewExpired && (
                <p className="mt-4 flex items-center gap-1.5 text-sm font-medium text-amber-600">
                  <Clock className="h-4 w-4" /> This link has expired. Resend it or pick a new time to give the candidate a fresh link.
                </p>
              )}
              <div className="mt-4 flex flex-wrap items-center gap-3">
                <Button variant="outline" onClick={handleResend} loading={resending}>
                  <Send className="h-4 w-4" /> Resend link
                </Button>
              </div>

              <div className="mt-5 grid items-end gap-3 border-t border-slate-100 pt-5 sm:grid-cols-[1fr_auto]">
                <FormGroup className="mb-0">
                  <Label>Reschedule to</Label>
                  <Input
                    type="datetime-local"
                    value={newInterviewAt}
                    min={toLocalInputValue(new Date())}
                    onChange={(e) => setNewInterviewAt(e.target.value)}
                  />
                </FormGroup>
                <Button onClick={handleReschedule} loading={rescheduling} disabled={!newInterviewAt}>
                  <CalendarClock className="h-4 w-4" /> Reschedule & send
                </Button>
              </div>
              <p className="mt-2 text-xs text-slate-400">
                Rescheduling and resending both generate a brand-new interview link — any previously shared link will stop working.
              </p>

              {lastLink && (
                <div className="mt-4 rounded-xl border border-brand-100 bg-brand-50 p-3">
                  <p className="mb-1.5 text-xs font-medium text-brand-700">
                    New interview link (also emailed to the candidate — copy it to open on another device):
                  </p>
                  <div className="flex items-center gap-2">
                    <input
                      readOnly
                      value={lastLink}
                      onFocus={(e) => e.target.select()}
                      className="min-w-0 flex-1 truncate rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-700"
                    />
                    <Button variant="outline" size="sm" onClick={handleCopyLink}>
                      Copy
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </Section>
      )}

      {/* Timeline */}
      <Section title="Application Timeline">
        {!timeline?.stageHistory || timeline.stageHistory.length === 0 ? (
          <p className="text-sm text-slate-400">No timeline entries yet.</p>
        ) : (
          <ol className="relative space-y-4 border-l border-slate-200 pl-5">
            {[...timeline.stageHistory].reverse().map((h, i) => (
              <li key={i} className="relative">
                <span className="absolute -left-[27px] flex h-4 w-4 items-center justify-center rounded-full bg-brand-100">
                  <CheckCircle2 className="h-3 w-3 text-brand-600" />
                </span>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold text-slate-800">{stageLabel(h.stage)}</span>
                  <span className="inline-flex items-center gap-1 text-xs text-slate-400">
                    <Clock className="h-3 w-3" /> {formatWhen(h.at)}
                  </span>
                </div>
                <p className="text-xs text-slate-500">
                  by {h.by || "system"}
                  {h.note ? ` · ${h.note}` : ""}
                </p>
              </li>
            ))}
          </ol>
        )}
        {offer?.status && offer.status !== "none" && (
          <div className="mt-4 rounded-xl bg-slate-50 p-3 text-sm">
            <span className="font-medium text-slate-700">Offer:</span>{" "}
            <Badge tone={offer.status === "accepted" ? "green" : offer.status === "declined" ? "red" : "amber"}>{offer.status}</Badge>
            {offer.sentAt && <span className="ml-2 text-xs text-slate-400">sent {formatWhen(offer.sentAt)}</span>}
          </div>
        )}
      </Section>

      {ats && ats.overallScore != null && (
        <Section title="ATS Breakdown">
          <div className="grid gap-3 sm:grid-cols-3">
            {[
              ["Skills Match", ats.skillsMatch],
              ["Experience Match", ats.experienceMatch],
              ["Education Match", ats.educationMatch],
              ["Projects Match", ats.projectsMatch],
              ["Certification Match", ats.certificationMatch],
              ["Keyword Match", ats.keywordMatch],
            ].map(([label, value]) => (
              <div key={label} className="rounded-xl bg-slate-50 p-3">
                <p className="text-xs text-slate-400">{label}</p>
                <p className="mt-1 text-lg font-bold text-slate-900">{value}%</p>
              </div>
            ))}
          </div>
          {ats.missingSkills?.length > 0 && (
            <div className="mt-4">
              <p className="mb-2 text-xs font-medium text-slate-400">Missing Skills</p>
              <div className="flex flex-wrap gap-1.5">
                {ats.missingSkills.map((s) => (
                  <Badge key={s} tone="red">{s}</Badge>
                ))}
              </div>
            </div>
          )}
        </Section>
      )}

      <Section title="Experience">
        {experience.length === 0 && <p className="text-sm text-slate-400">—</p>}
        <div className="space-y-3">
          {experience.map((exp, i) => (
            <div className="rounded-xl border border-slate-100 bg-slate-50 p-4" key={i}>
              <p className="font-semibold text-slate-800">
                {exp.role} @ {exp.company}
              </p>
              <p className="text-xs text-slate-400">
                {exp.startDate} — {exp.currentlyWorking ? "Present" : exp.endDate}
              </p>
              {exp.description && <p className="mt-2 text-sm text-slate-600">{exp.description}</p>}
            </div>
          ))}
        </div>
      </Section>

      <Section title="Education">
        {education.length === 0 && <p className="text-sm text-slate-400">—</p>}
        <div className="space-y-3">
          {education.map((edu, i) => (
            <div className="rounded-xl border border-slate-100 bg-slate-50 p-4" key={i}>
              <p className="font-semibold text-slate-800">
                {edu.degree}
                {edu.fieldOfStudy ? ` in ${edu.fieldOfStudy}` : ""} — {edu.institution}
              </p>
              <p className="text-xs text-slate-400">
                {edu.startYear} — {edu.endYear} {edu.grade && `· Grade: ${edu.grade}`}
              </p>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Skills">
        {skills.length === 0 ? (
          <p className="text-sm text-slate-400">—</p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {skills.map((s, i) => (
              <Badge key={i}>{s}</Badge>
            ))}
          </div>
        )}
      </Section>

      <Section title="Projects">
        {projects.length === 0 && <p className="text-sm text-slate-400">—</p>}
        <div className="space-y-3">
          {projects.map((proj, i) => (
            <div className="rounded-xl border border-slate-100 bg-slate-50 p-4" key={i}>
              <p className="font-semibold text-slate-800">{proj.title}</p>
              {proj.techStack && <p className="text-xs text-slate-400">Tech: {proj.techStack}</p>}
              {proj.description && <p className="mt-2 text-sm text-slate-600">{proj.description}</p>}
              {proj.link && (
                <a href={proj.link} target="_blank" rel="noreferrer" className="mt-1 inline-block text-sm font-medium text-brand-700 hover:underline">
                  {proj.link}
                </a>
              )}
            </div>
          ))}
        </div>
      </Section>

      <Section title="Certificates">
        {certificates.length === 0 && <p className="text-sm text-slate-400">—</p>}
        <div className="space-y-3">
          {certificates.map((cert, i) => (
            <div className="rounded-xl border border-slate-100 bg-slate-50 p-4" key={i}>
              <p className="font-semibold text-slate-800">{cert.name}</p>
              <p className="text-xs text-slate-400">
                {cert.issuer} {cert.issueDate && `· ${cert.issueDate}`}
              </p>
              {cert.credentialUrl && (
                <a href={cert.credentialUrl} target="_blank" rel="noreferrer" className="mt-1 inline-block text-sm font-medium text-brand-700 hover:underline">
                  {cert.credentialUrl}
                </a>
              )}
            </div>
          ))}
        </div>
      </Section>
    </div>
  );
}
