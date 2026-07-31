// Frontend mirror of backend/utils/pipeline.js. Keep the stage keys and order
// in sync with the backend — this drives the pipeline board columns, the
// candidate stage selector, and status badges across the admin app.

export const STAGES = [
  "applied",
  "ats_passed",
  // Opt-in assessment stages: only entered when a recruiter assigns an
  // assessment; the skip path goes ats_passed → interview_scheduled directly.
  "assessment_scheduled",
  "assessment_completed",
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

export const REJECTED = "rejected";

// All selectable stages including the terminal off-ramp.
export const ALL_STAGES = [...STAGES, REJECTED];

export const STAGE_LABELS = {
  applied: "Applied",
  ats_passed: "ATS Passed",
  assessment_scheduled: "Assessment Sent",
  assessment_completed: "Assessment Completed",
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

// Badge tone per stage (tones defined in components/ui/Card Badge).
const STAGE_TONES = {
  applied: "slate",
  ats_passed: "brand",
  assessment_scheduled: "brand",
  assessment_completed: "brand",
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

export const ROUND_STAGES = ["hr_interview", "technical_interview", "manager_interview"];
export const TERMINAL_STAGES = ["joined", "rejected"];

export function isTerminal(stage) {
  return TERMINAL_STAGES.includes(normalizeStage(stage));
}

// Mirror of backend canTransition — keep the rules identical so the UI only
// offers moves the server will accept.
export function canTransition(fromStage, toStage) {
  const from = normalizeStage(fromStage);
  const to = normalizeStage(toStage);
  if (from === to) return false;
  if (isTerminal(from)) return false;
  if (to === REJECTED) return true;
  const fromIdx = STAGES.indexOf(from);
  const toIdx = STAGES.indexOf(to);
  if (fromIdx === -1 || toIdx === -1) return false;
  if (toIdx > fromIdx) return true;
  if (ROUND_STAGES.includes(from) && ROUND_STAGES.includes(to)) return true;
  return false;
}

export function allowedNextStages(fromStage) {
  return ALL_STAGES.filter((s) => canTransition(fromStage, s));
}
