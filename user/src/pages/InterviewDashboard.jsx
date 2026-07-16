import { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { Clock3, Link2, Copy, Check } from "lucide-react";
import api from "../api/client.js";
import { getAuth, clearAuth, authHeader, getInterviewLink } from "../portal/portalAuth.js";
import { Card, Badge, Skeleton } from "../components/ui/Card.jsx";
import Button from "../components/ui/Button.jsx";

const STATUS_LABEL = {
  scheduled: "Scheduled",
  in_progress: "In Progress",
  expired: "Expired",
  cancelled: "Cancelled",
};

const STATUS_TONE = {
  scheduled: "brand",
  in_progress: "green",
  expired: "slate",
  cancelled: "red",
};

function formatCountdown(ms) {
  if (ms <= 0) return "Interview time has arrived";
  const totalSeconds = Math.floor(ms / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const parts = [];
  if (days) parts.push(`${days}d`);
  parts.push(`${String(hours).padStart(2, "0")}h`);
  parts.push(`${String(minutes).padStart(2, "0")}m`);
  parts.push(`${String(seconds).padStart(2, "0")}s`);
  return parts.join(" ");
}

export default function InterviewDashboard() {
  const navigate = useNavigate();
  const [session, setSession] = useState(null);
  const [error, setError] = useState("");
  const [now, setNow] = useState(Date.now());
  const [copied, setCopied] = useState(false);

  const loadSession = useCallback(async () => {
    if (!getAuth()?.jwt) {
      setError("no-auth");
      return;
    }
    try {
      const res = await api.get("/interview-portal/me", { headers: authHeader() });
      setSession(res.data);
    } catch (err) {
      clearAuth();
      setError(err.response?.data?.error || "Your session has expired. Please use your interview link again.");
    }
  }, []);

  useEffect(() => {
    loadSession();
  }, [loadSession]);

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);

  function copyLink() {
    navigator.clipboard.writeText(getInterviewLink());
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  if (error === "no-auth") {
    return (
      <Card>
        <h1 className="text-xl font-bold text-slate-900">Interview Dashboard</h1>
        <p className="mt-2 text-sm text-slate-500">
          Please open the interview link from your invitation email to access your dashboard.
        </p>
      </Card>
    );
  }

  if (error) {
    return (
      <Card>
        <h1 className="text-xl font-bold text-slate-900">Interview Dashboard</h1>
        <p className="mt-2 text-sm font-medium text-red-600">{error}</p>
      </Card>
    );
  }

  if (!session) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-6 w-40" />
        <Card><Skeleton className="h-40 w-full" /></Card>
      </div>
    );
  }

  const interviewAt = new Date(session.interviewAt);
  const countdownMs = interviewAt.getTime() - now;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-slate-900">Interview Dashboard</h1>
      <Card>
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold text-slate-900">{session.jobTitle}</h3>
            {session.department && <p className="text-sm text-slate-500">{session.department}</p>}
          </div>
          <Badge tone={STATUS_TONE[session.status] || "slate"}>{STATUS_LABEL[session.status] || session.status}</Badge>
        </div>

        <div className="grid gap-3 border-t border-slate-100 pt-4 text-sm">
          <p className="text-slate-600">
            <span className="font-semibold text-slate-800">Interview Date &amp; Time:</span> {interviewAt.toLocaleString()}
          </p>
          {session.status === "scheduled" && (
            <p className="flex items-center gap-2 font-semibold text-brand-700">
              <Clock3 className="h-4 w-4" /> {formatCountdown(countdownMs)}
            </p>
          )}
          <div className="flex items-center gap-2 text-slate-600">
            <Link2 className="h-4 w-4 shrink-0 text-slate-400" />
            <span className="min-w-0 break-all">{getInterviewLink()}</span>
            <button
              type="button"
              onClick={copyLink}
              className="ml-auto flex shrink-0 items-center gap-1 rounded-lg bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-200"
            >
              {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
          {session.instructions && (
            <p className="text-slate-600">
              <span className="font-semibold text-slate-800">Instructions:</span> {session.instructions}
            </p>
          )}
        </div>

        <div className="mt-5">
          {session.status === "scheduled" && (
            <Button onClick={() => navigate("/portal/pre-check")}>Start Interview</Button>
          )}
          {session.status === "in_progress" && (
            <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-700">
              Your pre-interview checks are complete. The interview will begin shortly.
            </p>
          )}
          {(session.status === "expired" || session.status === "cancelled") && (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-sm font-medium text-red-700">
              This interview is no longer accessible.
            </p>
          )}
        </div>
      </Card>
    </div>
  );
}
