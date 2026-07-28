// ATS orchestration. Three engine modes (BUILD-PLAN Phase 6.5), selected per
// tenant (CompanySettings.ai.atsEngine) with ATS_ENGINE as the fleet default:
//
//   legacy — deterministic keyword engine only (today's behaviour).
//   shadow — behave on legacy; ALSO run the evidence engine and persist its
//            assessment for comparison. Divergences are counted, behaviour
//            never changes. This is the mandatory soak before "live".
//   live   — the evidence engine drives the decision; legacy remains the
//            LABELLED fallback for any failure (engine: "fallback-legacy").
//
// Regardless of engine: the review band routes to the human queue and NEVER
// auto-rejects — auto-reject stays opt-in and applies only to explicit fails.

const crypto = require("crypto");
const InterviewQueue = require("../models/InterviewQueue");
const User = require("../models/User");
const CompanySettings = require("../models/CompanySettings");
const ReviewItem = require("../models/ReviewItem");
const storageService = require("./storageService");
const extractResumeText = require("../utils/extractResumeText");
const { detectFileType } = require("../utils/verifyFileSignature");
const { computeAtsScore } = require("../utils/atsEngine");
const { createInterviewSessionIfNeeded } = require("./interviewInvitationService");
const { notifyAdmin, notifyCandidate } = require("./notificationService");
const { appendStageHistory } = require("../utils/pipeline");
const resumeDefenseService = require("./resumeDefenseService");
const evidenceAtsService = require("./evidenceAtsService");
const metrics = require("../utils/metrics");

metrics.registerMetric("ats_shadow_divergence_total", "counter", "Shadow runs where evidence and legacy disagree");

function sha256(str) {
  return crypto.createHash("sha256").update(str, "utf8").digest("hex");
}

const EMPTY_INGEST = { text: "", blocks: [], artifacts: { invisibleChars: 0, controlChars: 0 }, status: "failed" };

async function getResumeIngest(candidate) {
  let buffer;
  try {
    buffer = await storageService.getObjectBuffer(candidate.resumePath);
  } catch (err) {
    console.error("Could not read resume file for ATS scoring:", err.message);
    return EMPTY_INGEST;
  }

  let mimeType = detectFileType(buffer);
  if (!mimeType) {
    // Legacy .doc uploads (pre-dating magic-byte detection) aren't a supported
    // extraction format; fall back to extension so scoring still runs on
    // structured fields even though resume text will be empty.
    return EMPTY_INGEST;
  }

  return extractResumeText(buffer, mimeType);
}

// The ATS-pass side effects, shared with the review queue's "advance"
// resolution so a human decision produces exactly the machine-pass pathway.
async function advanceAfterAtsPass(candidate, job, score) {
  if (candidate.status === "applied") {
    appendStageHistory(candidate, "ats_passed");
    candidate.status = "interview_scheduled";
    appendStageHistory(candidate, "interview_scheduled");
  }
  await InterviewQueue.findOneAndUpdate(
    { candidate: candidate._id },
    { candidate: candidate._id, job: job._id, company: job.company, atsScore: score, status: "queued" },
    { upsert: true, new: true }
  );
  await createInterviewSessionIfNeeded(candidate, job);
}

async function openReviewItem(candidate, job, assessment, reasons, summary) {
  try {
    await ReviewItem.findOneAndUpdate(
      { company: job.company, candidate: candidate._id, status: "open" },
      {
        $setOnInsert: { candidate: candidate._id, job: job._id, company: job.company, status: "open" },
        $set: {
          assessment: assessment?._id,
          reasons,
          summary,
          label: assessment
            ? { engineScore: assessment.overallScore, engineBand: assessment.band }
            : undefined,
        },
      },
      { upsert: true }
    );
  } catch (err) {
    console.error("Could not open review item:", err.message);
  }
}

