import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate, Link } from "react-router-dom";
import { motion } from "framer-motion";
import { CheckCircle2, MailCheck, RotateCw } from "lucide-react";
import api from "../api/client.js";
import { saveAdminAuth } from "../auth/adminAuth.js";
import { useToast } from "../components/ui/Toast.jsx";
import MarketingNavbar from "../components/marketing/MarketingNavbar.jsx";
import OnboardingSteps from "../components/marketing/OnboardingSteps.jsx";
import { Card } from "../components/ui/Card.jsx";
import { Input, Label, FormGroup } from "../components/ui/Field.jsx";
import Button from "../components/ui/Button.jsx";

const RESEND_COOLDOWN = 45;

export default function VerifyCompanyOtp() {
  const location = useLocation();
  const navigate = useNavigate();
  const toast = useToast();
  const [email, setEmail] = useState(location.state?.email || "");
  const [digits, setDigits] = useState(Array(6).fill(""));
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [resending, setResending] = useState(false);
  const [cooldown, setCooldown] = useState(RESEND_COOLDOWN);
  const [verified, setVerified] = useState(false);
  const inputsRef = useRef([]);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setInterval(() => setCooldown((c) => c - 1), 1000);
    return () => clearInterval(timer);
  }, [cooldown]);

  function handleDigitChange(index, value) {
    const clean = value.replace(/\D/g, "").slice(-1);
    setDigits((d) => {
      const next = [...d];
      next[index] = clean;
      return next;
    });
    if (clean && index < 5) inputsRef.current[index + 1]?.focus();
  }

  function handleKeyDown(index, e) {
    if (e.key === "Backspace" && !digits[index] && index > 0) {
      inputsRef.current[index - 1]?.focus();
    }
  }

  function handlePaste(e) {
    const pasted = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, 6);
    if (!pasted) return;
    e.preventDefault();
    setDigits(Array.from({ length: 6 }, (_, i) => pasted[i] || ""));
    inputsRef.current[Math.min(pasted.length, 5)]?.focus();
  }

  async function handleSubmit(e) {
    e.preventDefault();
    const otp = digits.join("");
    if (otp.length !== 6) {
      setError("Enter the full 6-digit code");
      return;
    }
    setError("");
    setSubmitting(true);
    try {
      const res = await api.post("/companies/verify-otp", { email, otp });
      saveAdminAuth({ token: res.data.token, user: null });
      setVerified(true);
      setTimeout(() => navigate("/pricing", { replace: true }), 1100);
    } catch (err) {
      setError(err.response?.data?.error || "Could not verify code");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleResend() {
    setResending(true);
    try {
      await api.post("/companies/resend-otp", { email });
      toast.success("A new code has been sent to your email.");
      setCooldown(RESEND_COOLDOWN);
    } catch (err) {
      toast.error(err.response?.data?.error || "Could not resend code");
    } finally {
      setResending(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <MarketingNavbar />
      <div className="mx-auto max-w-md px-5 py-14 sm:px-8">
        <OnboardingSteps current={3} />

        <Card>
          {verified ? (
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              className="flex flex-col items-center py-6 text-center"
            >
              <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-emerald-100 text-emerald-600">
                <CheckCircle2 className="h-7 w-7" />
              </div>
              <h3 className="text-lg font-semibold text-slate-900">Email verified</h3>
              <p className="mt-1.5 text-sm text-slate-500">Taking you to plans…</p>
            </motion.div>
          ) : (
            <>
              <div className="mb-6 text-center">
                <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-brand-100 text-brand-600">
                  <MailCheck className="h-5.5 w-5.5" />
                </div>
                <h1 className="text-xl font-bold text-slate-900">Verify Your Email</h1>
                <p className="mt-1.5 text-sm text-slate-500">
                  Enter the 6-digit code we sent to your admin email address.
                </p>
              </div>

              <form onSubmit={handleSubmit}>
                {error && (
                  <p className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm font-medium text-red-700">{error}</p>
                )}
                <FormGroup>
                  <Label required>Email</Label>
                  <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
                </FormGroup>
                <FormGroup>
                  <Label required>Verification Code</Label>
                  <div className="flex justify-between gap-2" onPaste={handlePaste}>
                    {digits.map((d, i) => (
                      <input
                        key={i}
                        ref={(el) => (inputsRef.current[i] = el)}
                        value={d}
                        onChange={(e) => handleDigitChange(i, e.target.value)}
                        onKeyDown={(e) => handleKeyDown(i, e)}
                        inputMode="numeric"
                        maxLength={1}
                        className="h-12 w-11 rounded-xl border border-slate-300 text-center text-lg font-bold text-slate-900 shadow-sm focus:border-brand-500 focus:outline-none focus:ring-4 focus:ring-brand-100 sm:w-12"
                      />
                    ))}
                  </div>
                </FormGroup>
                <Button type="submit" size="lg" loading={submitting} className="w-full">
                  Verify Code
                </Button>
              </form>

              <div className="mt-5 text-center text-sm">
                {cooldown > 0 ? (
                  <span className="text-slate-500">Resend code in {cooldown}s</span>
                ) : (
                  <button
                    type="button"
                    onClick={handleResend}
                    disabled={resending}
                    className="inline-flex items-center gap-1.5 font-semibold text-brand-700 hover:underline disabled:opacity-50"
                  >
                    <RotateCw className={`h-3.5 w-3.5 ${resending ? "animate-spin" : ""}`} />
                    {resending ? "Resending…" : "Resend code"}
                  </button>
                )}
              </div>
              <p className="mt-4 text-center text-sm text-slate-500">
                <Link to="/login" className="hover:underline">
                  Back to login
                </Link>
              </p>
            </>
          )}
        </Card>
      </div>
    </div>
  );
}
