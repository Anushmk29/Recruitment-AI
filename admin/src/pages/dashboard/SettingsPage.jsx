import { useEffect, useState } from "react";
import { Building2, User, Mail, Phone, Bot, ShieldCheck, BellRing, Palette, Save, AlertTriangle } from "lucide-react";
import api from "../../api/client.js";
import { useAdminAuth } from "../../auth/useAdminAuth.js";
import { useCompanyData } from "../../context/CompanyDataContext.jsx";
import { Card, Badge, Skeleton } from "../../components/ui/Card.jsx";
import { Input, Label, FormGroup } from "../../components/ui/Field.jsx";
import Button from "../../components/ui/Button.jsx";
import { useToast } from "../../components/ui/Toast.jsx";

// A small inline switch — the UI kit has no toggle, and a checkbox reads poorly for on/off policy.
function Toggle({ checked, onChange, disabled }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus:outline-none focus-visible:ring-4 focus-visible:ring-brand-100 disabled:opacity-50 ${
        checked ? "bg-brand-600" : "bg-slate-300"
      }`}
    >
      <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${checked ? "translate-x-6" : "translate-x-1"}`} />
    </button>
  );
}

function ToggleRow({ label, description, checked, onChange, tone }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2.5">
      <div>
        <p className={`text-sm font-medium ${tone === "warn" ? "text-amber-800" : "text-slate-800"}`}>{label}</p>
        {description && <p className="mt-0.5 text-xs text-slate-500">{description}</p>}
      </div>
      <Toggle checked={checked} onChange={onChange} />
    </div>
  );
}

const EMPTY = {
  aiModel: "",
  aiTemperature: "0",
  aiBudgetUsd: "0",
  aiHardCap: true,
  consentRequired: true,
  autoReject: false,
  retentionDays: "365",
  dpoName: "",
  dpoEmail: "",
  dpoPhone: "",
  notifNewApp: true,
  notifAts: true,
  notifInterview: true,
  brandingCustom: false,
  brandingColor: "#1a2a44",
};

// Map the API settings document → flat form state (budget shown in USD, not cents).
function fromSettings(s) {
  return {
    aiModel: s.ai?.model || "",
    aiTemperature: String(s.ai?.temperature ?? 0),
    aiBudgetUsd: String((s.ai?.monthlyBudgetCents ?? 0) / 100),
    aiHardCap: s.ai?.hardCap !== false,
    consentRequired: s.compliance?.aiConsentRequired !== false,
    autoReject: s.compliance?.autoRejectAllowed === true,
    retentionDays: String(s.compliance?.retentionDays ?? 365),
    dpoName: s.compliance?.dpo?.name || "",
    dpoEmail: s.compliance?.dpo?.email || "",
    dpoPhone: s.compliance?.dpo?.phone || "",
    notifNewApp: s.notificationPreferences?.emailOnNewApplication !== false,
    notifAts: s.notificationPreferences?.emailOnAtsResult !== false,
    notifInterview: s.notificationPreferences?.emailOnInterviewCompleted !== false,
    brandingCustom: s.branding?.useCustomBranding === true,
    brandingColor: s.branding?.primaryColor || "#1a2a44",
  };
}

// Flat form state → the nested payload the PUT endpoint validates.
function toPayload(f) {
  return {
    ai: {
      model: f.aiModel.trim(),
      temperature: Number(f.aiTemperature),
      monthlyBudgetCents: Math.round(Number(f.aiBudgetUsd) * 100),
      hardCap: f.aiHardCap,
    },
    compliance: {
      aiConsentRequired: f.consentRequired,
      autoRejectAllowed: f.autoReject,
      retentionDays: Math.round(Number(f.retentionDays)),
      dpo: { name: f.dpoName.trim(), email: f.dpoEmail.trim(), phone: f.dpoPhone.trim() },
    },
    notificationPreferences: {
      emailOnNewApplication: f.notifNewApp,
      emailOnAtsResult: f.notifAts,
      emailOnInterviewCompleted: f.notifInterview,
    },
    branding: { useCustomBranding: f.brandingCustom, primaryColor: f.brandingColor },
  };
}

