const CompanySettings = require("../models/CompanySettings");

// Per-tenant settings a company admin can self-serve (AI interview config, DPDP/compliance
// controls, DPO contact, branding, notification + email prefs). Everything here is scoped to
// req.user.company; the tenantScope plugin also auto-injects the tenant on every query, so a
// missing/forged company can't read or edit another tenant's settings.

// --- validation helpers (controllers may throw freely; server.js turns it into 400 { error }) ---
function asBool(v) {
  return v === true || v === "true";
}

function asString(v, { max = 200, field }) {
  if (v == null) return "";
  if (typeof v !== "string") throw new Error(`${field} must be text`);
  const s = v.trim();
  if (s.length > max) throw new Error(`${field} must be ${max} characters or fewer`);
  return s;
}

function asInt(v, { min, max, field }) {
  const n = Number(v);
  if (!Number.isFinite(n) || !Number.isInteger(n)) throw new Error(`${field} must be a whole number`);
  if (min != null && n < min) throw new Error(`${field} must be at least ${min}`);
  if (max != null && n > max) throw new Error(`${field} must be at most ${max}`);
  return n;
}

function asNum(v, { min, max, field }) {
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`${field} must be a number`);
  if (min != null && n < min) throw new Error(`${field} must be at least ${min}`);
  if (max != null && n > max) throw new Error(`${field} must be at most ${max}`);
  return n;
}

function asEmail(v, { field }) {
  const s = asString(v, { max: 254, field });
  if (s && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) throw new Error(`${field} must be a valid email`);
  return s;
}

function asHexColor(v, { field }) {
  const s = asString(v, { max: 9, field });
  if (s && !/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(s)) throw new Error(`${field} must be a hex color like #1a2a44`);
  return s;
}

// The projection returned to the client — only the tenant-editable groups, never internal fields.
const EDITABLE = "ai compliance branding emailTemplatePreferences notificationPreferences dashboardPreferences";

// Ensure a settings doc always exists (older companies may predate provisioning). Upsert with
// schema defaults so the admin form is never blank.
async function ensureSettings(companyId) {
  return CompanySettings.findOneAndUpdate(
    { company: companyId },
    { $setOnInsert: { company: companyId } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  ).select(EDITABLE);
}

async function getSettings(req, res) {
  const settings = await ensureSettings(req.user.company);
  res.json(settings);
}

// Partial update: only the groups/fields present in the body are applied (PATCH semantics),
// each validated + whitelisted so a client can't set arbitrary paths. Set via doc.set(path,…)
// so Mongoose reliably tracks the nested change.
async function updateSettings(req, res) {
  const settings = await ensureSettings(req.user.company);
  const body = req.body || {};
  const changed = [];

  function set(path, value) {
    settings.set(path, value);
    changed.push(path);
  }

  if (body.ai && typeof body.ai === "object") {
    const ai = body.ai;
    if ("model" in ai) set("ai.model", asString(ai.model, { max: 100, field: "AI model" }));
    if ("monthlyBudgetCents" in ai)
      set("ai.monthlyBudgetCents", asInt(ai.monthlyBudgetCents, { min: 0, max: 100000000, field: "Monthly budget" }));
    if ("hardCap" in ai) set("ai.hardCap", asBool(ai.hardCap));
    if ("temperature" in ai) set("ai.temperature", asNum(ai.temperature, { min: 0, max: 2, field: "Temperature" }));
  }

  if (body.compliance && typeof body.compliance === "object") {
    const c = body.compliance;
    if ("aiConsentRequired" in c) set("compliance.aiConsentRequired", asBool(c.aiConsentRequired));
    if ("autoRejectAllowed" in c) set("compliance.autoRejectAllowed", asBool(c.autoRejectAllowed));
    if ("retentionDays" in c)
      set("compliance.retentionDays", asInt(c.retentionDays, { min: 1, max: 3650, field: "Retention days" }));
    if (c.dpo && typeof c.dpo === "object") {
      if ("name" in c.dpo) set("compliance.dpo.name", asString(c.dpo.name, { max: 120, field: "DPO name" }));
      if ("email" in c.dpo) set("compliance.dpo.email", asEmail(c.dpo.email, { field: "DPO email" }));
      if ("phone" in c.dpo) set("compliance.dpo.phone", asString(c.dpo.phone, { max: 40, field: "DPO phone" }));
    }
  }

  if (body.branding && typeof body.branding === "object") {
    const b = body.branding;
    if ("useCustomBranding" in b) set("branding.useCustomBranding", asBool(b.useCustomBranding));
    if ("primaryColor" in b) set("branding.primaryColor", asHexColor(b.primaryColor, { field: "Primary color" }));
  }

  if (body.emailTemplatePreferences && typeof body.emailTemplatePreferences === "object") {
    const e = body.emailTemplatePreferences;
    if ("useDefaultTemplates" in e) set("emailTemplatePreferences.useDefaultTemplates", asBool(e.useDefaultTemplates));
    if ("replyToEmail" in e) set("emailTemplatePreferences.replyToEmail", asEmail(e.replyToEmail, { field: "Reply-to email" }));
  }

  if (body.notificationPreferences && typeof body.notificationPreferences === "object") {
    const n = body.notificationPreferences;
    if ("emailOnNewApplication" in n) set("notificationPreferences.emailOnNewApplication", asBool(n.emailOnNewApplication));
    if ("emailOnAtsResult" in n) set("notificationPreferences.emailOnAtsResult", asBool(n.emailOnAtsResult));
    if ("emailOnInterviewCompleted" in n)
      set("notificationPreferences.emailOnInterviewCompleted", asBool(n.emailOnInterviewCompleted));
  }

  if (body.dashboardPreferences && typeof body.dashboardPreferences === "object") {
    const d = body.dashboardPreferences;
    if ("defaultView" in d) set("dashboardPreferences.defaultView", asString(d.defaultView, { max: 40, field: "Default view" }));
  }

  if (changed.length === 0) {
    return res.status(400).json({ error: "No recognized settings fields to update" });
  }

  await settings.save();

  // Enrich the audit trail — compliance/retention/DPO changes are security-relevant. The global
  // auditLog middleware records the mutation; this names it and captures which fields changed.
  req.audit = {
    action: "company_settings.update",
    resourceType: "CompanySettings",
    resourceId: settings._id,
    meta: { fields: changed },
  };

  res.json(await CompanySettings.findById(settings._id).select(EDITABLE));
}

module.exports = { getSettings, updateSettings };
