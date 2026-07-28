import { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { Laptop, CheckCircle2 } from "lucide-react";
import api from "../api/client.js";
import { getAuth, saveAuth, clearAuth, authHeader } from "../portal/portalAuth.js";
import { Card, Badge, Skeleton } from "../components/ui/Card.jsx";
import Button from "../components/ui/Button.jsx";

const STATUS_LABEL = {
  scheduled: "Ready to start",
  in_progress: "In progress",
  completed: "Completed",
  expired: "Link expired",
  cancelled: "Cancelled",
};

const STATUS_TONE = {
  scheduled: "brand",
  in_progress: "green",
  completed: "green",
  expired: "slate",
  cancelled: "red",
};

export default function InterviewDashboard() {
  const navigate = useNavigate();
  const [session, setSession] = useState(null);
  const [error, setError] = useState("");

  const loadSession = useCallback(async () => {
    if (!getAuth()?.jwt) {
      setError("no-auth");
      return;
    }
    try {
      const res = await api.get("/interview-portal/me", { headers: authHeader() });
      setSession(res.data);
      // Keep the shell's cached job/candidate context fresh for the pre-check and interview
      // screens, which have no shell-level fetch of their own for this.
      saveAuth({ jobTitle: res.data.jobTitle, candidateName: res.data.candidateName });
    } catch (err) {
      clearAuth();
      setError(err.response?.data?.error || "Your session has expired. Please use your interview link again.");
    }
  }, []);

  useEffect(() => {
    loadSession();
  }, [loadSession]);

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

  const expiresAt = session.expiresAt ? new Date(session.expiresAt) : null;

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
          {["scheduled", "in_progress"].includes(session.status) && expiresAt && (
            <p className="text-slate-600">
              <span className="font-semibold text-slate-800">Take it when you're ready</span> — your link works any time
              before <span className="font-semibold text-slate-800">{expiresAt.toLocaleString()}</span>.
            </p>
          )}
          <p className="flex items-center gap-2 text-slate-600">
            <Laptop className="h-4 w-4 shrink-0 text-slate-400" />
            Use a laptop or desktop with a camera and microphone — the interview can't run on most phones.
          </p>
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
            <div className="space-y-3">
              <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-700">
                Your interview is underway — you can pick up right where you left off.
              </p>
              <Button onClick={() => navigate("/portal/interview")}>Continue Interview</Button>
            </div>
          )}
          {session.status === "completed" && (
            <div className="rounded-lg bg-emerald-50 px-3 py-3 text-sm text-emerald-800">
              <p className="flex items-center gap-1.5 font-semibold">
                <CheckCircle2 className="h-4 w-4" /> Interview completed — thank you!
              </p>
              <p className="mt-1">
                Your responses have been recorded and sent to the hiring team for review. You'll hear about the outcome
                by email; you can also track your application from your candidate dashboard.
              </p>
            </div>
          )}
          {(session.status === "expired" || session.status === "cancelled") && (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-sm font-medium text-red-700">
              {session.status === "expired"
                ? "This interview link has expired. If you still need to take (or finish) the interview, reply to your invitation email and the hiring team can send you a fresh link."
                : "This interview has been cancelled. If you believe this is a mistake, reply to your invitation email to reach the hiring team."}
            </p>
          )}
        </div>
      </Card>
    </div>
  );
}
