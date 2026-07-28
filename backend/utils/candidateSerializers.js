// Candidate-facing views of internal documents. Everything the candidate's own
// browser receives goes through here — a raw Candidate or InterviewSession doc
// carries recruiter-only material (ATS internals, the interview evaluation and
// recommendation, proctoring risk, tokenHash, resumeText, hostility report)
// that must never ship to the applicant. Anything not listed here is withheld
// on purpose; add fields deliberately, never by spreading the doc.

// A candidate's view of their own application. Stage history is stages+dates
// only: `by` (admin identity) and `note` (internal remarks) stay server-side.
function toApplicationView(c) {
  return {
    _id: c._id,
    job: c.job,
    status: c.status,
    createdAt: c.createdAt,
    resumeOriginalName: c.resumeOriginalName,
    stageHistory: (c.stageHistory || []).map((h) => ({ stage: h.stage, at: h.at })),
    offer:
      c.offer && c.offer.status !== "none"
        ? { status: c.offer.status, message: c.offer.message, sentAt: c.offer.sentAt, respondedAt: c.offer.respondedAt }
        : undefined,
  };
}

// A candidate's view of their interview session: schedule + coarse progress.
// Never the tokenHash, proctoring state, transcript, or evaluation.
function toSessionView(s) {
  const ai = s.aiInterview;
  return {
    _id: s._id,
    job: s.job,
    status: s.status,
    interviewAt: s.interviewAt,
    expiresAt: s.expiresAt,
    startedAt: s.startedAt,
    completedAt: s.completedAt,
    aiInterview: ai ? { status: ai.status, questionCount: ai.questionCount } : undefined,
  };
}

// Minimal application receipt returned from POST /jobs/:id/apply.
function toApplyReceipt(c, job) {
  return {
    _id: c._id,
    job: job ? { _id: job._id, title: job.title } : c.job,
    status: c.status,
    createdAt: c.createdAt,
  };
}

module.exports = { toApplicationView, toSessionView, toApplyReceipt };