export default function SettingsPage() {
  const { user } = useAdminAuth();
  const { me, loading: companyLoading } = useCompanyData();
  const company = me?.company;
  const toast = useToast();

  const [form, setForm] = useState(EMPTY);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    api
      .get("/company-settings")
      .then((res) => {
        if (active) setForm(fromSettings(res.data));
      })
      .catch(() => toast.error("Could not load company settings."))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const set = (key) => (value) => setForm((f) => ({ ...f, [key]: value }));
  const onInput = (key) => (e) => set(key)(e.target.value);

  async function save() {
    // Light client-side guards; the server validates authoritatively.
    const temp = Number(form.aiTemperature);
    const budget = Number(form.aiBudgetUsd);
    const retention = Number(form.retentionDays);
    if (!Number.isFinite(temp) || temp < 0 || temp > 2) return toast.error("Temperature must be between 0 and 2.");
    if (!Number.isFinite(budget) || budget < 0) return toast.error("Monthly budget must be 0 or more.");
    if (!Number.isFinite(retention) || retention < 1) return toast.error("Retention must be at least 1 day.");

    setSaving(true);
    try {
      const res = await api.put("/company-settings", toPayload(form));
      setForm(fromSettings(res.data));
      toast.success("Settings saved.");
    } catch (err) {
      toast.error(err.response?.data?.error || "Could not save settings.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Settings</h1>
        <p className="mt-1 text-sm text-slate-500">Your account, company details, and how the platform runs for your team.</p>
      </div>

      {/* Read-only account + company */}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <h2 className="mb-4 flex items-center gap-2 text-base font-semibold text-slate-900">
            <User className="h-4.5 w-4.5 text-brand-600" /> Account
          </h2>
          <dl className="space-y-3 text-sm">
            <div className="flex items-center justify-between">
              <dt className="text-slate-400">Name</dt>
              <dd className="font-medium text-slate-800">{user?.name || "—"}</dd>
            </div>
            <div className="flex items-center justify-between">
              <dt className="flex items-center gap-1.5 text-slate-400">
                <Mail className="h-3.5 w-3.5" /> Email
              </dt>
              <dd className="font-medium text-slate-800">{user?.email || "—"}</dd>
            </div>
            <div className="flex items-center justify-between">
              <dt className="flex items-center gap-1.5 text-slate-400">
                <Phone className="h-3.5 w-3.5" /> Phone
              </dt>
              <dd className="font-medium text-slate-800">{user?.phone || "—"}</dd>
            </div>
            <div className="flex items-center justify-between">
              <dt className="text-slate-400">Role</dt>
              <dd><Badge tone="brand">{user?.role}</Badge></dd>
            </div>
          </dl>
        </Card>

        <Card>
          <h2 className="mb-4 flex items-center gap-2 text-base font-semibold text-slate-900">
            <Building2 className="h-4.5 w-4.5 text-brand-600" /> Company
          </h2>
          {companyLoading ? (
            <Skeleton className="h-24 w-full" />
          ) : (
            <dl className="space-y-3 text-sm">
              <div className="flex items-center justify-between">
                <dt className="text-slate-400">Company Name</dt>
                <dd className="font-medium text-slate-800">{company?.name || "—"}</dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="text-slate-400">Company Code</dt>
                <dd className="font-mono text-xs font-medium text-slate-800">{company?.companyCode || "—"}</dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="text-slate-400">Status</dt>
                <dd><Badge tone={company?.status === "active" ? "green" : "amber"}>{company?.status || "—"}</Badge></dd>
              </div>
            </dl>
          )}
        </Card>
      </div>

      {loading ? (
        <Card><Skeleton className="h-64 w-full" /></Card>
      ) : (
        <>
          {/* AI interview */}
          <Card>
            <h2 className="mb-1 flex items-center gap-2 text-base font-semibold text-slate-900">
              <Bot className="h-4.5 w-4.5 text-brand-600" /> AI Interview
            </h2>
            <p className="mb-4 text-sm text-slate-500">How the AI conducts and pays for interviews. Leave the model blank to use the platform default.</p>
            <div className="grid gap-4 sm:grid-cols-2">
              <FormGroup className="mb-0">
                <Label>Model override</Label>
                <Input value={form.aiModel} onChange={onInput("aiModel")} placeholder="e.g. anthropic/claude-3.5-sonnet (blank = default)" />
              </FormGroup>
              <FormGroup className="mb-0">
                <Label>Temperature (0–2)</Label>
                <Input type="number" min="0" max="2" step="0.1" value={form.aiTemperature} onChange={onInput("aiTemperature")} />
              </FormGroup>
              <FormGroup className="mb-0">
                <Label>Monthly AI budget (USD)</Label>
                <Input type="number" min="0" step="0.01" value={form.aiBudgetUsd} onChange={onInput("aiBudgetUsd")} />
                <p className="mt-1 text-xs text-slate-400">0 = uncapped. Interview LLM spend is metered against this each month.</p>
              </FormGroup>
              <div className="flex items-center">
                <ToggleRow
                  label="Hard budget cap"
                  description="When the budget is spent, fall back to the offline engine instead of continuing to spend."
                  checked={form.aiHardCap}
                  onChange={set("aiHardCap")}
                />
              </div>
            </div>
          </Card>

          {/* Compliance & DPDP */}
          <Card>
            <h2 className="mb-1 flex items-center gap-2 text-base font-semibold text-slate-900">
              <ShieldCheck className="h-4.5 w-4.5 text-brand-600" /> Compliance & Data Protection
            </h2>
            <p className="mb-3 text-sm text-slate-500">Controls that govern candidate PII and fair-hiring safeguards (India DPDP).</p>
            <div className="divide-y divide-slate-100">
              <ToggleRow
                label="Require AI consent"
                description="Ask candidates to consent before any resume/answer text is sent to the external AI. Without consent the interview runs fully offline."
                checked={form.consentRequired}
                onChange={set("consentRequired")}
              />
              <ToggleRow
                label="Allow automatic rejection"
                description="Let the ATS auto-reject and email below-threshold candidates without human review. Off keeps a person in the loop (recommended)."
                checked={form.autoReject}
                onChange={set("autoReject")}
                tone={form.autoReject ? "warn" : undefined}
              />
            </div>
            {form.autoReject && (
              <div className="mt-3 flex items-start gap-2 rounded-xl bg-amber-50 p-3 text-xs text-amber-800">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                Automatic rejection is enabled — candidates below the ATS threshold will be rejected and emailed with no human review.
              </div>
            )}
            <FormGroup className="mb-0 mt-4 max-w-xs">
              <Label>Data retention (days)</Label>
              <Input type="number" min="1" max="3650" step="1" value={form.retentionDays} onChange={onInput("retentionDays")} />
              <p className="mt-1 text-xs text-slate-400">Interview & resume data untouched for longer than this is permanently deleted by the nightly job.</p>
            </FormGroup>
          </Card>

          {/* DPO contact */}
          <Card>
            <h2 className="mb-1 flex items-center gap-2 text-base font-semibold text-slate-900">
              <ShieldCheck className="h-4.5 w-4.5 text-brand-600" /> Data Protection Officer
            </h2>
            <p className="mb-4 text-sm text-slate-500">Shown to candidates on the application form for data-rights requests (DPDP §5.2).</p>
            <div className="grid gap-4 sm:grid-cols-3">
              <FormGroup className="mb-0">
                <Label>Name</Label>
                <Input value={form.dpoName} onChange={onInput("dpoName")} placeholder="Full name" />
              </FormGroup>
              <FormGroup className="mb-0">
                <Label>Email</Label>
                <Input type="email" value={form.dpoEmail} onChange={onInput("dpoEmail")} placeholder="dpo@company.com" />
              </FormGroup>
              <FormGroup className="mb-0">
                <Label>Phone</Label>
                <Input value={form.dpoPhone} onChange={onInput("dpoPhone")} placeholder="+91 …" />
              </FormGroup>
            </div>
          </Card>

          {/* Notifications */}
          <Card>
            <h2 className="mb-1 flex items-center gap-2 text-base font-semibold text-slate-900">
              <BellRing className="h-4.5 w-4.5 text-brand-600" /> Email Notifications
            </h2>
            <p className="mb-3 text-sm text-slate-500">Which recruiter emails your team receives.</p>
            <div className="divide-y divide-slate-100">
              <ToggleRow label="New application" description="Email when a candidate applies to one of your jobs." checked={form.notifNewApp} onChange={set("notifNewApp")} />
              <ToggleRow label="ATS result" description="Email when a candidate passes or fails ATS screening." checked={form.notifAts} onChange={set("notifAts")} />
              <ToggleRow label="Interview completed" description="Email when an AI interview finishes and a report is ready." checked={form.notifInterview} onChange={set("notifInterview")} />
            </div>
          </Card>

          {/* Branding */}
          <Card>
            <h2 className="mb-1 flex items-center gap-2 text-base font-semibold text-slate-900">
              <Palette className="h-4.5 w-4.5 text-brand-600" /> Branding
            </h2>
            <p className="mb-3 text-sm text-slate-500">Apply your brand colour to candidate-facing pages and emails.</p>
            <ToggleRow label="Use custom branding" checked={form.brandingCustom} onChange={set("brandingCustom")} />
            <FormGroup className="mb-0 mt-3 max-w-xs">
              <Label>Primary colour</Label>
              <div className="flex items-center gap-3">
                <input
                  type="color"
                  value={form.brandingColor}
                  onChange={onInput("brandingColor")}
                  className="h-10 w-14 cursor-pointer rounded-lg border border-slate-300 bg-white p-1"
                />
                <Input value={form.brandingColor} onChange={onInput("brandingColor")} className="font-mono" />
              </div>
            </FormGroup>
          </Card>

          <div className="sticky bottom-4 flex justify-end">
            <Button onClick={save} loading={saving} className="shadow-lg">
              <Save className="h-4 w-4" /> Save changes
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
