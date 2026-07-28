import { useState } from "react";
import { Link } from "react-router-dom";
import { UserPlus, Sparkles, MailCheck } from "lucide-react";
import api from "../api/client.js";
import { Card } from "../components/ui/Card.jsx";
import { Input, Label, FormGroup } from "../components/ui/Field.jsx";
import Button from "../components/ui/Button.jsx";

export default function Register() {
  const [form, setForm] = useState({ name: "", email: "", phone: "", password: "" });
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  function update(field) {
    return (e) => setForm((f) => ({ ...f, [field]: e.target.value }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      await api.post("/auth/register", form);
      setDone(true);
    } catch (err) {
      setError(err.response?.data?.error || "Could not create your account");
    } finally {
      setSubmitting(false);
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
          <h1 className="text-2xl font-bold text-slate-900">Create Your Account</h1>
          <p className="mt-1 text-sm text-slate-500">Start applying to AI-screened jobs in minutes</p>
        </div>

        <Card>
          {done ? (
            <div className="flex flex-col items-center py-4 text-center">
              <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100 text-emerald-600">
                <MailCheck className="h-6 w-6" />
              </div>
              <h3 className="text-lg font-semibold text-slate-900">Account Created</h3>
              <p className="mt-2 text-sm text-slate-500">
                Your account is ready — {" "}
                <Link to="/login" className="font-semibold text-brand-700 hover:underline">log in</Link> to
                continue.
              </p>
            </div>
          ) : (
            <form onSubmit={handleSubmit}>
              {error && (
                <p className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm font-medium text-red-700">{error}</p>
              )}
              <FormGroup>
                <Label required>Full Name</Label>
                <Input value={form.name} onChange={update("name")} required />
              </FormGroup>
              <FormGroup>
                <Label required>Email</Label>
                <Input type="email" value={form.email} onChange={update("email")} required />
              </FormGroup>
              <FormGroup>
                <Label required>Phone Number</Label>
                <Input type="tel" value={form.phone} onChange={update("phone")} placeholder="+91 98765 43210" required />
              </FormGroup>
              <FormGroup>
                <Label required>Password</Label>
                <Input type="password" value={form.password} onChange={update("password")} minLength={8} required />
              </FormGroup>
              <p className="mb-5 text-xs text-slate-500">
                At least 8 characters, with an uppercase letter, a lowercase letter, a number, and a special character.
              </p>
              <Button type="submit" size="lg" loading={submitting} className="w-full">
                <UserPlus className="h-4 w-4" /> Create Account
              </Button>
            </form>
          )}
        </Card>

        {!done && (
          <p className="mt-6 text-center text-sm text-slate-500">
            Already have an account?{" "}
            <Link to="/login" className="font-semibold text-brand-700 hover:underline">
              Log in
            </Link>
          </p>
        )}
      </div>
    </div>
  );
}
