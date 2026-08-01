import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Loader2, AlertTriangle } from "lucide-react";
import api from "../api/client.js";
import { saveAuth } from "../portal/scorecardAuth.js";
import { Card } from "../components/ui/Card.jsx";

// Magic-link exchange for the interviewer scorecard (mirrors AssessmentLogin).
// The panelist has no account by design, so this is the whole of "signing in".
export default function ScorecardLogin() {
  const { token } = useParams();
  const navigate = useNavigate();
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function login() {
      try {
        const res = await api.post("/scorecard-portal/login", { token });
        if (cancelled) return;
        saveAuth({ jwt: res.data.token, stage: res.data.stage, interviewerName: res.data.interviewerName });
        navigate("/scorecard-portal/form", { replace: true });
      } catch (err) {
        if (cancelled) return;
        setError(err.response?.data?.error || "This scorecard link is invalid or has expired.");
      }
    }

    login();
    return () => {
      cancelled = true;
    };
  }, [token, navigate]);

  if (error) {
    return (
      <div className="mx-auto max-w-lg px-5 py-16">
        <Card className="text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-red-100 text-red-600">
            <AlertTriangle className="h-6 w-6" />
          </div>
          <h1 className="text-lg font-semibold text-slate-900">Scorecard link problem</h1>
          <p className="mt-2 text-sm font-medium text-red-600">{error}</p>
          <p className="mt-3 text-sm text-slate-500">
            Check the link in your invitation email, or ask the recruiting team to re-send it.
          </p>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-lg px-5 py-16">
      <Card className="text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-brand-100 text-brand-600">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
        <h1 className="text-lg font-semibold text-slate-900">Opening your scorecard…</h1>
      </Card>
    </div>
  );
}
