import { useEffect, useState, useCallback } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  FileText,
  Bell,
  CalendarClock,
  History,
  Briefcase,
  Bookmark,
  Sparkles,
  ExternalLink,
  ListChecks,
  Clock,
} from "lucide-react";
import api from "../api/client.js";
import { accountAuthHeader, clearAccountAuth } from "../auth/accountAuth.js";
import { getSocket } from "../lib/socket.js";
import { Card, Badge, Skeleton, EmptyState } from "../components/ui/Card.jsx";
import { Input, Textarea, Label, FormGroup } from "../components/ui/Field.jsx";
import Button from "../components/ui/Button.jsx";
import { stageLabel, stageTone, stageProgress, isRejected } from "../lib/pipeline.js";

function SectionCard({ title, icon: Icon, children }) {
  return (
    <Card>
      <h3 className="mb-4 flex items-center gap-2 text-base font-semibold text-slate-900">
        <Icon className="h-4.5 w-4.5 text-brand-600" /> {title}
      </h3>
      {children}
    </Card>
  );
}

function formatWhen(value) {
  if (!value) return "";
  return new Date(value).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

// One card per application: current stage, a progress bar, and a compact
// timeline of the most recent stage changes.
function ApplicationStatus({ application }) {
  const { job, status, stageHistory = [], offer } = application;
  const rejected = isRejected(status);
  const pct = Math.round(stageProgress(status) * 100);
  const recent = [...stageHistory].reverse().slice(0, 4);

  return (
    <div className="rounded-xl border border-slate-100 bg-slate-50 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-slate-800">{job?.title || "Application"}</p>
          <p className="truncate text-xs text-slate-500">{job?.company?.name}</p>
        </div>
        <Badge tone={stageTone(status)}>{stageLabel(status)}</Badge>
      </div>

      {!rejected && (
        <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-slate-200">
          <div className="h-full rounded-full bg-brand-600 transition-all" style={{ width: `${pct}%` }} />
        </div>
      )}

      {offer?.status && offer.status !== "none" && (
        <p className="mt-2 text-xs font-medium text-amber-700">
          Offer {offer.status}
          {offer.sentAt ? ` · sent ${formatWhen(offer.sentAt)}` : ""}
        </p>
      )}

      {recent.length > 0 && (
        <ul className="mt-3 space-y-1.5">
          {recent.map((h, i) => (
            <li key={i} className="flex items-center gap-2 text-xs text-slate-500">
              <Clock className="h-3 w-3 shrink-0 text-slate-400" />
              <span className="font-medium text-slate-600">{stageLabel(h.stage)}</span>
              <span className="text-slate-400">{formatWhen(h.at)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function CandidateDashboard() {
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [profileForm, setProfileForm] = useState({ headline: "", location: "", bio: "", skills: "" });
  const [savingProfile, setSavingProfile] = useState(false);

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

  // Live-refresh the dashboard when an admin moves this candidate's stage — no
  // page refresh required (Module 11 realtime requirement).
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

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-slate-900">My Dashboard</h1>

      <Card>
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-base font-semibold text-slate-900">Profile Completion</h3>
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

      <SectionCard title="Application Status" icon={ListChecks}>
        {data.appliedJobs.length === 0 ? (
          <EmptyState
            icon={ListChecks}
            title="No applications yet"
            description="Apply to a job and you'll be able to track its progress here in real time."
          />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {data.appliedJobs.map((application) => (
              <ApplicationStatus key={application._id} application={application} />
            ))}
          </div>
        )}
      </SectionCard>

      <div className="grid gap-6 lg:grid-cols-2">
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

        <SectionCard title="Upcoming Interviews" icon={CalendarClock}>
          {data.upcomingInterviews.length === 0 ? (
            <EmptyState icon={CalendarClock} title="No interviews scheduled" description="Passing ATS screening on a job will schedule one automatically." />
          ) : (
            <div className="space-y-3">
              {data.upcomingInterviews.map((s) => (
                <div key={s._id} className="rounded-lg bg-slate-50 p-3">
                  <p className="text-sm font-semibold text-slate-800">{s.job?.title}</p>
                  <p className="text-xs text-slate-500">
                    {new Date(s.interviewAt).toLocaleString()} · <Badge tone="brand">{s.status}</Badge>
                  </p>
                </div>
              ))}
            </div>
          )}
        </SectionCard>

        <SectionCard title="AI Interview History" icon={History}>
          {data.aiInterviewHistory.length === 0 ? (
            <p className="text-sm text-slate-400">No past interviews yet.</p>
          ) : (
            <div className="space-y-3">
              {data.aiInterviewHistory.map((s) => (
                <div key={s._id} className="rounded-lg bg-slate-50 p-3">
                  <p className="text-sm font-semibold text-slate-800">{s.job?.title}</p>
                  <p className="text-xs text-slate-500">
                    {new Date(s.interviewAt).toLocaleString()} · <Badge>{s.status}</Badge>
                  </p>
                </div>
              ))}
            </div>
          )}
        </SectionCard>

        <SectionCard title="Applied Jobs" icon={Briefcase}>
          {data.appliedJobs.length === 0 ? (
            <p className="text-sm text-slate-400">You haven't applied to any jobs yet.</p>
          ) : (
            <div className="space-y-3">
              {data.appliedJobs.map((c) => (
                <div key={c._id} className="flex items-center justify-between gap-2 rounded-lg bg-slate-50 p-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-slate-800">{c.job?.title}</p>
                    <p className="truncate text-xs text-slate-500">{c.job?.company?.name}</p>
                  </div>
                  <Badge tone={stageTone(c.status)}>{stageLabel(c.status)}</Badge>
                </div>
              ))}
            </div>
          )}
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
      </div>

      <SectionCard title="Recommended Jobs" icon={Sparkles}>
        {data.recommendedJobs.length === 0 ? (
          <p className="text-sm text-slate-400">No recommendations yet — add skills to your profile to get matched.</p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {data.recommendedJobs.map((job) => (
              <div key={job._id} className="flex items-center justify-between rounded-lg bg-slate-50 p-3">
                <div className="min-w-0">
                  <Link to={`/jobs/${job.slug || job._id}`} className="flex items-center gap-1 truncate text-sm font-semibold text-slate-800 hover:text-brand-700">
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
  );
}
