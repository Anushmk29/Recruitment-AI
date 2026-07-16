import { useState } from "react";
import { Link, useNavigate, useLocation } from "react-router-dom";
import { LogIn, Sparkles } from "lucide-react";
import api from "../api/client.js";
import { saveAccountAuth } from "../auth/accountAuth.js";
import { getReturnTo, clearReturnTo } from "../auth/returnTo.js";
import { Card } from "../components/ui/Card.jsx";
import { Input, Label, FormGroup } from "../components/ui/Field.jsx";
import Button from "../components/ui/Button.jsx";

export default function Login() {
  const navigate = useNavigate();
  const location = useLocation();
  const [form, setForm] = useState({ email: "", password: "" });
  const [remember, setRemember] = useState(true);
  const [error, setError] = useState("");
  const [needsVerification, setNeedsVerification] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [resendSent, setResendSent] = useState(false);

  function update(field) {
    return (e) => setForm((f) => ({ ...f, [field]: e.target.value }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setNeedsVerification(false);
    setSubmitting(true);
    try {
      const res = await api.post("/auth/login", form);
      saveAccountAuth({ token: res.data.token, user: res.data.user, remember });
      const redirectTo = location.state?.from || getReturnTo() || "/dashboard";
      clearReturnTo();
      navigate(redirectTo, { replace: true });
    } catch (err) {
      if (err.response?.data?.code === "EMAIL_NOT_VERIFIED") {
        setNeedsVerification(true);
      }
      setError(err.response?.data?.error || "Could not log in");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleResend() {
    try {
      await api.post("/auth/resend-verification", { email: form.email });
      setResendSent(true);
    } catch {
      setResendSent(true);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-5 py-12">
      <div className="w-full max-w-md">
        <div className="mb-8 flex flex-col items-center text-center">
          <Link to="/welcome" className="mb-4 flex items-center gap-2 font-display text-lg font-bold text-slate-900">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-600 text-white">
              <Sparkles className="h-4.5 w-4.5" />
            </span>
            HireFlow <span className="text-brand-600">AI</span>
          </Link>
          <h1 className="text-2xl font-bold text-slate-900">Welcome back</h1>
          <p className="mt-1 text-sm text-slate-500">Log in to track your applications and interviews</p>
        </div>

        <Card>
          <form onSubmit={handleSubmit}>
            {error && (
              <p className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm font-medium text-red-700">{error}</p>
            )}
            {needsVerification && (
              <p className="mb-4 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
                {resendSent ? (
                  "A new verification link has been sent if that account exists."
                ) : (
                  <button type="button" className="font-semibold underline" onClick={handleResend}>
                    Resend verification email
                  </button>
                )}
              </p>
            )}
            <FormGroup>
              <Label required>Email</Label>
              <Input type="email" value={form.email} onChange={update("email")} required />
            </FormGroup>
            <FormGroup>
              <Label required>Password</Label>
              <Input type="password" value={form.password} onChange={update("password")} required />
            </FormGroup>
            <label className="mb-5 flex items-center gap-2 text-sm text-slate-600">
              <input
                type="checkbox"
                checked={remember}
                onChange={(e) => setRemember(e.target.checked)}
                className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-400"
              />
              Remember me
            </label>
            <Button type="submit" size="lg" loading={submitting} className="w-full">
              <LogIn className="h-4 w-4" /> Log In
            </Button>
          </form>
          <p className="mt-5 text-center text-sm text-slate-500">
            <Link to="/forgot-password" className="font-semibold text-brand-700 hover:underline">
              Forgot your password?
            </Link>
          </p>
        </Card>

        <p className="mt-6 text-center text-sm text-slate-500">
          Don't have an account?{" "}
          <Link to="/register" className="font-semibold text-brand-700 hover:underline">
            Create one
          </Link>
        </p>
      </div>
    </div>
  );
}
