import { useEffect, useState, useCallback, useMemo } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  FileText,
  Bell,
  History,
  Bookmark,
  Sparkles,
  ExternalLink,
  ListChecks,
  AlertTriangle,
  CircleCheck,
  Hourglass,
  Mail,
  ChevronDown,
  ClipboardList,
  Video,
  UserRound,
  CircleDot,
} from "lucide-react";
import api from "../api/client.js";
import { accountAuthHeader, clearAccountAuth } from "../auth/accountAuth.js";
import { getSocket } from "../lib/socket.js";
import { Card, Badge, Skeleton, EmptyState } from "../components/ui/Card.jsx";
import { Input, Textarea, Label, FormGroup } from "../components/ui/Field.jsx";
import Button from "../components/ui/Button.jsx";
import { stageLabel, stageTone, stageProgress, isRejected, STAGES, STAGE_LABELS } from "../lib/pipeline.js";

// --- time -------------------------------------------------------------------

// Deadlines here decide outcomes, so they are measured against the SERVER's
// clock, not the browser's. A device that is hours fast would otherwise tell a
// candidate a window had closed when it had not, or worse, the reverse.
function useServerClock(serverTime) {
  const [offset, setOffset] = useState(0);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (serverTime) setOffset(new Date(serverTime).getTime() - Date.now());
  }, [serverTime]);

  // Re-render once a minute so a countdown does not go stale while the page
  // sits open — which is exactly how someone misses a window.
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 60_000);
    return () => clearInterval(id);
  }, []);

  return useCallback(() => Date.now() + offset, [offset, tick]);
}

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

function formatAbsolute(value) {
  if (!value) return "";
  return new Date(value).toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

// "in 3 hours" / "5 days ago". Always rendered next to the absolute timestamp —
// a relative phrase alone is not something you can plan around.
function formatRelative(value, now) {
  if (!value) return "";
  const diff = new Date(value).getTime() - now;
  const past = diff < 0;
  const abs = Math.abs(diff);

  let phrase;
  if (abs < MIN) phrase = "less than a minute";
  else if (abs < HOUR) {
    const m = Math.round(abs / MIN);
    phrase = `${m} minute${m === 1 ? "" : "s"}`;
  } else if (abs < DAY) {
    const h = Math.round(abs / HOUR);
    phrase = `${h} hour${h === 1 ? "" : "s"}`;
  } else {
    const d = Math.round(abs / DAY);
    phrase = `${d} day${d === 1 ? "" : "s"}`;
  }
  return past ? `${phrase} ago` : `in ${phrase}`;
}

// --- action presentation ----------------------------------------------------

const ACTION_ICONS = {
  assessment: ClipboardList,
  interview: Video,
  offer: Sparkles,
  review: Hourglass,
  closed: CircleCheck,
};

// Tone is driven by state, not by kind: what matters is whether the candidate
// is blocked, running out of time, or free to wait.
function actionTone(action, now) {
  if (action.state === "missed") return "red";
  if (action.owner !== "candidate") return "slate";
  const due = action.dueAt ? new Date(action.dueAt).getTime() : null;
  if (due !== null && due - now <= DAY) return "amber";
  return "brand";
}

const TONE_STYLES = {
  red: { wrap: "border-red-200 bg-red-50", icon: "bg-red-100 text-red-700", text: "text-red-700" },
  amber: { wrap: "border-amber-200 bg-amber-50", icon: "bg-amber-100 text-amber-700", text: "text-amber-700" },
  brand: { wrap: "border-brand-200 bg-brand-50", icon: "bg-brand-100 text-brand-700", text: "text-brand-700" },
  slate: { wrap: "border-slate-200 bg-slate-50", icon: "bg-slate-100 text-slate-600", text: "text-slate-600" },
};

// The line that names who the step is waiting on. Every other candidate portal
// shows a status label with no owner, which is why "Under Review" tells you
// nothing — it is equally true on day 1 and day 60.
function OwnerLine({ action, now }) {
  if (action.owner === "candidate") {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-700">
        <UserRound className="h-3.5 w-3.5" /> Waiting on you
      </span>
    );
  }
  if (action.owner === "company") {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500">
        <Hourglass className="h-3.5 w-3.5" /> Waiting on the hiring team
        {action.since ? ` · for ${formatRelative(action.since, now).replace(" ago", "")}` : ""}
      </span>
    );
  }
  return null;
}

