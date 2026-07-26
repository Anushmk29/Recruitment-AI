// Hiring-pipeline orchestration (Module 11). Validates stage transitions,
// records the append-only stage history, keeps the offer sub-document in sync,
// and fans out notifications + realtime socket updates to both the admin and
// the candidate. Controllers should go through here rather than mutating
// `candidate.status` directly, so validation, history, and notifications stay
// consistent.

const User = require("../models/User");
const { notifyCandidate, notifyAdmin } = require("./notificationService");
const { emitToCandidateUser, emitToCompany } = require("../config/socket");
const {
  canTransition,
  normalizeStage,
  isValidStage,
  stageLabel,
  appendStageHistory,
  ROUND_STAGES,
} = require("../utils/pipeline");

// Per-stage notification config. `candidate`/`admin` describe the in-app +
// email notifications fired when a candidate ENTERS that stage. `email` (when
// present) names an emailTemplates key and how to build its args.
const STAGE_NOTIFICATIONS = {
  ai_interview_completed: {
    candidate: { type: "interview_completed", title: "AI interview completed" },
    admin: { type: "interview_completed", title: "AI interview completed" },
  },
  under_review: {
    candidate: { type: "stage_changed", title: "Your application is under review" },
    admin: { type: "candidate_stage_changed", title: "Candidate under review" },
  },
  shortlisted: {
    candidate: { type: "next_round_scheduled", title: "You've been shortlisted", email: "stageUpdate" },
    admin: { type: "candidate_shortlisted", title: "Candidate shortlisted" },
  },
  hr_interview: {
    candidate: { type: "next_round_scheduled", title: "HR interview scheduled", email: "stageUpdate" },
    admin: { type: "candidate_stage_changed", title: "HR interview scheduled" },
  },
  technical_interview: {
    candidate: { type: "next_round_scheduled", title: "Technical interview scheduled", email: "stageUpdate" },
    admin: { type: "candidate_stage_changed", title: "Technical interview scheduled" },
  },
  manager_interview: {
    candidate: { type: "next_round_scheduled", title: "Manager interview scheduled", email: "stageUpdate" },
    admin: { type: "candidate_stage_changed", title: "Manager interview scheduled" },
  },
  selected: {
    candidate: { type: "stage_changed", title: "You've been selected", email: "stageUpdate" },
    admin: { type: "candidate_selected", title: "Candidate selected" },
  },
  offer_sent: {
    candidate: { type: "offer_letter", title: "You've received an offer", email: "offer" },
    admin: { type: "candidate_stage_changed", title: "Offer sent to candidate" },
  },
  offer_accepted: {
    candidate: { type: "offer_accepted", title: "Offer accepted" },
    admin: { type: "offer_accepted", title: "Candidate accepted the offer" },
  },
  joined: {
    candidate: { type: "joined", title: "Welcome aboard!", email: "stageUpdate" },
    admin: { type: "candidate_joined", title: "Candidate joined" },
  },
  rejected: {
    candidate: { type: "rejection", title: "Application update", email: "rejection" },
    admin: { type: "candidate_rejected", title: "Candidate rejected" },
  },
};

const DEFAULT_NOTIFICATION = {
  candidate: { type: "stage_changed", title: "Application status updated" },
  admin: { type: "candidate_stage_changed", title: "Candidate stage updated" },
};

function buildCandidateEmail(emailKind, candidate, job, label, note) {
  if (!emailKind) return undefined;
  const to = candidate.basicDetails.email;
  if (emailKind === "offer") {
    return { to, template: "offerLetterEmailTemplate", args: [candidate, job, candidate.offer || {}] };
  }
  if (emailKind === "rejection") {
    return { to, template: "rejectionEmailTemplate", args: [candidate, job] };
  }
  // Generic milestone update.
  return { to, template: "stageUpdateEmailTemplate", args: [candidate, job, label, note] };
}

