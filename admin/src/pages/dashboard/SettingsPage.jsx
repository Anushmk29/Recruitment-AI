import { useEffect, useState } from "react";
import { Building2, User, Mail, Phone, Bot, ShieldCheck, BellRing, Palette, Save, AlertTriangle, Globe2, Copy, Microscope } from "lucide-react";
import api from "../../api/client.js";
import { useAdminAuth } from "../../auth/useAdminAuth.js";
import { useCompanyData } from "../../context/CompanyDataContext.jsx";
import { Card, Badge, Skeleton } from "../../components/ui/Card.jsx";
import { Input, Select, Label, FormGroup } from "../../components/ui/Field.jsx";
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
  atsEngine: "",
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
    atsEngine: s.ai?.atsEngine || "",
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
      atsEngine: f.atsEngine,
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

// Phase 15 — distribution: public careers/feed URLs + tenant board credentials.
// Credentials are WRITE-ONLY: the API never returns stored secrets, so the form
// always starts blank and only shows "configured / last test" status.
const CREDENTIAL_FIELDS = {
  naukri: [
    { key: "clientId", label: "Client ID" },
    { key: "apiKey", label: "API key" },
  ],
  webhook: [
    { key: "url", label: "Webhook URL" },
    { key: "secret", label: "Signing secret" },
  ],
  linkedin: [{ key: "accessToken", label: "Access token" }],
  indeed: [{ key: "accessToken", label: "Access token" }],
  ziprecruiter: [{ key: "accessToken", label: "Access token" }],
};

