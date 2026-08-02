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
  // Confirmed 4s+ of continuous absence, and only when the detector was reading the candidate
  // WELL immediately beforehand. Ambiguous losses are reported as `detector_uncertain` instead.
  face_absent: { severity: "medium", weight: 10, cap: 40, label: "Candidate away from camera (4s+)" },
  multi_face: { severity: "high", weight: 25, cap: 75, label: "More than one person on camera" },
  // Now a confirmed 7s+ continuous episode rather than a per-frame sample, so each occurrence
  // means far more than it used to. Weight stays low on purpose: looking away is weak evidence of
  // anything by itself, and glancing at notes is not misconduct.
  gaze_away: { severity: "low", weight: 2, cap: 24, label: "Looked away from the screen (7s+)" },
  identity_mismatch: { severity: "high", weight: 30, cap: 60, label: "Face did not match the identity photo" },
  // Diarization found a substantial run of words in a spoken answer attributed to someone other
  // than the dominant speaker. Weighted like an identity mismatch because it evidences the same
  // thing more directly: a camera can be dodged by sitting off-frame, but another person speaking
  // the answer is the answer not being the candidate's. Derived SERVER-side from the word counts
  // the browser reports — the client never sends this type.
  second_speaker: { severity: "high", weight: 30, cap: 60, label: "A second voice answered during the interview" },
  camera_lost: { severity: "medium", weight: 12, cap: 24, label: "Camera feed stopped during the interview" },
  phone_cam_lost: { severity: "medium", weight: 12, cap: 24, label: "Secondary phone camera disconnected" },
  // A statement about OUR camera pipeline, not about the candidate — the face was lost while the
  // detector was already reading marginally (dim, distant, or edge-cropped). It is recorded so the
  // session is honest about what could not be observed, and it is deliberately weightless: a
  // detector's failure is not a candidate's behaviour, and scoring it as such is how proctoring
  // tools manufacture suspicion they cannot substantiate.
  detector_uncertain: { severity: "low", weight: 0, cap: 0, label: "Camera view was unclear (not scored)" },
};

// Types that describe the RECORDING CONDITIONS rather than the candidate. They are surfaced to the
// recruiter (so "we couldn't see" is never silently rendered as "nothing happened") but contribute
// nothing to the risk score and can never move a candidate between risk bands.
const NON_SCORING_TYPES = new Set(["detector_uncertain"]);

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
  detector_uncertain:
    "The camera view was too dim, distant, or cropped for the face detector to be reliable. This measures our own view quality, not the candidate — it carries no risk weight and should not be read as a flag.",
  identity_mismatch: "Lighting or camera angle can affect the match — treat as a prompt to verify, not a conclusion.",
  second_speaker:
    "Speaker separation is imperfect: a television, a nearby conversation, or a household interruption can be labelled as a second voice. Listen to the answer before concluding anything.",
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
  // Which way they looked. "down" (notes, a phone, a keyboard) and "side" (a second monitor,
  // another person) are different findings for a reviewer, so the axis survives — but only as one
  // of two fixed enum values, never as a client-supplied string.
  if (type === "gaze_away" && (meta.direction === "down" || meta.direction === "side")) {
    out.direction = meta.direction;
  }
  if (type === "second_speaker") {
    if (Number.isFinite(Number(meta.secondaryWords))) {
      out.secondaryWords = Math.max(0, Math.min(9999, Math.round(Number(meta.secondaryWords))));
    }
    if (Number.isFinite(Number(meta.distinctSpeakers))) {
      out.distinctSpeakers = Math.max(0, Math.min(10, Math.round(Number(meta.distinctSpeakers))));
    }
  }
  return Object.keys(out).length ? out : undefined;
}

// How much non-dominant speech in a single spoken answer counts as a second voice rather than a
// stray diarization label. Diarization mislabels the odd word routinely, so a handful of scattered
// words must never raise a high-severity flag against someone.
const SECOND_SPEAKER_MIN_WORDS = Number(process.env.SECOND_SPEAKER_MIN_WORDS || 8);

// Decide, server-side, whether a diarization report from one answer amounts to a second speaker.
// The browser reports word counts (a measurement); this decides what they MEAN (a judgement) —
// the same split used everywhere else in this file.
function detectSecondSpeaker(speakers) {
  if (!speakers || typeof speakers !== "object") return null;
  const secondaryWords = Number(speakers.secondaryWords);
  const distinctSpeakers = Number(speakers.distinctSpeakers);
  if (!Number.isFinite(secondaryWords) || !Number.isFinite(distinctSpeakers)) return null;
  if (distinctSpeakers < 2 || secondaryWords < SECOND_SPEAKER_MIN_WORDS) return null;
  return { secondaryWords, distinctSpeakers };
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
    // Recording-condition types are excluded structurally, not just given a zero weight, so a
    // later edit to the table cannot accidentally start scoring our own camera trouble as the
    // candidate's conduct.
    if (NON_SCORING_TYPES.has(type)) continue;
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

// Report-ready breakdown: one row per type that actually occurred, heaviest first. `scored: false`
// rows still appear — a recruiter must be able to see that the camera view was poor, because the
// alternative is rendering "we could not observe this" as "nothing happened".
function breakdown(counts) {
  return Object.entries(counts || {})
    .filter(([type, n]) => isKnownType(type) && Number(n) > 0)
    .map(([type, n]) => ({
      type,
      label: labelOf(type),
      severity: severityOf(type),
      count: Number(n),
      points: NON_SCORING_TYPES.has(type)
        ? 0
        : Math.min(EVENT_TYPES[type].cap, Number(n) * EVENT_TYPES[type].weight),
      scored: !NON_SCORING_TYPES.has(type),
      benignExplanation: benignExplanationOf(type),
    }))
    .sort((a, b) => b.points - a.points);
}

module.exports = {
  EVENT_TYPES,
  NON_SCORING_TYPES,
  SECOND_SPEAKER_MIN_WORDS,
  detectSecondSpeaker,
  isKnownType,
  severityOf,
  labelOf,
  benignExplanationOf,
  sanitizeMeta,
  computeRisk,
  bandFor,
  breakdown,
};