// One thing the candidate must do, with its real deadline and a route back in
// if they have lost access. `onRecover` re-sends to the address on file — the
// link itself never travels through this page.
function ActionRow({ action, jobTitle, companyName, now, onRecover, recovering, recovered }) {
  const Icon = ACTION_ICONS[action.kind] || CircleDot;
  const tone = TONE_STYLES[actionTone(action, now)];
  const due = action.dueAt;

  return (
    <div className={`rounded-xl border p-4 ${tone.wrap}`}>
      <div className="flex items-start gap-3">
        <span className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${tone.icon}`}>
          {action.state === "missed" ? <AlertTriangle className="h-4.5 w-4.5" /> : <Icon className="h-4.5 w-4.5" />}
        </span>

        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-slate-900">{action.title}</p>
          {jobTitle && (
            <p className="truncate text-xs text-slate-500">
              {jobTitle}
              {companyName ? ` · ${companyName}` : ""}
            </p>
          )}
          <p className="mt-1.5 text-sm text-slate-600">{action.detail}</p>

          {action.scheduledAt && (
            <p className="mt-1.5 text-xs text-slate-500">
              Scheduled for <span className="font-medium text-slate-700">{formatAbsolute(action.scheduledAt)}</span>
            </p>
          )}

          {due && (
            <p className={`mt-1.5 text-xs font-semibold ${tone.text}`}>
              {action.state === "missed" ? "Closed" : "Closes"} {formatRelative(due, now)}
              <span className="ml-1 font-normal text-slate-500">· {formatAbsolute(due)}</span>
            </p>
          )}

          {action.canRecoverLink && (
            <div className="mt-3">
              {recovered ? (
                <p className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-700">
                  <CircleCheck className="h-3.5 w-3.5" /> Sent — check your inbox and spam folder.
                </p>
              ) : (
                <Button variant="outline" size="sm" loading={recovering} onClick={onRecover}>
                  <Mail className="h-3.5 w-3.5" /> Email me a fresh link
                </Button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// --- application tracking ---------------------------------------------------

// The full ordered pipeline with the reached point marked. A candidate can see
// not just where they are but what the remaining process actually is — which
// the single status label they get everywhere else never tells them.
function StageTrack({ status, stageHistory }) {
  const reached = useMemo(() => {
    const set = new Set((stageHistory || []).map((h) => h.stage));
    set.add(status);
    return set;
  }, [status, stageHistory]);

  const atIndex = STAGES.indexOf(status);
  const dates = useMemo(() => {
    const map = {};
    for (const h of stageHistory || []) if (h.at && !map[h.stage]) map[h.stage] = h.at;
    return map;
  }, [stageHistory]);

  // Only stages this application has actually touched, plus the next two, so a
  // 15-step pipeline does not drown the three steps that matter.
  const visible = STAGES.filter((s, i) => reached.has(s) || (atIndex >= 0 && i > atIndex && i <= atIndex + 2));

  return (
    <ol className="mt-4 space-y-2.5">
      {visible.map((stage) => {
        const done = reached.has(stage);
        const current = stage === status;
        return (
          <li key={stage} className="flex items-start gap-2.5">
            <span
              className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2 ${
                current
                  ? "border-brand-600 bg-brand-600"
                  : done
                    ? "border-brand-300 bg-brand-300"
                    : "border-slate-200 bg-white"
              }`}
            >
              {done && <span className="h-1.5 w-1.5 rounded-full bg-white" />}
            </span>
            <div className="min-w-0">
              <p className={`text-xs ${current ? "font-semibold text-slate-900" : done ? "font-medium text-slate-600" : "text-slate-400"}`}>
                {STAGE_LABELS[stage] || stage}
              </p>
              {dates[stage] && <p className="text-[11px] text-slate-400">{formatAbsolute(dates[stage])}</p>}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function ApplicationCard({ application, next, now, onRecover, recoveringId, recoveredIds }) {
  const [open, setOpen] = useState(false);
  const { job, status, stageHistory = [], offer } = application;
  const rejected = isRejected(status);
  const pct = Math.round(stageProgress(status) * 100);
  const primary = next?.primary;

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-slate-900">{job?.title || "Application"}</p>
          <p className="truncate text-xs text-slate-500">{job?.company?.name}</p>
        </div>
        <Badge tone={stageTone(status)}>{stageLabel(status)}</Badge>
      </div>

      {!rejected && (
        <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
          <div className="h-full rounded-full bg-brand-600 transition-all" style={{ width: `${pct}%` }} />
        </div>
      )}

      {primary && (
        <div className="mt-3">
          <OwnerLine action={primary} now={now} />
          <p className="mt-1 text-sm text-slate-600">{primary.detail}</p>
          {primary.dueAt && primary.owner === "candidate" && (
            <p className={`mt-1 text-xs font-semibold ${TONE_STYLES[actionTone(primary, now)].text}`}>
              {primary.state === "missed" ? "Closed" : "Closes"} {formatRelative(primary.dueAt, now)}
            </p>
          )}
        </div>
      )}

      {offer?.status && offer.status !== "none" && (
        <p className="mt-2 text-xs font-medium text-amber-700">
          Offer {offer.status}
          {offer.sentAt ? ` · sent ${formatAbsolute(offer.sentAt)}` : ""}
        </p>
      )}

      {primary?.canRecoverLink && (
        <div className="mt-3">
          {recoveredIds.has(primary.sessionId) ? (
            <p className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-700">
              <CircleCheck className="h-3.5 w-3.5" /> Link sent to your email.
            </p>
          ) : (
            <Button
              variant="outline"
              size="sm"
              loading={recoveringId === primary.sessionId}
              onClick={() => onRecover(primary)}
            >
              <Mail className="h-3.5 w-3.5" /> Email me a fresh link
            </Button>
          )}
        </div>
      )}

      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-brand-700 hover:underline"
      >
        <ChevronDown className={`h-3.5 w-3.5 transition-transform ${open ? "rotate-180" : ""}`} />
        {open ? "Hide" : "Show"} full progress
      </button>

      {open && <StageTrack status={status} stageHistory={stageHistory} />}
    </div>
  );
}