function IntegrationsSection() {
  const toast = useToast();
  const [careers, setCareers] = useState(null);
  const [boards, setBoards] = useState([]);
  const [drafts, setDrafts] = useState({}); // board → { field: value }
  const [busyBoard, setBusyBoard] = useState(null);

  useEffect(() => {
    api.get("/company-settings/careers-info").then((res) => setCareers(res.data)).catch(() => {});
    loadBoards();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadBoards() {
    try {
      const res = await api.get("/company-settings/board-credentials");
      setBoards(res.data.boards || []);
    } catch {
      // section stays empty — not fatal for the rest of settings
    }
  }

  async function copyText(text, label) {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(`${label} copied`);
    } catch {
      toast.error("Could not copy");
    }
  }

  async function saveCredential(board) {
    const fields = CREDENTIAL_FIELDS[board] || [];
    const secrets = {};
    for (const f of fields) {
      const v = (drafts[board]?.[f.key] || "").trim();
      if (!v) return toast.error(`${f.label} is required`);
      secrets[f.key] = v;
    }
    setBusyBoard(board);
    try {
      await api.put(`/company-settings/board-credentials/${board}`, { secrets });
      setDrafts((d) => ({ ...d, [board]: {} }));
      toast.success("Credentials saved (encrypted at rest — never shown again)");
      await loadBoards();
    } catch (err) {
      toast.error(err.response?.data?.error || "Could not save credentials");
    } finally {
      setBusyBoard(null);
    }
  }

  async function testCredential(board) {
    setBusyBoard(board);
    try {
      await api.post(`/company-settings/board-credentials/${board}/test`);
      toast.success("Connection OK");
    } catch (err) {
      toast.error(err.response?.data?.error || "Connection test failed");
    } finally {
      setBusyBoard(null);
      await loadBoards();
    }
  }

  async function disconnect(board) {
    if (!confirm(`Disconnect ${board}? The stored credentials are deleted.`)) return;
    setBusyBoard(board);
    try {
      await api.delete(`/company-settings/board-credentials/${board}`);
      toast.success("Disconnected");
      await loadBoards();
    } catch (err) {
      toast.error(err.response?.data?.error || "Could not disconnect");
    } finally {
      setBusyBoard(null);
    }
  }

  return (
    <Card>
      <h2 className="mb-1 flex items-center gap-2 text-base font-semibold text-slate-900">
        <Globe2 className="h-4.5 w-4.5 text-brand-600" /> Integrations & Distribution
      </h2>
      <p className="mb-4 text-sm text-slate-500">
        Your public careers page and feeds need nobody's permission — Google for Jobs and the aggregator network index
        them for free. Board accounts you already pay for connect below.
      </p>

      {careers && (
        <div className="mb-5 space-y-2 rounded-xl bg-slate-50 p-4 text-sm">
          {[
            { label: "Careers page", value: careers.careersUrl },
            { label: "Jobs feed (XML)", value: careers.feedUrl },
            { label: "Jobs sitemap", value: careers.sitemapUrl },
          ].map((row) => (
            <div key={row.label} className="flex items-center justify-between gap-3">
              <span className="shrink-0 text-slate-500">{row.label}</span>
              <span className="truncate font-mono text-xs text-slate-600">{row.value}</span>
              <button onClick={() => copyText(row.value, row.label)} className="shrink-0 text-slate-500 hover:text-brand-700" title="Copy">
                <Copy className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
          <p className="pt-1 text-xs text-slate-500">
            Submit the feed once to Adzuna, Jooble, Talent.com and Careerjet — no contract needed; they crawl it from
            then on.
          </p>
        </div>
      )}

      <div className="space-y-4">
        {boards.map((b) => (
          <div key={b.board} className="rounded-xl border border-slate-200 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-semibold text-slate-800">
                {b.name} <Badge tone="slate">Tier {b.tier}</Badge>
              </p>
              <div className="flex items-center gap-2">
                {!b.enabled && <Badge tone="amber">{b.reason}</Badge>}
                {b.configured ? (
                  <Badge tone={b.lastTestOk === false ? "red" : "green"}>
                    connected{b.lastTestedAt ? ` · tested ${new Date(b.lastTestedAt).toLocaleDateString()}` : ""}
                  </Badge>
                ) : (
                  <Badge tone="slate">not connected</Badge>
                )}
              </div>
            </div>

            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              {(CREDENTIAL_FIELDS[b.board] || []).map((f) => (
                <FormGroup key={f.key}>
                  <Label>{f.label}</Label>
                  <Input
                    type="password"
                    autoComplete="off"
                    placeholder={b.configured ? "•••••• (stored encrypted)" : ""}
                    value={drafts[b.board]?.[f.key] || ""}
                    onChange={(e) => setDrafts((d) => ({ ...d, [b.board]: { ...d[b.board], [f.key]: e.target.value } }))}
                  />
                </FormGroup>
              ))}
            </div>

            <div className="mt-1 flex flex-wrap gap-2">
              <Button size="sm" variant="outline" loading={busyBoard === b.board} onClick={() => saveCredential(b.board)}>
                Save credentials
              </Button>
              {b.configured && (
                <>
                  <Button size="sm" variant="outline" loading={busyBoard === b.board} onClick={() => testCredential(b.board)}>
                    Test connection
                  </Button>
                  <Button size="sm" variant="outline" loading={busyBoard === b.board} onClick={() => disconnect(b.board)}>
                    Disconnect
                  </Button>
                </>
              )}
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
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
        <h1 className="text-2xl font-bold tracking-tight text-slate-900 [overflow-wrap:anywhere]">Settings</h1>
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
              <dt className="text-slate-500">Name</dt>
              <dd className="font-medium text-slate-800">{user?.name || "—"}</dd>
            </div>
            <div className="flex items-center justify-between">
              <dt className="flex items-center gap-1.5 text-slate-500">
                <Mail className="h-3.5 w-3.5" /> Email
              </dt>
              <dd className="font-medium text-slate-800">{user?.email || "—"}</dd>
            </div>
            <div className="flex items-center justify-between">
              <dt className="flex items-center gap-1.5 text-slate-500">
                <Phone className="h-3.5 w-3.5" /> Phone
              </dt>
              <dd className="font-medium text-slate-800">{user?.phone || "—"}</dd>
            </div>
            <div className="flex items-center justify-between">
              <dt className="text-slate-500">Role</dt>
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
                <dt className="text-slate-500">Company Name</dt>
                <dd className="font-medium text-slate-800">{company?.name || "—"}</dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="text-slate-500">Company Code</dt>
                <dd className="font-mono text-xs font-medium text-slate-800">{company?.companyCode || "—"}</dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="text-slate-500">Status</dt>
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
          {/* Screening engine — the switch that decides whether the evidence
              engine (rubric × claim-graph × deterministic scorer) actually
              scores candidates, or only the legacy keyword matcher runs. */}
          <Card>
            <h2 className="mb-1 flex items-center gap-2 text-base font-semibold text-slate-900">
              <Microscope className="h-4.5 w-4.5 text-brand-600" /> Screening Engine
            </h2>
            <p className="mb-4 text-sm text-slate-500">
              How applicants are scored. The evidence engine scores each candidate against your approved rubric with
              cited proof for every point — jobs without an approved rubric always use the keyword engine.
            </p>
            <FormGroup className="mb-0 max-w-md">
              <Label>Engine mode</Label>
              <Select value={form.atsEngine} onChange={onInput("atsEngine")}>
                <option value="">Platform default</option>
                <option value="legacy">Legacy — keyword matching only</option>
                <option value="shadow">Shadow — evidence engine runs silently for comparison</option>
                <option value="live">Live — evidence engine scores candidates</option>
              </Select>
              <p className="mt-2 text-xs text-slate-500">
                {form.atsEngine === "shadow" &&
                  "Shadow mode: candidates are still scored and decided by the keyword engine, while the evidence engine runs in parallel and records what it would have scored. Use this to compare the two before going live — nothing changes for candidates."}
                {form.atsEngine === "live" &&
                  "Live mode: the evidence engine's score is the candidate's score wherever a job has an approved rubric. Jobs without one fall back to the keyword engine, labelled as such."}
                {form.atsEngine === "legacy" &&
                  "Legacy mode: only the deterministic keyword engine runs. Rubrics, claim verification and evidence scoring are not used."}
                {form.atsEngine === "" &&
                  "The platform-wide default applies. Pick a mode to control it per company."}
              </p>
            </FormGroup>
          </Card>

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
                <p className="mt-1 text-xs text-slate-500">0 = uncapped. Interview LLM spend is metered against this each month.</p>
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
              <p className="mt-1 text-xs text-slate-500">Interview & resume data untouched for longer than this is permanently deleted by the nightly job.</p>
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

          <IntegrationsSection />

          <div className="sticky bottom-4 flex justify-end">
            {/* shadow-soft, not shadow-lg: DESIGN.md defines four elevation
                planes and a raw Tailwind shadow is none of them. */}
            <Button onClick={save} loading={saving} className="shadow-soft">
              <Save className="h-4 w-4" /> Save changes
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
