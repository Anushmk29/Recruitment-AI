// Candidate-facing mirror of the backend hiring pipeline. Used by the
// application status tracker on the dashboard. Keep stage keys/order in sync
// with backend/utils/pipeline.js.

export const STAGES = [
  "applied",
  "ats_passed",
  "interview_scheduled",
  "ai_interview_completed",
  "under_review",
  "shortlisted",
  "hr_interview",
  "technical_interview",
  "manager_interview",
  "selected",
  "offer_sent",
  "offer_accepted",
  "joined",
];

export const STAGE_LABELS = {
  applied: "Applied",
  ats_passed: "ATS Passed",
  interview_scheduled: "Interview Scheduled",
  ai_interview_completed: "AI Interview Completed",
  under_review: "Under Review",
  shortlisted: "Shortlisted",
  hr_interview: "HR Interview",
  technical_interview: "Technical Interview",
  manager_interview: "Manager Interview",
  selected: "Selected",
  offer_sent: "Offer Sent",
  offer_accepted: "Offer Accepted",
  joined: "Joined",
  rejected: "Rejected",
};

const LEGACY_STAGE_MAP = { interview_queue: "interview_scheduled", next_round: "shortlisted" };

const STAGE_TONES = {
  applied: "slate",
  ats_passed: "brand",
  interview_scheduled: "brand",
  ai_interview_completed: "brand",
  under_review: "amber",
  shortlisted: "green",
  hr_interview: "brand",
  technical_interview: "brand",
  manager_interview: "brand",
  selected: "green",
  offer_sent: "amber",
  offer_accepted: "green",
  joined: "green",
  rejected: "red",
};

export function normalizeStage(stage) {
  return LEGACY_STAGE_MAP[stage] || stage;
}

export function stageLabel(stage) {
  const s = normalizeStage(stage);
  return STAGE_LABELS[s] || s;
}

export function stageTone(stage) {
  return STAGE_TONES[normalizeStage(stage)] || "slate";
}

export function isRejected(stage) {
  return normalizeStage(stage) === "rejected";
}

// Progress fraction (0..1) along the ordered pipeline; rejected returns 0.
export function stageProgress(stage) {
  const s = normalizeStage(stage);
  if (s === "rejected") return 0;
  const idx = STAGES.indexOf(s);
  if (idx === -1) return 0;
  return (idx + 1) / STAGES.length;
}
