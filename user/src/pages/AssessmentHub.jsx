import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Loader2, AlertTriangle, Clock, CheckCircle2, PlayCircle, ShieldCheck, Send } from "lucide-react";
import api from "../api/client.js";
import { authHeader, clearAuth, getAuth } from "../portal/assessmentAuth.js";
import { Card, Badge } from "../components/ui/Card.jsx";
import Button from "../components/ui/Button.jsx";

// Section hub (ASSESSMENT-ENGINE-PLAN A2.4): instructions → consent (when the
// paper runs proctoring) → per-section status/timers with Start/Resume → final
// submit once every section is done. The exam grammar candidates already know.

const SECTION_STATUS = {
  not_started: { label: "Not started", tone: "slate" },
  in_progress: { label: "In progress", tone: "brand" },
  completed: { label: "Submitted", tone: "green" },
};

function fmtClock(sec) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export default function AssessmentHub() {
  const navigate = useNavigate();
  const [session, setSession] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [consentChecked, setConsentChecked] = useState(false);
  const [submitConfirm, setSubmitConfirm] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await api.get("/assessment-portal/me", { headers: authHeader() });
      setSession(res.data.session);
    } catch (err) {
      setError(err.response?.data?.error || "Could not load your assessment. Use your emailed link again.");
    }
  }, []);

  useEffect(() => {
    if (!getAuth()?.jwt) {
      setError("Please open your assessment through the link in your invitation email.");
      return;
    }
    load();
  }, [load]);

  async function begin() {
    setBusy(true);
    try {
      // Device/browser snapshot first (best-effort), then start.
      await api
        .post(
          "/assessment-portal/checks",
          {
            fullscreen: Boolean(document.fullscreenEnabled),
            deviceCompatible: true,
            browserInfo: navigator.userAgent.slice(0, 250),
          },
          { headers: authHeader() }
        )
        .catch(() => {});
      if (session?.proctoringRequired) {
        await api.post("/assessment-portal/proctoring/consent", { given: consentChecked }, { headers: authHeader() });
      }
      const res = await api.post("/assessment-portal/start", {}, { headers: authHeader() });
      setSession(res.data.session);
    } catch (err) {
      setError(err.response?.data?.error || "Could not start the assessment.");
    } finally {
      setBusy(false);
    }
  }

  async function openSection(sectionId) {
    navigate(`/assessment-portal/section/${sectionId}`);
  }

  async function finalSubmit() {
    setBusy(true);
    try {
      const res = await api.post("/assessment-portal/submit", {}, { headers: authHeader() });
      setSession((s) => ({ ...s, status: res.data.status }));
      setSubmitConfirm(false);
    } catch (err) {
      setError(err.response?.data?.error || "Submission failed — your answers are saved; try again.");
    } finally {
      setBusy(false);
    }
  }

  if (error) {
    return (
      <Card className="text-center">
        <AlertTriangle className="mx-auto mb-3 h-8 w-8 text-red-500" />
        <p className="text-sm font-medium text-red-600">{error}</p>
      </Card>
    );
  }
  if (!session) {
    return (
      <Card className="text-center">
        <Loader2 className="mx-auto h-6 w-6 animate-spin text-brand-600" />
      </Card>
    );
  }

  const started = Boolean(session.startedAt);
  const sectionStateById = new Map((session.sectionState || []).map((s) => [s.sectionId, s]));
  const allDone =
    started &&
    (session.sections || []).every((s) => (sectionStateById.get(s.id)?.status || "not_started") === "completed");

  if (session.status === "completed") {
    return (
      <Card className="text-center">
        <CheckCircle2 className="mx-auto mb-3 h-10 w-10 text-emerald-500" />
        <h1 className="text-lg font-semibold text-slate-900">Assessment submitted</h1>
        <p className="mt-2 text-sm text-slate-500">
          Thank you, {session.candidateName}. Your answers are in. If you advance, your AI interview invitation will arrive by
          email — keep an eye on your inbox.
        </p>
      </Card>
    );
  }

  return (
    <div className="space-y-5">
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-lg font-bold text-slate-900">Skills Assessment — {session.jobTitle}</h1>
            <p className="text-sm text-slate-500">Hi {session.candidateName}</p>
          </div>
          <Badge tone={session.paused ? "amber" : "brand"}>{session.paused ? "Paused" : started ? "In progress" : "Ready"}</Badge>
        </div>
        <div className="mt-3 flex flex-wrap gap-4 text-xs text-slate-500">
          <span className="inline-flex items-center gap-1">
            <Clock className="h-3.5 w-3.5" /> Start by {new Date(session.startDeadline).toLocaleString()}
          </span>
          <span>Link valid until {new Date(session.expiresAt).toLocaleString()}</span>
        </div>
      </Card>

      {session.paused && (
        <Card className="border-amber-200 bg-amber-50/60">
          <p className="text-sm text-amber-800">
            Your assessment is briefly paused — a reviewer has been notified and it will resume shortly. Nothing you've answered is
            lost, and your section clock is stopped while paused.
          </p>
        </Card>
      )}

      {!started && (
        <Card>
          <h2 className="text-base font-semibold text-slate-800">Before you start</h2>
          <p className="mt-2 whitespace-pre-line text-sm text-slate-600">
            {session.instructions ||
              "Each section is timed separately — once you start a section, its clock runs until you submit it. Your answers save automatically; if you lose connection, reopen your link to resume exactly where you left off."}
          </p>
          {session.proctoringRequired && (
            <label className="mt-4 flex items-start gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600">
              <input type="checkbox" className="mt-0.5" checked={consentChecked} onChange={(e) => setConsentChecked(e.target.checked)} />
              <span>
                <ShieldCheck className="mr-1 inline h-4 w-4 text-brand-600" />
                I consent to integrity monitoring during this assessment (tab switches, focus changes and similar signals are
                recorded). These are advisory signals reviewed by a human — nothing terminates your test automatically.
              </span>
            </label>
          )}
          <Button className="mt-4" onClick={begin} loading={busy} disabled={session.proctoringRequired && !consentChecked}>
            <PlayCircle className="h-4 w-4" /> Start assessment
          </Button>
        </Card>
      )}

      {started && (
        <Card>
          <h2 className="text-base font-semibold text-slate-800">Sections</h2>
          <div className="mt-3 space-y-2">
            {(session.sections || []).map((section) => {
              const state = sectionStateById.get(section.id) || { status: "not_started" };
              const meta = SECTION_STATUS[state.status] || SECTION_STATUS.not_started;
              return (
                <div key={section.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 p-3">
                  <div className="min-w-[10rem] flex-1">
                    <p className="text-sm font-semibold text-slate-800">{section.title}</p>
                    <p className="text-xs text-slate-400">
                      {section.itemCount} questions · {fmtClock(section.timeLimitSec)} time limit
                    </p>
                  </div>
                  <Badge tone={meta.tone}>{meta.label}</Badge>
                  {state.status !== "completed" && (
                    <Button onClick={() => openSection(section.id)} disabled={busy || session.paused}>
                      {state.status === "in_progress" ? "Resume" : "Start"}
                    </Button>
                  )}
                </div>
              );
            })}
          </div>

          <div className="mt-5 border-t border-slate-100 pt-4">
            {!submitConfirm ? (
              <Button onClick={() => setSubmitConfirm(true)} disabled={busy || !allDone} variant={allDone ? "primary" : "secondary"}>
                <Send className="h-4 w-4" /> Submit assessment
              </Button>
            ) : (
              <div className="flex flex-wrap items-center gap-3">
                <p className="text-sm text-slate-600">Submit your assessment? You can't change answers after this.</p>
                <Button onClick={finalSubmit} loading={busy}>
                  Yes, submit
                </Button>
                <Button variant="ghost" onClick={() => setSubmitConfirm(false)}>
                  Not yet
                </Button>
              </div>
            )}
            {!allDone && <p className="mt-2 text-xs text-slate-400">Finish every section to enable the final submit.</p>}
          </div>
        </Card>
      )}
    </div>
  );
}