// Keeps the offer sub-document coherent with the pipeline stage.
function syncOffer(candidate, toStage, offerMessage) {
  if (toStage === "offer_sent") {
    candidate.offer = { status: "sent", message: offerMessage || candidate.offer?.message, sentAt: new Date() };
  } else if (toStage === "offer_accepted") {
    candidate.offer = { ...(candidate.offer?.toObject?.() || candidate.offer || {}), status: "accepted", respondedAt: new Date() };
  } else if (toStage === "rejected" && candidate.offer?.status === "sent") {
    candidate.offer.status = "declined";
    candidate.offer.respondedAt = new Date();
  }
}

/**
 * Apply a stage transition to an already-loaded Candidate document.
 * Mutates, validates, saves, and fires notifications + socket events.
 *
 * @param {object} candidate  Mongoose Candidate doc (job populated for nice copy)
 * @param {string} toStage    target stage key
 * @param {object} opts       { note, actorName, offerMessage }
 * @throws {Error} on invalid stage or disallowed transition (surfaced as 400 by the global handler)
 * @returns {Promise<object>} the saved candidate
 */
async function applyTransition(candidate, toStage, { note, actorName, offerMessage } = {}) {
  const target = normalizeStage(toStage);
  const from = normalizeStage(candidate.status);

  if (!isValidStage(target)) {
    const err = new Error(`Unknown pipeline stage: ${toStage}`);
    err.status = 400;
    throw err;
  }
  if (!canTransition(from, target)) {
    const err = new Error(`Cannot move a candidate from "${stageLabel(from)}" to "${stageLabel(target)}".`);
    err.status = 400;
    throw err;
  }

  candidate.status = target;
  appendStageHistory(candidate, target, { note, by: actorName || "system" });
  syncOffer(candidate, target, offerMessage);
  await candidate.save();

  // Outcome capture (Phase 10.1): joins this candidate's engine score to what
  // actually happened, feeding the nightly calibration. Fire-and-forget — a
  // metering failure must never block a stage move.
  require("./scoreOutcomeService")
    .recordTransition(candidate, target, { by: actorName || "system" })
    .catch(() => {});

  await dispatchStageNotifications(candidate, target, note);
  emitStageUpdate(candidate);

  return candidate;
}

async function dispatchStageNotifications(candidate, toStage, note) {
  const config = STAGE_NOTIFICATIONS[toStage] || DEFAULT_NOTIFICATION;
  const job = candidate.job && candidate.job.title ? candidate.job : null;
  const jobTitle = job?.title || "the role";
  const label = stageLabel(toStage);
  const candidateName = candidate.basicDetails.name;

  if (config.admin) {
    await notifyAdmin({
      companyId: candidate.company,
      type: config.admin.type,
      title: config.admin.title,
      message: `${candidateName}'s application for ${jobTitle} moved to "${label}".`,
      meta: { candidateId: candidate._id, stage: toStage },
    });
  }

  if (config.candidate) {
    const applicantUser = await User.findOne({ email: candidate.basicDetails.email, role: "candidate" });
    await notifyCandidate({
      candidateId: candidate._id,
      userId: applicantUser?._id,
      type: config.candidate.type,
      title: config.candidate.title,
      message: `Your application for ${jobTitle} is now: ${label}.${note ? ` ${note}` : ""}`,
      meta: { jobId: candidate.job?._id || candidate.job, stage: toStage },
      email: job ? buildCandidateEmail(config.candidate.email, candidate, job, label, note) : undefined,
    });
  }
}

// Dedicated realtime event (separate from notification:new) so both dashboards
// can live-update a status tracker / pipeline board without a page refresh.
function emitStageUpdate(candidate) {
  const payload = {
    candidateId: String(candidate._id),
    status: candidate.status,
    stageHistory: candidate.stageHistory,
    offer: candidate.offer,
    jobId: String(candidate.job?._id || candidate.job || ""),
  };
  emitToCompany(candidate.company, "candidate:stage", payload);

  // Candidate-side push is only possible for registered accounts.
  User.findOne({ email: candidate.basicDetails.email, role: "candidate" })
    .then((user) => {
      if (user) emitToCandidateUser(user._id, "candidate:stage", payload);
    })
    .catch(() => {});
}

module.exports = { applyTransition, ROUND_STAGES };
