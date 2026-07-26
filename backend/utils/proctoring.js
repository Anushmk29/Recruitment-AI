// Deterministic, server-owned integrity scoring for the proctored interview.
//
// The browser is an untrusted reporter: it sends only the event TYPE (+ a little metadata). The
// server owns severity, weight, and the final risk score — a candidate can't inflate or hide their
// own risk by lying about severity, and can't forge a "low risk" score. Mirrors the split used for
// voice: measurements come from the client, the SCORE is computed here (see [[voice-interview-priority]]).
//
// Risk is advisory only. It surfaces to the recruiter alongside the interview; it never auto-rejects
// a candidate — a human makes the call (DPDP / human-in-the-loop, Wave 4).

// Event taxonomy. `weight` = risk points per occurrence; `cap` = the most that type can ever
// contribute (so a flaky webcam firing face_absent 200× can't alone max out the score). Keep the
// keys in sync with the client detectors in user/src/portal/useProctoring.js.
const EVENT_TYPES = {
  tab_switch: { severity: "medium", weight: 8, cap: 40, label: "Switched away from the interview tab" },
  window_blur: { severity: "low", weight: 4, cap: 20, label: "Interview window lost focus" },
  fullscreen_exit: { severity: "medium", weight: 6, cap: 30, label: "Exited fullscreen" },
  copy: { severity: "low", weight: 5, cap: 20, label: "Copied text from the page" },
  paste: { severity: "medium", weight: 8, cap: 24, label: "Pasted text into an answer" },
  context_menu: { severity: "low", weight: 2, cap: 10, label: "Opened the right-click menu" },
  face_absent: { severity: "medium", weight: 10, cap: 40, label: "No face detected on camera" },
  multi_face: { severity: "high", weight: 25, cap: 75, label: "More than one person on camera" },
  gaze_away: { severity: "low", weight: 2, cap: 24, label: "Looked away from the screen" },
  identity_mismatch: { severity: "high", weight: 30, cap: 60, label: "Face did not match the identity photo" },
  camera_lost: { severity: "medium", weight: 12, cap: 24, label: "Camera feed stopped during the interview" },
  phone_cam_lost: { severity: "medium", weight: 12, cap: 24, label: "Secondary phone camera disconnected" },
};

// A plausible benign explanation per flag type, so a recruiter reading the report
// doesn't over-anchor on "High risk" as proof of misconduct — most of these events
// have an innocent everyday cause.
const BENIGN_EXPLANATIONS = {
  tab_switch: "May be checking notes or a brief distraction, not necessarily cheating.",
  window_blur: "May be a notification or another window briefly stealing focus.",
  fullscreen_exit: "May be an accidental key press (Esc) or an OS prompt.",
  copy: "May be copying their own answer to review it, not lifting external content.",
  paste: "Could be pasting their own earlier notes rather than external material.",
  context_menu: "Often accidental (right-click) — low signal on its own.",
  face_absent: "May be webcam angle, lighting, or the candidate looking at notes — not necessarily absence.",
  multi_face: "Could be a reflection, poster, or someone briefly passing behind the candidate.",
  gaze_away: "May be glancing at notes or a second monitor, not disengagement.",
  identity_mismatch: "Lighting or camera angle can affect the match — treat as a prompt to verify, not a conclusion.",
  camera_lost: "Often a transient webcam/driver hiccup rather than an intentional camera-off.",
  phone_cam_lost: "Phones lock their screen or drop Wi-Fi easily — usually connectivity, not intent.",
};

function isKnownType(type) {
  return Object.prototype.hasOwnProperty.call(EVENT_TYPES, type);
}

function severityOf(type) {
  return EVENT_TYPES[type]?.severity || "low";
}

function labelOf(type) {
  return EVENT_TYPES[type]?.label || type;
}

function benignExplanationOf(type) {
  return BENIGN_EXPLANATIONS[type] || null;
}

// Only a short, numeric allow-list of metadata survives — never free-form client strings (they'd
// land in the admin report and the PDF). faceCount for multi_face, distance for identity checks.
function sanitizeMeta(type, meta) {
  if (!meta || typeof meta !== "object") return undefined;
  const out = {};
  if (type === "multi_face" && Number.isFinite(Number(meta.faceCount))) {
    out.faceCount = Math.max(0, Math.min(10, Math.round(Number(meta.faceCount))));
  }
  if (type === "identity_mismatch" && Number.isFinite(Number(meta.distance))) {
    out.distance = Math.round(Number(meta.distance) * 1000) / 1000;
  }
  return Object.keys(out).length ? out : undefined;
}

// counts: { [type]: occurrences }. Each type's contribution is still weighted + capped
// (as before), but the roll-up is severity-tier-dampened rather than a plain sum: a
// pile of routine medium/low-severity events (tab-switches, blur, gaze) can no longer
// alone reach the "High" band the way one real high-severity flag (multi_face,
// identity_mismatch) should. This fixes raw event counts hitting 100/100 from nothing
// but everyday tab-switching noise.
function computeRisk(counts) {
  const tier = { low: 0, medium: 0, high: 0 };
  for (const [type, n] of Object.entries(counts || {})) {
    const def = EVENT_TYPES[type];
    if (!def || !Number.isFinite(Number(n))) continue;
    tier[def.severity] += Math.min(def.cap, Math.max(0, Number(n)) * def.weight);
  }
  const raw = tier.high + tier.medium * 0.55 + tier.low * 0.25;
  const riskScore = Math.round(Math.max(0, Math.min(100, raw)));
  return { riskScore, riskBand: bandFor(riskScore) };
}

function bandFor(riskScore) {
  if (riskScore >= 50) return "high";
  if (riskScore >= 20) return "medium";
  return "low";
}

// Report-ready breakdown: one row per type that actually occurred, heaviest first.
function breakdown(counts) {
  return Object.entries(counts || {})
    .filter(([type, n]) => isKnownType(type) && Number(n) > 0)
    .map(([type, n]) => ({
      type,
      label: labelOf(type),
      severity: severityOf(type),
      count: Number(n),
      points: Math.min(EVENT_TYPES[type].cap, Number(n) * EVENT_TYPES[type].weight),
      benignExplanation: benignExplanationOf(type),
    }))
    .sort((a, b) => b.points - a.points);
}

module.exports = {
  EVENT_TYPES,
  isKnownType,
  severityOf,
  labelOf,
  benignExplanationOf,
  sanitizeMeta,
  computeRisk,
  bandFor,
  breakdown,
};
