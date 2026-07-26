import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Loader2, AlertTriangle } from "lucide-react";
import api from "../api/client.js";
import { saveAuth } from "../portal/portalAuth.js";
import { Card } from "../components/ui/Card.jsx";

export default function InterviewLogin() {
  const { token } = useParams();
  const navigate = useNavigate();
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function login() {
      try {
        const res = await api.post("/interview-portal/login", { token });
        if (cancelled) return;
        saveAuth({
          jwt: res.data.token,
          rawToken: token,
          jobTitle: res.data.session?.jobTitle,
          candidateName: res.data.session?.candidateName,
        });
        navigate("/portal/dashboard", { replace: true });
      } catch (err) {
        if (cancelled) return;
        setError(err.response?.data?.error || "This interview link is invalid or has expired.");
      }
    }

    login();
    return () => {
      cancelled = true;
    };
  }, [token, navigate]);

  if (error) {
    return (
      <Card className="text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-red-100 text-red-600">
          <AlertTriangle className="h-6 w-6" />
        </div>
        <h1 className="text-lg font-semibold text-slate-900">Interview Link Problem</h1>
        <p className="mt-2 text-sm font-medium text-red-600">{error}</p>
        <p className="mt-3 text-sm text-slate-500">
          Please check the link in your invitation email, or contact the recruitment team if you believe this is a mistake.
        </p>
      </Card>
    );
  }

  return (
    <Card className="text-center">
      <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-brand-100 text-brand-600">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
      <h1 className="text-lg font-semibold text-slate-900">Signing you in…</h1>
      <p className="mt-2 text-sm text-slate-500">Please wait while we verify your interview link.</p>
    </Card>
  );
}
