import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Loader2,
  AlertTriangle,
  AlertCircle,
  Clock,
  CheckCircle2,
  PlayCircle,
  ShieldCheck,
  Send,
  ChevronRight,
  ClipboardList,
  Lock,
} from "lucide-react";
import api from "../api/client.js";
import { authHeader, getAuth } from "../portal/assessmentAuth.js";
import { Card, Badge, IconTile } from "../components/ui/Card.jsx";
import Button from "../components/ui/Button.jsx";

// Section hub (ASSESSMENT-ENGINE-PLAN A2.4): instructions → consent (when the
// paper runs proctoring) → per-section status/timers with Start/Resume → final
// submit once every section is done. The exam grammar candidates already know.
//
// Two rules this screen learned from the item screen:
//   1. A blocked action names its blocker. "Finish every section" is not an
//      instruction if it does not say WHICH section, with a way to get there.
//   2. A failed action never destroys the page. Load failures are fatal and take
//      the screen; action failures are inline and leave everything reachable.

const SECTION_STATUS = {
  not_started: { label: "Not started", tone: "slate" },
  in_progress: { label: "In progress", tone: "brand" },
  completed: { label: "Submitted", tone: "green" },
};

// A time LIMIT is a duration, not a clock. "30:00" reads as a countdown already
// running; "30 min" reads as the budget it actually is.
function fmtDuration(sec) {
  const total = Math.max(0, Math.round(sec || 0));
  if (total < 60) return `${total} sec`;
  const m = Math.round(total / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return rest ? `${h} hr ${rest} min` : `${h} hr`;
}

export default function AssessmentHub() {
  const navigate = useNavigate();
  const [session, setSession] = useState(null);
  const [loadError, setLoadError] = useState("");
  const [actionError, setActionError] = useState("");
  const [busy, setBusy] = useState(false);
  const [consentChecked, setConsentChecked] = useState(false);
  const [lockAcknowledged, setLockAcknowledged] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await api.get("/assessment-portal/me", { headers: authHeader() });
      setSession(res.data.session);
    } catch (err) {
      setLoadError(err.response?.data?.error || "Could not load your assessment. Use your emailed link again.");
    }
  }, []);

  useEffect(() => {
    if (!getAuth()?.jwt) {
      setLoadError("Please open your assessment through the link in your invitation email.");
      return;
    }
    load();
  }, [load]);

  async function begin() {
    setBusy(true);
    setActionError("");
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
      setActionError(err.response?.data?.error || "Could not start the assessment. Nothing has been recorded — try again.");
    } finally {
      setBusy(false);
    }
  }

  async function finalSubmit() {
    setBusy(true);
    setActionError("");
    try {
      const res = await api.post("/assessment-portal/submit", {}, { headers: authHeader() });
      setSession((s) => ({ ...s, status: res.data.status }));
    } catch (err) {
      // Inline, NOT page-level: a network blip at the final step must not take
      // the candidate's own sections off the screen.
      setActionError(err.response?.data?.error || "Submission failed — your answers are saved. Try again.");
    } finally {
      setBusy(false);
    }
  }

  if (loadError) {
    return (
      <Card className="text-center">
        <AlertTriangle className="mx-auto mb-3 h-8 w-8 text-red-500" />
        <p className="text-sm font-medium text-red-600">{loadError}</p>
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
  const sections = session.sections || [];
  const stateById = new Map((session.sectionState || []).map((s) => [s.sectionId, s]));
  const statusOf = (id) => stateById.get(id)?.status || "not_started";
  const outstanding = started ? sections.filter((s) => statusOf(s.id) !== "completed") : sections;
  const allDone = started && outstanding.length === 0;

  const totals = sections.reduce(
    (acc, s) => ({
      answered: acc.answered + (statusOf(s.id) === "not_started" ? 0 : s.answeredCount || 0),
      items: acc.items + (s.itemCount || 0),
    }),
    { answered: 0, items: 0 }
  );

  if (session.status === "completed") {
    return (
      <Card className="py-10 text-center">
        <span className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-verdict-positive-tint text-verdict-positive">
          <CheckCircle2 className="h-7 w-7" aria-hidden="true" />
        </span>
        <h1 className="font-display text-xl font-bold tracking-tight text-slate-900">Assessment submitted</h1>
        <p className="mx-auto mt-2 max-w-md text-sm text-slate-500">
          Thank you, {session.candidateName}. Your answers are in. If you advance, your AI interview invitation will arrive by
          email — keep an eye on your inbox.
        </p>
        {totals.items > 0 && (
          <p className="mt-5 inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-canvas px-4 py-2.5 text-xs text-slate-600">
            <Lock className="h-3.5 w-3.5" aria-hidden="true" />
            {totals.answered} of {totals.items} questions answered across {sections.length} section
            {sections.length === 1 ? "" : "s"}
          </p>
        )}
      </Card>
    );
  }

  return (
    <div className="space-y-5">
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-4">
            <IconTile icon={ClipboardList} size="lg" />
            <div className="min-w-0">
              <h1 className="font-display text-xl font-bold tracking-tight text-slate-900">
                Skills assessment — {session.jobTitle}
              </h1>
              <p className="mt-0.5 text-sm text-slate-500">Hi {session.candidateName}</p>
            </div>
          </div>
          <Badge tone={session.paused ? "amber" : "brand"}>{session.paused ? "Paused" : started ? "In progress" : "Ready"}</Badge>
        </div>
        {/* Both deadlines get an equal, bordered slot. The "start by" date used
            to be the only one with an icon, which read as the only one that
            mattered — they are two different ways to lose the assessment. */}
        <dl className="mt-5 grid gap-3 border-t border-slate-100 pt-5 sm:grid-cols-2">
          <div className="rounded-xl border border-slate-200 bg-canvas px-4 py-3">
            <dt className="flex items-center gap-1.5 text-xs font-semibold text-slate-600">
              <Clock className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" /> Start by
            </dt>
            <dd className="mt-1 text-sm font-semibold text-slate-900">
              {new Date(session.startDeadline).toLocaleString()}
            </dd>
          </div>
          <div className="rounded-xl border border-slate-200 bg-canvas px-4 py-3">
            <dt className="flex items-center gap-1.5 text-xs font-semibold text-slate-600">
              <Lock className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" /> Link valid until
            </dt>
            <dd className="mt-1 text-sm font-semibold text-slate-900">
              {new Date(session.expiresAt).toLocaleString()}
            </dd>
          </div>
        </dl>
      </Card>

      {actionError && (
        <p className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-3.5 py-3 text-sm text-red-700" role="alert">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          {actionError}
        </p>
      )}

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

          {sections.length > 0 && (
            <ul className="mt-4 space-y-1.5">
              {sections.map((s) => (
                <li className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm" key={s.id}>
                  <span className="min-w-0 truncate font-medium text-slate-700">{s.title}</span>
                  <span className="shrink-0 text-xs text-slate-500">
                    {s.itemCount} questions · {fmtDuration(s.timeLimitSec)}
                  </span>
                </li>
              ))}
            </ul>
          )}

          {session.proctoringRequired && (
            <label className="mt-4 flex cursor-pointer items-start gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600">
              <input
                type="checkbox"
                className="mt-0.5 h-4 w-4 shrink-0"
                checked={consentChecked}
                onChange={(e) => setConsentChecked(e.target.checked)}
              />
              <span>
                <ShieldCheck className="mr-1 inline h-4 w-4 text-brand-600" aria-hidden="true" />
                I consent to integrity monitoring during this assessment (tab switches, focus changes and similar signals are
                recorded). These are advisory signals reviewed by a human — nothing terminates your test automatically.
              </span>
            </label>
          )}

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <Button onClick={begin} loading={busy} disabled={session.proctoringRequired && !consentChecked}>
              <PlayCircle className="h-4 w-4" /> Start assessment
            </Button>
            {session.proctoringRequired && !consentChecked && (
              <p className="text-xs font-medium text-amber-700">Tick the consent box above to begin.</p>
            )}
          </div>
        </Card>
      )}

      {started && (
        <>
          <Card>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-base font-semibold text-slate-800">Sections</h2>
              <p className="text-xs text-slate-500">
                {sections.length - outstanding.length} of {sections.length} submitted
              </p>
            </div>

            <div className="mt-3 space-y-2">
              {sections.map((section) => {
                const status = statusOf(section.id);
                const meta = SECTION_STATUS[status] || SECTION_STATUS.not_started;
                const answered = status === "not_started" ? 0 : section.answeredCount || 0;
                const total = section.itemCount || 0;
                const pct = total ? Math.round((answered / total) * 100) : 0;
                return (
                  <div key={section.id} className="rounded-2xl border border-slate-200 bg-white p-4">
                    <div className="flex flex-wrap items-center gap-3">
                      <div className="flex min-w-[10rem] flex-1 items-center gap-3">
                        <IconTile
                          icon={ClipboardList}
                          size="sm"
                          tone={status === "completed" ? "positive" : status === "in_progress" ? "brand" : "slate"}
                        />
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-slate-800">{section.title}</p>
                          {/* Was `slate-400` — 2.5:1 on white, under AA. This line
                              is the time budget; it has to be readable. */}
                          <p className="text-xs text-slate-500">
                            {total} questions · {fmtDuration(section.timeLimitSec)} limit
                          </p>
                        </div>
                      </div>
                      <Badge tone={meta.tone}>{meta.label}</Badge>
                      {status !== "completed" && (
                        <Button onClick={() => navigate(`/assessment-portal/section/${section.id}`)} disabled={busy || session.paused}>
                          {status === "in_progress" ? "Resume" : "Start"}
                          <ChevronRight className="h-4 w-4" />
                        </Button>
                      )}
                    </div>

                    {/* Answered-so-far, counted by the same code that scores it.
                        A submitted section's bar is a record, not progress — it
                        never wears the in-flight blue. */}
                    {status !== "not_started" && total > 0 && (
                      <div className="mt-2.5">
                        <div className="h-1 w-full overflow-hidden rounded-full bg-slate-100">
                          <div
                            className={`h-full ${
                              status !== "completed"
                                ? "bg-brand-600"
                                : answered === total
                                  ? "bg-verdict-positive"
                                  : "bg-slate-400"
                            }`}
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                        <p className="mt-1 text-xs text-slate-500">
                          {answered} of {total} answered
                          {status === "completed" && answered < total && (
                            <span className="text-slate-400"> · {total - answered} left blank</span>
                          )}
                        </p>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Blocked state lives HERE, not in a second card that repeats every
                row and button one screen down. The rows above already carry the
                actions; this only has to name what is still open. */}
            {!allDone && (
              <p className="mt-4 flex items-start gap-2 border-t border-slate-100 pt-3.5 text-sm text-slate-600">
                <Lock className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
                <span>
                  Final submit unlocks once every section is in. Still open:{" "}
                  {outstanding.map((s, i) => (
                    <span key={s.id}>
                      {i > 0 && ", "}
                      <strong className="font-semibold text-slate-800">{s.title}</strong>
                    </span>
                  ))}
                  .
                </span>
              </p>
            )}
          </Card>

          {allDone && (
            <Card>
              <h2 className="text-base font-semibold text-slate-800">Submit your assessment</h2>
              <p className="mt-2 text-sm text-slate-600">
                Every section is submitted and locked. This hands {totals.answered} answered question
                {totals.answered === 1 ? "" : "s"} of {totals.items} to the hiring team for scoring.
              </p>

              <label className="mt-4 flex cursor-pointer items-start gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3.5">
                <input
                  type="checkbox"
                  checked={lockAcknowledged}
                  onChange={(e) => setLockAcknowledged(e.target.checked)}
                  className="mt-0.5 h-4 w-4 shrink-0"
                />
                <span className="text-sm text-slate-700">
                  I understand this is final — my answers can't be changed after I submit.
                </span>
              </label>

              <div className="mt-4 flex flex-wrap items-center gap-3">
                <Button onClick={finalSubmit} loading={busy} disabled={!lockAcknowledged}>
                  <Send className="h-4 w-4" /> Submit assessment
                </Button>
                {!lockAcknowledged && <p className="text-xs font-medium text-slate-500">Confirm above to submit.</p>}
              </div>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