// --- page -------------------------------------------------------------------

function SectionCard({ title, icon: Icon, children, action }) {
  return (
    <Card>
      <div className="mb-4 flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-base font-semibold text-slate-900">
          <Icon className="h-4.5 w-4.5 text-brand-600" /> {title}
        </h3>
        {action}
      </div>
      {children}
    </Card>
  );
}

export default function CandidateDashboard() {
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [profileForm, setProfileForm] = useState({ headline: "", location: "", bio: "", skills: "" });
  const [savingProfile, setSavingProfile] = useState(false);
  const [recoveringId, setRecoveringId] = useState(null);
  const [recoveredIds, setRecoveredIds] = useState(() => new Set());
  const [recoverError, setRecoverError] = useState("");

  const load = useCallback(async () => {
    try {
      const res = await api.get("/candidate-dashboard", { headers: accountAuthHeader() });
      setData(res.data);
      setProfileForm({
        headline: res.data.profile.headline || "",
        location: res.data.profile.location || "",
        bio: res.data.profile.bio || "",
        skills: (res.data.profile.skills || []).join(", "),
      });
    } catch (err) {
      clearAccountAuth();
      setError("Your session has expired. Please log in again.");
      setTimeout(() => navigate("/login", { replace: true }), 1200);
    }
  }, [navigate]);

  useEffect(() => {
    load();
  }, [load]);

  const nowFn = useServerClock(data?.serverTime);
  const now = nowFn();

  // Live-refresh when an admin moves this candidate's stage — no page refresh
  // required (Module 11 realtime requirement).
  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;
    const onStage = () => load();
    socket.on("candidate:stage", onStage);
    return () => socket.off("candidate:stage", onStage);
  }, [load]);

  async function handleProfileSave(e) {
    e.preventDefault();
    setSavingProfile(true);
    try {
      await api.patch(
        "/candidate-dashboard/profile",
        {
          headline: profileForm.headline,
          location: profileForm.location,
          bio: profileForm.bio,
          skills: profileForm.skills.split(",").map((s) => s.trim()).filter(Boolean),
        },
        { headers: accountAuthHeader() }
      );
      await load();
    } finally {
      setSavingProfile(false);
    }
  }

  async function toggleSaveJob(jobId) {
    await api.post(`/candidate-dashboard/saved-jobs/${jobId}`, {}, { headers: accountAuthHeader() });
    await load();
  }

  async function markNotificationRead(id) {
    await api.patch(`/notifications/${id}/read`, {}, { headers: accountAuthHeader() });
    await load();
  }

  // Ask the server to re-send this session's link to the address on file. The
  // link is never returned here — only the confirmation that it was sent.
  async function recoverLink(action) {
    if (!action?.sessionId) return;
    setRecoveringId(action.sessionId);
    setRecoverError("");
    try {
      await api.post(
        `/candidate-dashboard/sessions/${action.kind}/${action.sessionId}/resend`,
        {},
        { headers: accountAuthHeader() }
      );
      setRecoveredIds((prev) => new Set(prev).add(action.sessionId));
      await load();
    } catch (err) {
      setRecoverError(err?.response?.data?.error || "We couldn't send that link. Please try again shortly.");
    } finally {
      setRecoveringId(null);
    }
  }

  const applicationsById = useMemo(() => {
    const map = new Map();
    for (const a of data?.appliedJobs || []) map.set(String(a._id), a);
    return map;
  }, [data]);

  const nextByApplication = useMemo(() => {
    const map = new Map();
    for (const n of data?.nextActions || []) map.set(String(n.applicationId), n);
    return map;
  }, [data]);

  // Everything the candidate is personally blocking, across all applications,
  // most urgent first. This is the whole point of the screen.
  const needsYou = useMemo(() => {
    const rows = [];
    for (const entry of data?.nextActions || []) {
      const application = applicationsById.get(String(entry.applicationId));
      for (const action of entry.actions || []) {
        if (action.owner !== "candidate") continue;
        rows.push({ action, application });
      }
      // Offers have no session object, so they only appear as `primary`.
      if (entry.primary?.owner === "candidate" && entry.primary.kind === "offer") {
        rows.push({ action: entry.primary, application });
      }
    }
    const rank = { missed: 0, in_progress: 1, due: 2 };
    return rows.sort((a, b) => {
      const r = (rank[a.action.state] ?? 9) - (rank[b.action.state] ?? 9);
      if (r !== 0) return r;
      const at = a.action.dueAt ? new Date(a.action.dueAt).getTime() : Infinity;
      const bt = b.action.dueAt ? new Date(b.action.dueAt).getTime() : Infinity;
      return at - bt;
    });
  }, [data, applicationsById]);

  if (error) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold text-slate-900">My Dashboard</h1>
        <p className="text-sm font-medium text-red-600">{error}</p>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-6 w-40" />
        <Card><Skeleton className="h-32 w-full" /></Card>
        <Card><Skeleton className="h-32 w-full" /></Card>
      </div>
    );
  }

  const pct = data.profile.profileCompletionPercent;
  const activeApplications = data.appliedJobs.filter((a) => !isRejected(a.status));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">My Dashboard</h1>
        <p className="mt-1 text-sm text-slate-500">
          Every step shows who it's waiting on and when it closes — so nothing is a black box.
        </p>
      </div>

      {/* The hero. Only rendered when something is genuinely owed, so an empty
          state here is meaningful rather than decorative. */}
      {needsYou.length > 0 ? (
        <Card className="border-brand-200">
          <h2 className="mb-1 flex items-center gap-2 text-base font-semibold text-slate-900">
            <ListChecks className="h-4.5 w-4.5 text-brand-600" /> Needs you
            <Badge tone="brand">{needsYou.length}</Badge>
          </h2>
          <p className="mb-4 text-xs text-slate-500">
            These are waiting on you. Deadlines are shown in your local time.
          </p>

          {recoverError && <p className="mb-3 text-sm font-medium text-red-600">{recoverError}</p>}

          <div className="space-y-3">
            {needsYou.map(({ action, application }) => (
              <ActionRow
                key={`${action.kind}-${action.sessionId || application?._id}`}
                action={action}
                jobTitle={application?.job?.title}
                companyName={application?.job?.company?.name}
                now={now}
                onRecover={() => recoverLink(action)}
                recovering={recoveringId === action.sessionId}
                recovered={recoveredIds.has(action.sessionId)}
              />
            ))}
          </div>
        </Card>
      ) : (
        data.appliedJobs.length > 0 && (
          <Card className="border-emerald-200 bg-emerald-50/50">
            <div className="flex items-start gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-emerald-100 text-emerald-700">
                <CircleCheck className="h-4.5 w-4.5" />
              </span>
              <div>
                <p className="text-sm font-semibold text-slate-900">Nothing needs you right now</p>
                <p className="mt-0.5 text-sm text-slate-600">
                  Every open application is with the hiring team. You'll be emailed and notified here the moment
                  that changes.
                </p>
              </div>
            </div>
          </Card>
        )
      )}

      <SectionCard
        title="Your applications"
        icon={ListChecks}
        action={
          activeApplications.length > 0 ? (
            <span className="text-xs text-slate-500">
              {activeApplications.length} active · {data.appliedJobs.length} total
            </span>
          ) : null
        }
      >
        {data.appliedJobs.length === 0 ? (
          <EmptyState
            icon={ListChecks}
            title="No applications yet"
            description="Apply to a job and you'll be able to track exactly where it stands — and what's waiting on who."
            action={
              <Link to="/">
                <Button size="sm">Browse open roles</Button>
              </Link>
            }
          />
        ) : (
          <div className="grid gap-3 lg:grid-cols-2">
            {data.appliedJobs.map((application) => (
              <ApplicationCard
                key={application._id}
                application={application}
                next={nextByApplication.get(String(application._id))}
                now={now}
                onRecover={recoverLink}
                recoveringId={recoveringId}
                recoveredIds={recoveredIds}
              />
            ))}
          </div>
        )}
      </SectionCard>

      <div className="grid gap-6 lg:grid-cols-2">
        <SectionCard title="Assessments" icon={ClipboardList}>
          {data.assessments?.length ? (
            <div className="space-y-3">
              {data.assessments.map((s) => (
                <div key={s._id} className="rounded-lg bg-slate-50 p-3">
                  <div className="flex items-start justify-between gap-2">
                    <p className="min-w-0 truncate text-sm font-semibold text-slate-800">{s.job?.title}</p>
                    <Badge tone={s.status === "completed" ? "green" : s.status === "expired" ? "red" : "brand"}>
                      {s.status.replace(/_/g, " ")}
                    </Badge>
                  </div>
                  {s.progress?.totalSections > 0 && (
                    <p className="mt-1 text-xs text-slate-500">
                      {s.progress.completedSections} of {s.progress.totalSections} sections complete
                      {s.progress.totalItems > 0 ? ` · ${s.progress.answered}/${s.progress.totalItems} answered` : ""}
                    </p>
                  )}
                  <p className="mt-1 text-xs text-slate-500">
                    {s.status === "completed" ? "Submitted" : "Closes"}{" "}
                    {formatAbsolute(s.status === "completed" ? s.completedAt : s.expiresAt)}
                  </p>
                  {/* Results belong to the hiring team until they choose to
                      share them — saying so is better than an unexplained gap. */}
                  {s.status === "completed" && (
                    <p className="mt-1 text-xs text-slate-400">
                      Results are reviewed by the hiring team and aren't shown here.
                    </p>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-slate-400">No assessments yet.</p>
          )}
        </SectionCard>

        <SectionCard title="Interviews" icon={Video}>
          {data.upcomingInterviews.length === 0 && data.aiInterviewHistory.length === 0 ? (
            <p className="text-sm text-slate-400">No interviews scheduled yet.</p>
          ) : (
            <div className="space-y-3">
              {[...data.upcomingInterviews, ...data.aiInterviewHistory].map((s) => (
                <div key={s._id} className="rounded-lg bg-slate-50 p-3">
                  <div className="flex items-start justify-between gap-2">
                    <p className="min-w-0 truncate text-sm font-semibold text-slate-800">{s.job?.title}</p>
                    <Badge tone={s.status === "completed" ? "green" : s.status === "expired" ? "red" : "brand"}>
                      {s.status.replace(/_/g, " ")}
                    </Badge>
                  </div>
                  <p className="mt-1 text-xs text-slate-500">{formatAbsolute(s.interviewAt)}</p>
                </div>
              ))}
            </div>
          )}
        </SectionCard>

        <SectionCard title="Resume" icon={FileText}>
          {data.resume.hasResume ? (
            <p className="text-sm text-emerald-700">Resume on file: {data.resume.latest.originalName}</p>
          ) : (
            <p className="text-sm text-slate-400">No resume uploaded yet.</p>
          )}
          <Link to="/resume">
            <Button variant="outline" size="sm" className="mt-3">
              Manage Resumes
            </Button>
          </Link>
        </SectionCard>

        <SectionCard title="Notifications" icon={Bell}>
          {data.notifications.length === 0 && <p className="text-sm text-slate-400">No notifications yet.</p>}
          <div className="space-y-3">
            {data.notifications.slice(0, 5).map((n) => (
              <div key={n._id} className="rounded-lg bg-slate-50 p-3">
                <p className="text-sm font-semibold text-slate-800">{n.title}</p>
                <p className="text-xs text-slate-500">{n.message}</p>
                {!n.read && (
                  <button
                    type="button"
                    onClick={() => markNotificationRead(n._id)}
                    className="mt-1 text-xs font-semibold text-brand-700 hover:underline"
                  >
                    Mark as read
                  </button>
                )}
              </div>
            ))}
          </div>
          <Link to="/notifications">
            <Button variant="outline" size="sm" className="mt-3">
              View All Notifications
            </Button>
          </Link>
        </SectionCard>

        <SectionCard title="Saved Jobs" icon={Bookmark}>
          {data.savedJobs.length === 0 ? (
            <p className="text-sm text-slate-400">No saved jobs yet.</p>
          ) : (
            <div className="space-y-2">
              {data.savedJobs.map((job) => (
                <div key={job._id} className="flex items-center justify-between rounded-lg bg-slate-50 p-3">
                  <div>
                    <Link to={`/jobs/${job.slug || job._id}`} className="text-sm font-semibold text-slate-800 hover:text-brand-700">
                      {job.title}
                    </Link>
                    <p className="text-xs text-slate-500">{job.company?.name}</p>
                  </div>
                  <button onClick={() => toggleSaveJob(job._id)} className="text-xs font-semibold text-red-600 hover:underline">
                    Remove
                  </button>
                </div>
              ))}
            </div>
          )}
        </SectionCard>

        <SectionCard title="Recommended Jobs" icon={Sparkles}>
          {data.recommendedJobs.length === 0 ? (
            <p className="text-sm text-slate-400">No recommendations yet — add skills to your profile to get matched.</p>
          ) : (
            <div className="space-y-2">
              {data.recommendedJobs.map((job) => (
                <div key={job._id} className="flex items-center justify-between rounded-lg bg-slate-50 p-3">
                  <div className="min-w-0">
                    <Link
                      to={`/jobs/${job.slug || job._id}`}
                      className="flex items-center gap-1 truncate text-sm font-semibold text-slate-800 hover:text-brand-700"
                    >
                      {job.title} <ExternalLink className="h-3 w-3 shrink-0" />
                    </Link>
                    <p className="truncate text-xs text-slate-500">{job.company?.name}</p>
                  </div>
                  <button onClick={() => toggleSaveJob(job._id)} className="shrink-0 text-xs font-semibold text-brand-700 hover:underline">
                    Save
                  </button>
                </div>
              ))}
            </div>
          )}
        </SectionCard>
      </div>

      {/* Profile sits below the tracking work: it is useful, but it is the part
          every portal already has, and it is not why someone opens this page. */}
      <Card>
        <div className="mb-4 flex items-center justify-between">
          <h3 className="flex items-center gap-2 text-base font-semibold text-slate-900">
            <UserRound className="h-4.5 w-4.5 text-brand-600" /> Your profile
          </h3>
          <span className="text-lg font-bold text-brand-700">{pct}%</span>
        </div>
        <div className="mb-6 h-2.5 w-full overflow-hidden rounded-full bg-slate-100">
          <div className="h-full rounded-full bg-brand-600 transition-all" style={{ width: `${pct}%` }} />
        </div>
        <form onSubmit={handleProfileSave}>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormGroup>
              <Label>Headline</Label>
              <Input
                value={profileForm.headline}
                onChange={(e) => setProfileForm((f) => ({ ...f, headline: e.target.value }))}
                placeholder="e.g. Backend Engineer"
              />
            </FormGroup>
            <FormGroup>
              <Label>Location</Label>
              <Input value={profileForm.location} onChange={(e) => setProfileForm((f) => ({ ...f, location: e.target.value }))} />
            </FormGroup>
            <FormGroup className="sm:col-span-2">
              <Label>Bio</Label>
              <Textarea rows={3} value={profileForm.bio} onChange={(e) => setProfileForm((f) => ({ ...f, bio: e.target.value }))} />
            </FormGroup>
            <FormGroup className="sm:col-span-2">
              <Label>Skills (comma-separated)</Label>
              <Input
                value={profileForm.skills}
                onChange={(e) => setProfileForm((f) => ({ ...f, skills: e.target.value }))}
                placeholder="e.g. Node.js, React, SQL"
              />
            </FormGroup>
          </div>
          <Button type="submit" loading={savingProfile}>
            Save Profile
          </Button>
        </form>
      </Card>

      <SectionCard title="Past interviews" icon={History}>
        {data.aiInterviewHistory.length === 0 ? (
          <p className="text-sm text-slate-400">No past interviews yet.</p>
        ) : (
          <div className="space-y-3">
            {data.aiInterviewHistory.map((s) => (
              <div key={s._id} className="flex items-center justify-between gap-2 rounded-lg bg-slate-50 p-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-slate-800">{s.job?.title}</p>
                  <p className="truncate text-xs text-slate-500">{formatAbsolute(s.interviewAt)}</p>
                </div>
                <Badge tone={s.status === "completed" ? "green" : "slate"}>{s.status.replace(/_/g, " ")}</Badge>
              </div>
            ))}
          </div>
        )}
      </SectionCard>
    </div>
  );
}
