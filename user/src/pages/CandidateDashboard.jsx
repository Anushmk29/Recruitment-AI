import { useEffect, useState, useCallback, useId, useMemo } from "react";
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
  ChevronDown,
  ClipboardList,
  Video,
  UserRound,
  CircleDot,
  ArrowRight,
} from "lucide-react";
import api from "../api/client.js";
import { accountAuthHeader, clearAccountAuth } from "../auth/accountAuth.js";
// The two portals are separate identities from the account (see portalAuth.js),
// so entering one from here means minting and storing ITS token — not reusing
// the account's.
import { saveAuth as savePortalAuth, clearAuth as clearPortalAuth } from "../portal/portalAuth.js";
import { saveAuth as saveAssessmentAuth, clearAuth as clearAssessmentAuth } from "../portal/assessmentAuth.js";
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

// Wrap / icon / text triples for the four urgency states. The text tones read
// from the verdict tokens rather than raw Tailwind hues, so this map and the
// Badge sitting next to it cannot describe the same state in two different
// colours — and the amber moves off 4.35:1, which was under AA at this size.
const TONE_STYLES = {
  red: {
    wrap: "border-red-200 bg-red-50",
    icon: "bg-verdict-negative-tint text-verdict-negative",
    text: "text-verdict-negative",
  },
  amber: {
    wrap: "border-amber-200 bg-amber-50",
    icon: "bg-verdict-pending-tint text-verdict-pending",
    text: "text-verdict-pending",
  },
  brand: {
    wrap: "border-brand-200 bg-brand-50",
    icon: "bg-brand-100 text-brand-700",
    text: "text-brand-700",
  },
  slate: {
    wrap: "border-slate-200 bg-slate-50",
    icon: "bg-slate-100 text-slate-600",
    text: "text-slate-600",
  },
};

// Inline text actions — "Mark as read", "Remove", "Save". They stay text, but
// they get a real hit area: 24px is the WCAG 2.2 AA target floor and
// `tap-target` lifts it to 44px on a thumb. The negative margin cancels the
// padding so nothing shifts optically, and the focus ring is added because a
// bare <button> here previously had no visible focus state of its own.
const INLINE_ACTION =
  "tap-target -m-1 inline-flex items-center gap-1 rounded-lg p-1 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2";

// Session statuses arrive as backend identifiers. Every other piece of stage
// copy on this page comes from pipeline.js; these were the one place a raw enum
// was reformatted into UI text, so a schema rename would have surfaced straight
// to the candidate. Unknown values still fall through to the old formatting
// rather than disappearing.
const SESSION_STATUS_LABELS = {
  pending: "Not started",
  scheduled: "Scheduled",
  in_progress: "In progress",
  completed: "Completed",
  submitted: "Submitted",
  expired: "Expired",
  cancelled: "Cancelled",
};

function sessionStatusLabel(status) {
  if (!status) return "Unknown";
  return SESSION_STATUS_LABELS[status] || String(status).replace(/_/g, " ");
}

// A progress bar is a measurement, so it names what it measures. Without the
// role and the value it is a styled empty div — and on an application card it
// is the only thing that says how far along the process actually is.
function ProgressBar({ value, label, className = "", trackClassName = "h-1.5" }) {
  const pct = Math.max(0, Math.min(100, Math.round(value || 0)));
  return (
    <div
      role="progressbar"
      aria-valuenow={pct}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
      className={`w-full overflow-hidden rounded-full bg-slate-100 ${trackClassName} ${className}`}
    >
      <div
        className="h-full rounded-full bg-brand-600 transition-[width] duration-500 ease-out motion-reduce:transition-none"
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

// The line that names who the step is waiting on. Every other candidate portal
// shows a status label with no owner, which is why "Under Review" tells you
// nothing — it is equally true on day 1 and day 60.
function OwnerLine({ action, now }) {
  if (action.owner === "candidate") {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-700">
        <UserRound className="h-3.5 w-3.5" aria-hidden="true" /> Waiting on you
      </span>
    );
  }
  if (action.owner === "company") {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500">
        <Hourglass className="h-3.5 w-3.5" aria-hidden="true" /> Waiting on the hiring team
        {action.since ? ` · for ${formatRelative(action.since, now).replace(" ago", "")}` : ""}
      </span>
    );
  }
  return null;
}

// Label for the button that enters a session. Naming the thing beats a generic
// "Open" — the candidate is deciding whether they have time for this right now.
function openLabel(action) {
  if (action.kind === "interview") return action.state === "in_progress" ? "Resume interview" : "Start interview";
  return action.state === "in_progress" ? "Resume assessment" : "Start assessment";
}

