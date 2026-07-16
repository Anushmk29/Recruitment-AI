import { useState } from "react";
import { Link } from "react-router-dom";
import { MailQuestion, CheckCircle2 } from "lucide-react";
import api from "../api/client.js";
import { Card } from "../components/ui/Card.jsx";
import { Input, Label, FormGroup } from "../components/ui/Field.jsx";
import Button from "../components/ui/Button.jsx";

export default function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setSubmitting(true);
    try {
      await api.post("/auth/forgot-password", { email });
    } finally {
      setSubmitting(false);
      setDone(true);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-5 py-12">
      <div className="w-full max-w-md">
        <Card className="text-center">
          {done ? (
            <>
              <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100 text-emerald-600">
                <CheckCircle2 className="h-6 w-6" />
              </div>
              <h1 className="text-lg font-semibold text-slate-900">Check Your Email</h1>
              <p className="mt-2 text-sm text-slate-500">If an account exists for that email, a password reset link has been sent.</p>
              <Link to="/login" className="mt-5 inline-block text-sm font-semibold text-brand-700 hover:underline">
                Back to login
              </Link>
            </>
          ) : (
            <>
              <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-brand-100 text-brand-600">
                <MailQuestion className="h-6 w-6" />
              </div>
              <h1 className="text-lg font-semibold text-slate-900">Forgot Password</h1>
              <p className="mt-2 text-sm text-slate-500">We'll email you a link to reset it.</p>
              <form onSubmit={handleSubmit} className="mt-5 text-left">
                <FormGroup>
                  <Label required>Email</Label>
                  <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
                </FormGroup>
                <Button type="submit" loading={submitting} className="w-full">
                  Send Reset Link
                </Button>
              </form>
              <Link to="/login" className="mt-5 inline-block text-sm font-semibold text-brand-700 hover:underline">
                Back to login
              </Link>
            </>
          )}
        </Card>
      </div>
    </div>
  );
}
