import { useState } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { KeyRound, CheckCircle2 } from "lucide-react";
import api from "../api/client.js";
import { Card } from "../components/ui/Card.jsx";
import { Input, Label, FormGroup } from "../components/ui/Field.jsx";
import Button from "../components/ui/Button.jsx";

export default function ResetPassword() {
  const { token } = useParams();
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      await api.post("/auth/reset-password", { token, password });
      setDone(true);
      setTimeout(() => navigate("/login", { replace: true }), 2000);
    } catch (err) {
      setError(err.response?.data?.error || "Could not reset your password");
    } finally {
      setSubmitting(false);
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
              <h1 className="text-lg font-semibold text-slate-900">Password Reset</h1>
              <p className="mt-2 text-sm text-slate-500">
                Your password has been reset. Redirecting you to <Link to="/login" className="font-semibold text-brand-700">login</Link>…
              </p>
            </>
          ) : (
            <>
              <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-brand-100 text-brand-600">
                <KeyRound className="h-6 w-6" />
              </div>
              <h1 className="text-lg font-semibold text-slate-900">Choose a New Password</h1>
              <form onSubmit={handleSubmit} className="mt-5 text-left">
                {error && (
                  <p className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm font-medium text-red-700">{error}</p>
                )}
                <FormGroup>
                  <Label required>New Password</Label>
                  <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} minLength={8} required />
                </FormGroup>
                <Button type="submit" loading={submitting} className="w-full">
                  Reset Password
                </Button>
              </form>
            </>
          )}
        </Card>
      </div>
    </div>
  );
}