async function runAtsForCandidate(candidate, job) {
  const ingest = await getResumeIngest(candidate);
  const resumeText = ingest.text;
  candidate.resumeText = resumeText;
  candidate.resumeHash = resumeText ? sha256(resumeText) : "";

  // A resume that produced no readable text means every text-based component
  // scores blind. That must never be silent: the admin is told the score below
  // is form-fields-only, instead of a legitimate candidate quietly bottoming
  // out with no signal to anyone.
  if (!resumeText) {
    await notifyAdmin({
      companyId: job.company,
      type: "system_alert",
      title: "Resume could not be read",
      message:
        `No text could be extracted from ${candidate.basicDetails.name}'s resume ` +
        `(${candidate.resumeOriginalName || "file"}). Their screening score is based on the application form only — ` +
        `consider asking them to re-upload a PDF or DOCX before acting on it.`,
      meta: { candidateId: candidate._id, jobId: job._id, ingestStatus: ingest.status },
    }).catch((err) => console.error("Could not send resume-extraction alert:", err.message));
  }

  // Phase 4: every résumé is treated as hostile input. The report FLAGS, it
  // never decides — nothing below branches on it, it is surfaced to the admin.
  candidate.hostility = resumeDefenseService.analyze(ingest);

  const legacyResult = computeAtsScore(job, candidate, resumeText);
  const settings = await CompanySettings.findOne({ company: job.company }).select("compliance ai");
  const engineMode = evidenceAtsService.resolveEngineMode(settings);

  let effective = { ...legacyResult, engine: "legacy" };
  let assessment = null;

  if (engineMode === "shadow" || engineMode === "live") {
    try {
      assessment = await evidenceAtsService.runEvidenceAssessment(candidate, job, {
        mode: engineMode === "live" ? "live" : "shadow",
      });

      if (engineMode === "live") {
        effective = {
          ...legacyResult, // legacy component fields stay for old screens
          overallScore: assessment.overallScore,
          threshold: assessment.thresholds?.advance ?? legacyResult.threshold,
          decision: assessment.decision, // pass | review | fail
          scoredAt: assessment.scoredAt,
          engine: "evidence",
        };
      } else {
        // Shadow soak: count decision-level divergence, change nothing.
        const legacyPass = legacyResult.decision === "pass";
        const evidencePass = assessment.decision === "pass";
        if (legacyPass !== evidencePass || assessment.decision === "review") {
          metrics.incCounter("ats_shadow_divergence_total", {
            legacy: legacyResult.decision,
            evidence: assessment.decision,
          });
        }
      }
    } catch (err) {
      if (err.code === "INVARIANT_VIOLATION") {
        // Pipeline unsound: hard fallback + page an operator. This is an
        // engineering incident, never a candidate outcome.
        console.error(`[ats] INVARIANT VIOLATION for candidate ${candidate._id}: ${err.message}`);
        await notifyAdmin({
          companyId: job.company,
          type: "system_alert",
          title: "Evidence engine invariant violation — legacy engine used",
          message:
            `Scoring pipeline failed an internal soundness check for ${candidate.basicDetails.name} and fell back to the ` +
            `deterministic engine. Engineering has been signalled; no automated decision was made by the broken path.`,
          meta: { candidateId: candidate._id, jobId: job._id, violations: err.violations || [] },
        });
      } else if (err.code !== "NO_APPROVED_RUBRIC" && err.code !== "CLAIM_ENGINE_DISABLED") {
        console.warn(`[ats] evidence engine unavailable for candidate ${candidate._id} (${err.code || err.message}); using legacy`);
      }
      if (engineMode === "live") effective = { ...legacyResult, engine: "fallback-legacy" };
    }
  }

  candidate.ats = effective;

  let reviewNeeded = false;

  if (effective.decision === "pass") {
    // Guarded on "applied" so an ATS rerun on an already advanced candidate
    // doesn't re-stamp the timeline. ATS sends its own notifications, so this
    // does not route through pipelineService (which would double-notify).
    await advanceAfterAtsPass(candidate, job, effective.overallScore);
  } else if (effective.decision === "review") {
    // The honest middle band: a human decides. Never auto-rejected, regardless
    // of tenant settings.
    reviewNeeded = true;
    await openReviewItem(
      candidate,
      job,
      assessment,
      [assessment?.reviewReason || "score_in_review_band", ...(assessment?.qa?.reasons || [])],
      `Score ${effective.overallScore} landed in the review band for ${job.title}.`
    );
  } else {
    // Automated rejection is a fair-hiring / legal-exposure decision. Only auto-reject
    // (and email the candidate) when the tenant has explicitly opted in; otherwise keep
    // a human in the loop — leave the candidate in place and flag it for admin review.
    const autoReject = settings?.compliance?.autoRejectAllowed === true;

    if (autoReject) {
      if (candidate.status !== "rejected") {
        appendStageHistory(candidate, "rejected", { note: `ATS score ${effective.overallScore} below threshold (auto-reject)` });
      }
      candidate.status = "rejected";
      const applicantUser = await User.findOne({ email: candidate.basicDetails.email, role: "candidate" });
      await notifyCandidate({
        candidateId: candidate._id,
        userId: applicantUser?._id,
        type: "rejection",
        title: "Application update",
        message: `Thank you for applying for ${job.title}. We will not be moving forward at this time.`,
        meta: { jobId: job._id },
        email: { to: candidate.basicDetails.email, template: "rejectionEmailTemplate", args: [candidate, job] },
      });
    } else {
      // Human-in-the-loop: no status change, no candidate email — the admin decides.
      // A fail is exactly as invisible as a review-band score if it only fires a
      // notification (easy to miss in a bell icon); it gets the same Review Queue
      // treatment so every non-pass outcome the system won't auto-act on lands in
      // one visible place, not scattered between a queue and a notification list.
      reviewNeeded = true;
      await openReviewItem(
        candidate,
        job,
        assessment,
        [assessment?.reviewReason || "score_below_threshold", ...(assessment?.qa?.reasons || [])],
        `Score ${effective.overallScore} was below threshold for ${job.title} — auto-reject is off, a human decides.`
      );
    }
  }

  await notifyAdmin({
    companyId: job.company,
    type: "ats_completed",
    title: reviewNeeded
      ? effective.decision === "review"
        ? "ATS routed a candidate to human review"
        : "ATS below threshold — needs review"
      : "ATS screening completed",
    message: reviewNeeded
      ? effective.decision === "review"
        ? `${candidate.basicDetails.name}'s screening for ${job.title} scored ${effective.overallScore} — in the review band. Please decide in the review queue.`
        : `${candidate.basicDetails.name}'s ATS score for ${job.title} was ${effective.overallScore} (below threshold). Auto-reject is off — please review and decide.`
      : `${candidate.basicDetails.name}'s ATS screening for ${job.title} completed with a score of ${effective.overallScore} (${effective.decision}).`,
    meta: {
      candidateId: candidate._id,
      jobId: job._id,
      score: effective.overallScore,
      decision: effective.decision,
      reviewNeeded,
      engine: effective.engine,
    },
  });

  await candidate.save();
  return candidate;
}

module.exports = { runAtsForCandidate, advanceAfterAtsPass };
