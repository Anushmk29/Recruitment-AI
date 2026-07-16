import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowLeft, ArrowRight, Building2, UserCog } from "lucide-react";
import api from "../api/client.js";
import { useToast } from "../components/ui/Toast.jsx";
import MarketingNavbar from "../components/marketing/MarketingNavbar.jsx";
import OnboardingSteps from "../components/marketing/OnboardingSteps.jsx";
import { Card } from "../components/ui/Card.jsx";
import { Input, Select, Label, FieldError, FormGroup } from "../components/ui/Field.jsx";
import Button from "../components/ui/Button.jsx";

const COMPANY_SIZES = ["1-10", "11-50", "51-200", "201-500", "500+"];

export default function RegisterCompany() {
  const navigate = useNavigate();
  const toast = useToast();
  const [step, setStep] = useState(1);
  const [company, setCompany] = useState({
    name: "",
    industry: "",
    companySize: "1-10",
    website: "",
    gstNumber: "",
    country: "",
    state: "",
    city: "",
    address: "",
  });
  const [admin, setAdmin] = useState({ fullName: "", email: "", phone: "", password: "", confirmPassword: "" });
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  function updateCompany(field) {
    return (e) => setCompany((c) => ({ ...c, [field]: e.target.value }));
  }
  function updateAdmin(field) {
    return (e) => setAdmin((a) => ({ ...a, [field]: e.target.value }));
  }

  function handleContinue(e) {
    e.preventDefault();
    if (!company.name || !company.country || !company.state || !company.city || !company.address) {
      setError("Please fill in all required company fields");
      return;
    }
    setError("");
    setStep(2);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");

    if (admin.password !== admin.confirmPassword) {
      setError("Passwords do not match");
      return;
    }

    setSubmitting(true);
    try {
      await api.post("/companies/register", {
        company,
        admin: { fullName: admin.fullName, email: admin.email, phone: admin.phone, password: admin.password },
      });
      toast.success("Company registered — check your email for a verification code.");
      navigate("/verify-otp", { state: { email: admin.email } });
    } catch (err) {
      setError(err.response?.data?.error || "Could not register your company");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <MarketingNavbar />
      <div className="mx-auto max-w-2xl px-5 py-14 sm:px-8">
        <OnboardingSteps current={step} />
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-bold text-slate-900 sm:text-3xl">Register Your Company</h1>
          <p className="mt-2 text-sm text-slate-500">
            {step === 1 ? "Tell us about your organization." : "Now create the admin account for your workspace."}
          </p>
        </div>

        <Card>
          {error && (
            <p className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm font-medium text-red-700">{error}</p>
          )}

          <AnimatePresence mode="wait">
            {step === 1 ? (
              <motion.form
                key="company"
                initial={{ opacity: 0, x: 24 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -24 }}
                transition={{ duration: 0.25 }}
                onSubmit={handleContinue}
              >
                <div className="mb-5 flex items-center gap-2 text-sm font-semibold text-brand-700">
                  <Building2 className="h-4 w-4" /> Company Details
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <FormGroup className="sm:col-span-2">
                    <Label required>Company Name</Label>
                    <Input value={company.name} onChange={updateCompany("name")} required />
                  </FormGroup>
                  <FormGroup>
                    <Label>Industry</Label>
                    <Input value={company.industry} onChange={updateCompany("industry")} placeholder="e.g. Technology" />
                  </FormGroup>
                  <FormGroup>
                    <Label required>Company Size</Label>
                    <Select value={company.companySize} onChange={updateCompany("companySize")} required>
                      {COMPANY_SIZES.map((size) => (
                        <option key={size} value={size}>
                          {size} employees
                        </option>
                      ))}
                    </Select>
                  </FormGroup>
                  <FormGroup>
                    <Label>Website</Label>
                    <Input type="url" value={company.website} onChange={updateCompany("website")} placeholder="https://" />
                  </FormGroup>
                  <FormGroup>
                    <Label>GST Number (Optional)</Label>
                    <Input value={company.gstNumber} onChange={updateCompany("gstNumber")} />
                  </FormGroup>
                  <FormGroup>
                    <Label required>Country</Label>
                    <Input value={company.country} onChange={updateCompany("country")} required />
                  </FormGroup>
                  <FormGroup>
                    <Label required>State</Label>
                    <Input value={company.state} onChange={updateCompany("state")} required />
                  </FormGroup>
                  <FormGroup className="sm:col-span-2">
                    <Label required>City</Label>
                    <Input value={company.city} onChange={updateCompany("city")} required />
                  </FormGroup>
                  <FormGroup className="sm:col-span-2">
                    <Label required>Address</Label>
                    <Input value={company.address} onChange={updateCompany("address")} required />
                  </FormGroup>
                </div>
                <Button type="submit" size="lg" className="mt-2 w-full">
                  Continue <ArrowRight className="h-4 w-4" />
                </Button>
              </motion.form>
            ) : (
              <motion.form
                key="admin"
                initial={{ opacity: 0, x: 24 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -24 }}
                transition={{ duration: 0.25 }}
                onSubmit={handleSubmit}
              >
                <div className="mb-5 flex items-center gap-2 text-sm font-semibold text-brand-700">
                  <UserCog className="h-4 w-4" /> Admin Details
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <FormGroup className="sm:col-span-2">
                    <Label required>Full Name</Label>
                    <Input value={admin.fullName} onChange={updateAdmin("fullName")} required />
                  </FormGroup>
                  <FormGroup>
                    <Label required>Email</Label>
                    <Input type="email" value={admin.email} onChange={updateAdmin("email")} required />
                  </FormGroup>
                  <FormGroup>
                    <Label required>Phone Number</Label>
                    <Input type="tel" value={admin.phone} onChange={updateAdmin("phone")} placeholder="+91 98765 43210" required />
                  </FormGroup>
                  <FormGroup>
                    <Label required>Password</Label>
                    <Input type="password" value={admin.password} onChange={updateAdmin("password")} minLength={8} required />
                  </FormGroup>
                  <FormGroup>
                    <Label required>Confirm Password</Label>
                    <Input
                      type="password"
                      value={admin.confirmPassword}
                      onChange={updateAdmin("confirmPassword")}
                      minLength={8}
                      required
                    />
                  </FormGroup>
                </div>
                <p className="mb-5 text-xs text-slate-500">
                  At least 8 characters, with an uppercase letter, a lowercase letter, a number, and a special
                  character.
                </p>
                <div className="flex gap-3">
                  <Button type="button" variant="outline" onClick={() => setStep(1)}>
                    <ArrowLeft className="h-4 w-4" /> Back
                  </Button>
                  <Button type="submit" size="lg" loading={submitting} className="flex-1">
                    Create Company Workspace
                  </Button>
                </div>
              </motion.form>
            )}
          </AnimatePresence>
        </Card>

        <p className="mt-6 text-center text-sm text-slate-500">
          Already registered?{" "}
          <Link to="/login" className="font-semibold text-brand-700 hover:underline">
            Log in
          </Link>
        </p>
      </div>
    </div>
  );
}
