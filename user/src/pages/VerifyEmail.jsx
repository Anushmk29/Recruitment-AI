import { useEffect, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { motion } from "framer-motion";
import { Loader2, CheckCircle2, XCircle } from "lucide-react";
import api from "../api/client.js";
import { saveAccountAuth } from "../auth/accountAuth.js";
import { getReturnTo, clearReturnTo } from "../auth/returnTo.js";
import { Card } from "../components/ui/Card.jsx";
import Button from "../components/ui/Button.jsx";

export default function VerifyEmail() {
  const { token } = useParams();
  const navigate = useNavigate();
  const [status, setStatus] = useState("verifying");
  const [error, setError] = useState("");
  const destination = getReturnTo() || "/dashboard";

  useEffect(() => {
    let cancelled = false;

    async function verify() {
      try {
        const res = await api.post("/auth/verify-email", { token });
        if (cancelled) return;
        saveAccountAuth({ token: res.data.token, refreshToken: res.data.refreshToken, user: res.data.user });
        setStatus("done");
      } catch (err) {
        if (cancelled) return;
        setError(err.response?.data?.error || "This verification link is invalid or has expired.");
        setStatus("failed");
      }
    }

    verify();
    return () => {
      cancelled = true;
    };
  }, [token]);

  useEffect(() => {
    if (status !== "done") return;
    const timer = setTimeout(() => {
      clearReturnTo();
      navigate(destination, { replace: true });
    }, 1500);
    return () => clearTimeout(timer);
  }, [status, destination, navigate]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-5 py-12">
      <div className="w-full max-w-md">
        <Card className="text-center">
          {status === "verifying" && (
            <>
              <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-brand-100 text-brand-600">
                <Loader2 className="h-6 w-6 animate-spin" />
              </div>
              <h1 className="text-lg font-semibold text-slate-900">Verifying Your Email</h1>
              <p className="mt-2 text-sm text-slate-500">Please wait…</p>
            </>
          )}

          {status === "failed" && (
            <>
              <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-red-100 text-red-600">
                <XCircle className="h-6 w-6" />
              </div>
              <h1 className="text-lg font-semibold text-slate-900">Verification Failed</h1>
              <p className="mt-2 text-sm text-slate-500">{error}</p>
              <p className="mt-4 text-sm">
                <Link to="/login" className="font-semibold text-brand-700 hover:underline">
                  Request a new link from login
                </Link>
              </p>
            </>
          )}

          {status === "done" && (
            <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }}>
              <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-emerald-100 text-emerald-600">
                <CheckCircle2 className="h-7 w-7" />
              </div>
              <h1 className="text-lg font-semibold text-slate-900">Email Verified</h1>
              <p className="mt-2 text-sm text-slate-500">
                Your email has been verified and you're now logged in. Redirecting you back…
              </p>
              <Button
                onClick={() => {
                  clearReturnTo();
                  navigate(destination, { replace: true });
                }}
                className="mt-5 w-full"
              >
                Continue
              </Button>
            </motion.div>
          )}
        </Card>
      </div>
    </div>
  );
}