// One thing the candidate must do, with its real deadline and — while the
// window is open — the way in. The link itself is never displayed: only its
// hash is stored server-side, so it cannot be reproduced, and minting a new one
// would break the link already sitting in the candidate's inbox. The button
// instead exchanges the account session for this session's portal token.
function ActionRow({ action, jobTitle, companyName, now, onOpen, opening }) {
  const Icon = ACTION_ICONS[action.kind] || CircleDot;
  const tone = TONE_STYLES[actionTone(action, now)];
  const due = action.dueAt;

  return (
    // 16px is the container radius; 12px is the control radius. This panel is a
    // container, and at `rounded-xl` it read as an oversized button — see
    // DESIGN.md § The 12/16 Rule.
    <div className={`rounded-2xl border p-4 ${tone.wrap}`}>
      <div className="flex items-start gap-3">
        <span className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${tone.icon}`}>
          {action.state === "missed" ? (
            <AlertTriangle className="h-4.5 w-4.5" aria-hidden="true" />
          ) : (
            <Icon className="h-4.5 w-4.5" aria-hidden="true" />
          )}
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

          {action.canOpen && (
            <div className="mt-3">
              <Button size="sm" loading={opening} onClick={() => onOpen(action)}>
                {openLabel(action)} <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
              </Button>
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
          // `aria-current` is what tells a screen reader which of these steps is
          // the live one. The marker dot carries that visually and nothing else
          // did programmatically.
          <li key={stage} className="flex items-start gap-2.5" aria-current={current ? "step" : undefined}>
            <span
              aria-hidden="true"
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
              {/* Unreached steps were `slate-400` — 2.5:1 on white. They are
                  meant to read as quieter, not as unreadable. */}
              <p className={`text-xs ${current ? "font-semibold text-slate-900" : done ? "font-medium text-slate-600" : "text-slate-500"}`}>
                {STAGE_LABELS[stage] || stage}
                {current && <span className="sr-only"> (current step)</span>}
              </p>
              {dates[stage] && <p className="text-[11px] text-slate-500">{formatAbsolute(dates[stage])}</p>}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function ApplicationCard({ application, next, now, onOpen, openingId }) {
  const [open, setOpen] = useState(false);
  const trackId = useId();
  const { job, status, stageHistory = [], offer } = application;
  const rejected = isRejected(status);
  const pct = Math.round(stageProgress(status) * 100);
  const primary = next?.primary;

  return (
    // Container radius, not control radius — DESIGN.md § The 12/16 Rule.
    <div className="rounded-2xl border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-slate-900">{job?.title || "Application"}</p>
          <p className="truncate text-xs text-slate-500">{job?.company?.name}</p>
        </div>
        <Badge tone={stageTone(status)}>{stageLabel(status)}</Badge>
      </div>

      {!rejected && (
        <ProgressBar
          className="mt-3"
          value={pct}
          label={`${job?.title || "Application"}: ${stageLabel(status)}, ${pct}% through the process`}
        />
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

      {primary?.canOpen && (
        <div className="mt-3">
          <Button size="sm" loading={openingId === primary.sessionId} onClick={() => onOpen(primary)}>
            {openLabel(primary)} <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
          </Button>
        </div>
      )}

      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={trackId}
        className={`${INLINE_ACTION} mt-3 text-brand-700 hover:bg-brand-50 hover:underline focus-visible:ring-brand-300`}
      >
        <ChevronDown
          aria-hidden="true"
          className={`h-3.5 w-3.5 transition-transform duration-200 motion-reduce:transition-none ${open ? "rotate-180" : ""}`}
        />
        {open ? "Hide" : "Show"} full progress
      </button>

      <div id={trackId} hidden={!open}>
        {open && <StageTrack status={status} stageHistory={stageHistory} />}
      </div>
    </div>
  );
}

// --- page -------------------------------------------------------------------

// These cards are siblings of the "Needs you" panel, not children of it, so
// they sit at the same heading level. They were <h3> under an <h1>, which skips
// a level and leaves a screen-reader user's section list with a hole in it.
function SectionCard({ title, icon: Icon, children, action }) {
  return (
    <Card as="section">
      <div className="mb-4 flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-base font-semibold text-slate-900">
          <Icon className="h-4.5 w-4.5 text-brand-600" aria-hidden="true" /> {title}
        </h2>
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
  const [openingId, setOpeningId] = useState(null);
  const [openError, setOpenError] = useState("");

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

  // Enter this session's portal using the account as proof of ownership. The
  // server re-checks that this account's email owns the application and applies
  // the same expiry/cancellation rules the emailed link would, then returns the
  // portal's own short-lived token. The emailed link keeps working: nothing is
  // rotated here.
  //
  // The previous portal session is cleared first — the stored jobTitle/token may
  // belong to a different interview, and carrying it over would label this one
  // with the wrong job.
  async function openSession(action) {
    if (!action?.sessionId) return;
    setOpeningId(action.sessionId);
    setOpenError("");
    try {
      const res = await api.post(
        `/candidate-dashboard/sessions/${action.kind}/${action.sessionId}/open`,
        {},
        { headers: accountAuthHeader() }
      );
      const identity = {
        jwt: res.data.token,
        jobTitle: res.data.session?.jobTitle,
        candidateName: res.data.session?.candidateName,
      };
      if (action.kind === "interview") {
        clearPortalAuth();
        savePortalAuth(identity);
        navigate("/portal/dashboard");
      } else {
        clearAssessmentAuth();
        saveAssessmentAuth(identity);
        navigate("/assessment-portal/hub");
      }
    } catch (err) {
      // Includes the honest refusals — expired, cancelled — in the portal's own
      // words, so the dashboard never promises a way in that does not exist.
      setOpenError(err?.response?.data?.error || "We couldn't open that right now. Please try again shortly.");
      setOpeningId(null);
      await load();
    }
  }

  const applicationsById = useMemo(() => {
    const map = new Map();
    for (const a of data?.appliedJobs || []) map.set(String(a._id), a);
    return map;
  }, [data]);

  // Which sessions can be entered right now, keyed by session id. The server
  // decides this (canOpen) rather than the browser re-deriving it from status +
  // expiry — a device with a skewed clock must not be the thing that offers, or
  // withholds, a way into an interview.
  const openableSessions = useMemo(() => {
    const map = new Map();
    for (const entry of data?.nextActions || []) {
      for (const action of entry.actions || []) {
        if (action.canOpen && action.sessionId) map.set(String(action.sessionId), action);
      }
    }
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
        <Card role="alert" className="border-red-200 bg-red-50">
          <p className="flex items-start gap-2.5 text-sm font-semibold text-verdict-negative">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            {error}
          </p>
        </Card>
      </div>
    );
  }

  if (!data) {
    return (
      // The shape of the page that is about to arrive, not two generic blocks.
      // A skeleton that does not match what loads is just a second layout shift
      // wearing a loading costume.
      <div className="space-y-6" aria-busy="true">
        <p className="sr-only" role="status">
          Loading your dashboard…
        </p>

        <div className="space-y-2">
          <Skeleton className="h-8 w-52" />
          <Skeleton className="h-4 w-96 max-w-full" />
        </div>

        <Card>
          <Skeleton className="h-5 w-28" />
          <Skeleton className="mt-4 h-20 w-full rounded-2xl" />
          <Skeleton className="mt-3 h-20 w-full rounded-2xl" />
        </Card>

        <Card>
          <Skeleton className="h-5 w-40" />
          <div className="mt-4 grid gap-3 lg:grid-cols-2">
            <Skeleton className="h-28 w-full rounded-2xl" />
            <Skeleton className="h-28 w-full rounded-2xl" />
          </div>
        </Card>

        <div className="grid gap-6 lg:grid-cols-2">
          {["assessments", "interviews", "resume", "notifications"].map((key) => (
            <Card key={key}>
              <Skeleton className="h-5 w-36" />
              <Skeleton className="mt-4 h-16 w-full" />
            </Card>
          ))}
        </div>
      </div>
    );
  }

  const pct = data.profile.profileCompletionPercent;
  const activeApplications = data.appliedJobs.filter((a) => !isRejected(a.status));

  return (
    <div className="space-y-6">
      {/* Greeting band. The wash sits behind the title only — nothing on a
          tinted ground here is a status, a deadline, or a score. */}
      <header className="overflow-hidden rounded-2xl border border-brand-100 bg-aurora px-6 py-7 shadow-card">
        <h1 className="text-2xl font-bold text-slate-900">My Dashboard</h1>
        <p className="mt-1 max-w-prose text-sm text-slate-600">
          Every step shows who it's waiting on and when it closes — so nothing is a black box.
        </p>
      </header>

      {/* Session-open failures are raised here rather than inside the "Needs
          you" card. That card is one of four places a session can be opened
          from, and it is not rendered at all once nothing is owed — so the
          portal's honest refusal ("expired", "cancelled") had nowhere to land
          for the other three. `role="alert"` announces it wherever focus sits. */}
      {openError && (
        <div role="alert" className="rounded-2xl border border-red-200 bg-red-50 p-4">
          <p className="flex items-start gap-2.5 text-sm font-semibold text-verdict-negative">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            {openError}
          </p>
        </div>
      )}

      {/* An admin moving a stage arrives over the socket and re-renders the page
          silently. This line is the only thing that tells a screen-reader user
          the ground moved under them. */}
      <p className="sr-only" role="status">
        {needsYou.length > 0
          ? `${needsYou.length} ${needsYou.length === 1 ? "item needs" : "items need"} your attention.`
          : "Nothing needs you right now."}
      </p>

      {/* The hero. Only rendered when something is genuinely owed, so an empty
          state here is meaningful rather than decorative. */}
      {/* Brand tone on the card below, never ember or amber: this is the
          candidate's own to-do list, and the reserved pending channel means "a
          recruiter has not got to you yet". Those two must not look alike — one
          is work you can do now, the other is waiting you cannot affect. */}
      {needsYou.length > 0 ? (
        <Card as="section" tone="brand">
          <h2 className="mb-1 flex items-center gap-2 text-base font-semibold text-slate-900">
            <ListChecks className="h-4.5 w-4.5 text-brand-600" aria-hidden="true" /> Needs you
            <Badge tone="brand">{needsYou.length}</Badge>
          </h2>
          <p className="mb-4 text-xs text-slate-500">
            These are waiting on you. Deadlines are shown in your local time.
          </p>

          <div className="space-y-3">
            {needsYou.map(({ action, application }) => (
              <ActionRow
                key={`${action.kind}-${action.sessionId || application?._id}`}
                action={action}
                jobTitle={application?.job?.title}
                companyName={application?.job?.company?.name}
                now={now}
                onOpen={openSession}
                opening={openingId === action.sessionId}
              />
            ))}
          </div>
        </Card>
      ) : (
        data.appliedJobs.length > 0 && (
          <Card as="section" className="border-emerald-200 bg-emerald-50/50">
            <div className="flex items-start gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-verdict-positive-tint text-verdict-positive">
                <CircleCheck className="h-4.5 w-4.5" aria-hidden="true" />
              </span>
              <div>
                <h2 className="text-sm font-semibold text-slate-900">Nothing needs you right now</h2>
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
                onOpen={openSession}
                openingId={openingId}
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
                      {sessionStatusLabel(s.status)}
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
                    <p className="mt-1 text-xs text-slate-500">
                      Results are reviewed by the hiring team and aren't shown here.
                    </p>
                  )}
                  {openableSessions.has(String(s._id)) && (
                    <Button
                      size="sm"
                      className="mt-2"
                      loading={openingId === s._id}
                      onClick={() => openSession(openableSessions.get(String(s._id)))}
                    >
                      {openLabel(openableSessions.get(String(s._id)))} <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                    </Button>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-slate-500">No assessments yet.</p>
          )}
        </SectionCard>

        <SectionCard title="Interviews" icon={Video}>
          {data.upcomingInterviews.length === 0 && data.aiInterviewHistory.length === 0 ? (
            <p className="text-sm text-slate-500">No interviews scheduled yet.</p>
          ) : (
            <div className="space-y-3">
              {[...data.upcomingInterviews, ...data.aiInterviewHistory].map((s) => (
                <div key={s._id} className="rounded-lg bg-slate-50 p-3">
                  <div className="flex items-start justify-between gap-2">
                    <p className="min-w-0 truncate text-sm font-semibold text-slate-800">{s.job?.title}</p>
                    <Badge tone={s.status === "completed" ? "green" : s.status === "expired" ? "red" : "brand"}>
                      {sessionStatusLabel(s.status)}
                    </Badge>
                  </div>
                  <p className="mt-1 text-xs text-slate-500">{formatAbsolute(s.interviewAt)}</p>
                  {openableSessions.has(String(s._id)) && (
                    <Button
                      size="sm"
                      className="mt-2"
                      loading={openingId === s._id}
                      onClick={() => openSession(openableSessions.get(String(s._id)))}
                    >
                      {openLabel(openableSessions.get(String(s._id)))} <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                    </Button>
                  )}
                </div>
              ))}
            </div>
          )}
        </SectionCard>

        <SectionCard title="Resume" icon={FileText}>
          {data.resume.hasResume ? (
            // `break-words`: uploaded filenames are user-supplied and routinely
            // arrive as one 80-character unbroken string.
            <p className="text-sm break-words text-verdict-positive">
              Resume on file: {data.resume.latest.originalName}
            </p>
          ) : (
            <p className="text-sm text-slate-500">No resume uploaded yet.</p>
          )}
          <Link to="/resume">
            <Button variant="outline" size="sm" className="mt-3">
              Manage Resumes
            </Button>
          </Link>
        </SectionCard>

        <SectionCard title="Notifications" icon={Bell}>
          {data.notifications.length === 0 && <p className="text-sm text-slate-500">No notifications yet.</p>}
          <div className="space-y-3">
            {data.notifications.slice(0, 5).map((n) => (
              <div key={n._id} className="rounded-lg bg-slate-50 p-3">
                <p className="text-sm font-semibold text-slate-800">{n.title}</p>
                <p className="text-xs text-slate-500">{n.message}</p>
                {!n.read && (
                  <button
                    type="button"
                    onClick={() => markNotificationRead(n._id)}
                    className={`${INLINE_ACTION} mt-1 text-brand-700 hover:bg-brand-50 hover:underline focus-visible:ring-brand-300`}
                  >
                    Mark as read
                    {/* Three notifications in a row all offering "Mark as read"
                        is unnavigable by voice or by screen reader without this. */}
                    <span className="sr-only">: {n.title}</span>
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
            <p className="text-sm text-slate-500">No saved jobs yet.</p>
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
                  <button
                    type="button"
                    onClick={() => toggleSaveJob(job._id)}
                    className={`${INLINE_ACTION} shrink-0 text-red-600 hover:bg-red-50 hover:underline focus-visible:ring-red-300`}
                  >
                    Remove
                    <span className="sr-only"> {job.title} from saved jobs</span>
                  </button>
                </div>
              ))}
            </div>
          )}
        </SectionCard>

        <SectionCard title="Recommended Jobs" icon={Sparkles}>
          {data.recommendedJobs.length === 0 ? (
            <p className="text-sm text-slate-500">No recommendations yet — add skills to your profile to get matched.</p>
          ) : (
            <div className="space-y-2">
              {data.recommendedJobs.map((job) => (
                <div key={job._id} className="flex items-center justify-between rounded-lg bg-slate-50 p-3">
                  <div className="min-w-0">
                    <Link
                      to={`/jobs/${job.slug || job._id}`}
                      className="flex items-center gap-1 truncate text-sm font-semibold text-slate-800 hover:text-brand-700"
                    >
                      {job.title} <ExternalLink className="h-3 w-3 shrink-0" aria-hidden="true" />
                    </Link>
                    <p className="truncate text-xs text-slate-500">{job.company?.name}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => toggleSaveJob(job._id)}
                    className={`${INLINE_ACTION} shrink-0 text-brand-700 hover:bg-brand-50 hover:underline focus-visible:ring-brand-300`}
                  >
                    Save
                    <span className="sr-only"> {job.title}</span>
                  </button>
                </div>
              ))}
            </div>
          )}
        </SectionCard>
      </div>

      {/* Profile sits below the tracking work: it is useful, but it is the part
          every portal already has, and it is not why someone opens this page. */}
      <Card as="section">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-base font-semibold text-slate-900">
            <UserRound className="h-4.5 w-4.5 text-brand-600" aria-hidden="true" /> Your profile
          </h2>
          {/* The bar below announces the same number as its value, so this is a
              visual echo rather than a second thing to read out. */}
          <span aria-hidden="true" className="text-lg font-bold text-brand-700">
            {pct}%
          </span>
        </div>
        <ProgressBar className="mb-6" trackClassName="h-2.5" value={pct} label="Profile completeness" />
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
          <p className="text-sm text-slate-500">No past interviews yet.</p>
        ) : (
          <div className="space-y-3">
            {data.aiInterviewHistory.map((s) => (
              <div key={s._id} className="flex items-center justify-between gap-2 rounded-lg bg-slate-50 p-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-slate-800">{s.job?.title}</p>
                  <p className="truncate text-xs text-slate-500">{formatAbsolute(s.interviewAt)}</p>
                </div>
                <Badge tone={s.status === "completed" ? "green" : "slate"}>{sessionStatusLabel(s.status)}</Badge>
              </div>
            ))}
          </div>
        )}
      </SectionCard>
    </div>
  );
}
