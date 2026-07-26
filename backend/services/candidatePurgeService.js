// Single source of truth for "everything we hold about a candidate" — used by both the
// nightly retention job (§5.2) and the on-demand DPDP erasure endpoint (data-principal
// right to be forgotten). Deleting a candidate must remove ALL of their PII artifacts,
// so both paths funnel through here to stay in sync as new artifact types are added.
//
// Callers MUST already be in the correct scope: either a system context (retention job)
// or the owning tenant's context (erasure endpoint). Every query below is additionally
// filtered by the candidate's own `company`, so it can never touch another tenant.

const Candidate = require("../models/Candidate");
const InterviewSession = require("../models/InterviewSession");
const InterviewQueue = require("../models/InterviewQueue");
const UsageEvent = require("../models/UsageEvent");
const storageService = require("./storageService");
const evidenceClipService = require("./evidenceClipService");

async function deleteObjectSafe(ref, label) {
  if (!ref) return;
  try {
    await storageService.deleteObject(ref);
  } catch (err) {
    console.error(`[candidatePurge] failed to delete ${label} object ${ref}:`, err.message);
  }
}

// Hard-delete a candidate and all associated artifacts (resume file, identity photo,
// interview session/transcript, queue entry, usage events). Best-effort on storage: a
// failed object delete is logged, not fatal, so a stuck file can't strand DB cleanup.
// Returns a small summary of what was removed.
async function purgeCandidateArtifacts(candidate) {
  const companyId = candidate.company;
  const scope = { company: companyId, candidate: candidate._id };

  const sessions = await InterviewSession.find(scope).select("identityVerification");
  for (const session of sessions) {
    await deleteObjectSafe(session.identityVerification?.photoPath, "identity-photo");
  }
  // Phase 14.4 — evidence clips (rows + stored video objects) die with the
  // candidate, for both DPDP erasure and the nightly retention purge.
  const evidenceClips = await evidenceClipService.purgeForCandidate(companyId, candidate._id);
  const sessionResult = await InterviewSession.deleteMany(scope);
  const queueResult = await InterviewQueue.deleteMany(scope);
  const usageResult = await UsageEvent.deleteMany(scope);

  await deleteObjectSafe(candidate.resumePath, "resume");
  await Candidate.deleteOne({ company: companyId, _id: candidate._id });

  return {
    sessions: sessionResult?.deletedCount || 0,
    queueEntries: queueResult?.deletedCount || 0,
    usageEvents: usageResult?.deletedCount || 0,
    evidenceClips,
    resumeDeleted: Boolean(candidate.resumePath),
  };
}

module.exports = { purgeCandidateArtifacts };
