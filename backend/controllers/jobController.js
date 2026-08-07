const Job = require("../models/Job");
const { generateJobSlug } = require("../utils/slug");
const rubricService = require("../services/rubricService");
const { sourceHashOf } = require("../utils/rubricEngine");

async function createJob(req, res) {
  // Plan quota (Phase 11.1): job postings block at the plan boundary with a
  // machine-readable 429 — never a silent failure.
  await require("../services/quotaService").enforce(req.user.company, "jobs", { actor: req.user });

  const { slug, ...body } = req.body;
  const job = await Job.create({ ...body, company: req.user.company, slug: generateJobSlug(body.title) });

  // Compile a draft rubric the moment the JD exists — nothing else in the product
  // prompts a recruiter to visit the Scoring Rubric screen, so without this a job
  // can go live and collect candidates while permanently stuck at rubricStatus
  // "none" (candidates silently scored by the legacy keyword engine forever).
  // Fire-and-forget, same pattern as updateJob's supersede call: a draft still
  // requires a human to review and approve — this only ensures one exists to review.
  rubricService
    .compile(job)
    .then((draft) => console.log(`[rubric] auto-compiled draft v${draft.version} for new job ${job._id}`))
    .catch((err) => console.error(`[rubric] auto-compile failed for new job ${job._id}:`, err.code || err.message));

  res.status(201).json(job);
}

async function listJobs(req, res) {
  const jobs = await Job.find({ company: req.user.company }).sort({ createdAt: -1 }).lean();
  // Every job the recruiter sees carries its rubric-approval state, so an
  // unapproved rubric (⇒ candidates silently fall back to the legacy keyword
  // engine, see evidenceAtsService.js) is visible on the jobs list itself
  // instead of only discoverable candidate-by-candidate.
  const statusByJob = await rubricService.latestStatusesForJobs(
    jobs.map((j) => j._id),
    req.user.company
  );
  const withRubricStatus = jobs.map((j) => ({
    ...j,
    rubricStatus: statusByJob.get(String(j._id)) || "none",
  }));
  res.json(withRubricStatus);
}

async function listPublishedJobs(req, res) {
  const jobs = await Job.find({ status: "published" }).populate("company", "name").sort({ createdAt: -1 });
  res.json(jobs);
}

async function getJob(req, res) {
  const job = await Job.findByIdOrSlug(req.params.id);
  if (!job) return res.status(404).json({ error: "Job not found" });
  // Public callers may only see PUBLISHED jobs. An authenticated admin of the owning
  // company may see it at any status (for editing drafts). Without this, draft/closed
  // postings — including atsThreshold and interview instructions — leak to anyone by
  // guessable slug (tenant-isolation defect F1).
  const isOwningAdmin =
    req.user &&
    req.user.role === "admin" &&
    req.user.company &&
    String(job.company) === String(req.user.company);
  if (job.status !== "published" && !isOwningAdmin) {
    return res.status(404).json({ error: "Job not found" });
  }
  await job.populate("company", "name");
  const payload = job.toObject();
  // Rubric-approval state is only meaningful (and only ours to disclose) to the
  // owning admin — public candidate-portal callers never see it.
  if (isOwningAdmin) {
    payload.rubricStatus = await rubricService.latestStatusForJob(job._id, req.user.company);
  }
  res.json(payload);
}

async function updateJob(req, res) {
  const { company, ...updates } = req.body;
  const job = await Job.findOne({ _id: req.params.id, company: req.user.company });
  if (!job) return res.status(404).json({ error: "Job not found" });

  // If the edit changed the JD content, any existing rubric is now compiled from
  // stale text — supersede() drafts a new version (the old approved one stays
  // active, and historical scores keep pointing at it, until a human approves
  // the successor). Fire-and-forget: rubric compilation must not block the save.
  const hashBefore = sourceHashOf(job);
  const wasPublished = job.status === "published";
  Object.assign(job, updates);
  await job.save();

  // Lifecycle sync (Phase 15.8): un-publishing a job withdraws it from every
  // board it went to. Fire-and-forget — board round-trips must not block the save.
  if (wasPublished && job.status !== "published") {
    require("../services/jobPublishService")
      .withdrawAllForJob(job._id, req.user.company, `status → ${job.status}`)
      .catch((err) => console.error(`[publish] withdraw-all failed for job ${job._id}:`, err.message));
  }
  if (sourceHashOf(job) !== hashBefore) {
    rubricService
      .supersede(job)
      .then((draft) => {
        if (draft) console.log(`[rubric] JD edit superseded rubric for job ${job._id} — draft v${draft.version} awaiting review`);
      })
      .catch((err) => console.error(`[rubric] supersede failed for job ${job._id}:`, err.message));
  }
  res.json(job);
}

async function publishJob(req, res) {
  const job = await Job.findOneAndUpdate(
    { _id: req.params.id, company: req.user.company },
    { status: "published" },
    { new: true }
  );
  if (!job) return res.status(404).json({ error: "Job not found" });
  res.json(job);
}

async function deleteJob(req, res) {
  const job = await Job.findOneAndDelete({ _id: req.params.id, company: req.user.company });
  if (!job) return res.status(404).json({ error: "Job not found" });
  // Review items for this job can no longer be resolved — `resolveItem` needs
  // the job to advance anyone into its interview loop, and "advance to an
  // interview for a role that was deleted" is not a decision. Left behind they
  // sit in the queue forever asking a recruiter to make it.
  await require("../models/ReviewItem").deleteMany({ company: req.user.company, job: job._id });
  // Lifecycle sync (Phase 15.8): a deleted job is withdrawn from every board.
  require("../services/jobPublishService")
    .withdrawAllForJob(job._id, req.user.company, "job deleted")
    .catch((err) => console.error(`[publish] withdraw-all failed for job ${job._id}:`, err.message));
  res.status(204).send();
}

// ---------------------------------------------------------------------------
// Phase 15 — multi-board publishing
// ---------------------------------------------------------------------------

// GET /api/jobs/:id/publications — per-board status for the publish UI: the
// driver list (with tier + availability) merged with this job's PublishedJob rows.
async function listPublications(req, res) {
  const job = await Job.findOne({ _id: req.params.id, company: req.user.company });
  if (!job) return res.status(404).json({ error: "Job not found" });

  const { listDrivers } = require("../services/connectors");
  const PublishedJob = require("../models/PublishedJob");
  const boardCredentialService = require("../services/boardCredentialService");

  const rows = await PublishedJob.find({ company: req.user.company, job: job._id }).lean();
  const byBoard = Object.fromEntries(rows.map((r) => [r.board, r]));

  const boards = [];
  for (const d of listDrivers()) {
    const credential = d.needsCredential ? await boardCredentialService.status(req.user.company, d.key) : null;
    const row = byBoard[d.key];
    boards.push({
      board: d.key,
      name: d.name,
      tier: d.tier,
      enabled: d.enabled,
      reason: d.reason,
      needsCredential: d.needsCredential,
      credentialConfigured: credential ? credential.configured : true,
      validationErrors: d.enabled ? require("../services/connectors").getDriver(d.key).validate(job) : [],
      status: row?.status || null,
      externalUrl: row?.externalUrl || null,
      error: row?.error || null,
      publishedAt: row?.publishedAt || null,
      lastSyncedAt: row?.lastSyncedAt || null,
    });
  }
  res.json({ boards });
}

// POST /api/jobs/:id/publish-boards  body: { boards: ["careers", "naukri", …] }
async function publishBoards(req, res) {
  const job = await Job.findOne({ _id: req.params.id, company: req.user.company });
  if (!job) return res.status(404).json({ error: "Job not found" });
  if (job.status !== "published") {
    return res.status(400).json({ error: "Publish the job in the ATS first — boards only receive published jobs" });
  }
  const boards = Array.isArray(req.body?.boards) ? req.body.boards.slice(0, 20) : [];
  if (!boards.length) return res.status(400).json({ error: "boards is required" });

  const results = await require("../services/jobPublishService").publishToBoards(job, boards, req.user);
  res.json({ results });
}

// POST /api/jobs/:id/withdraw-board  body: { board }
async function withdrawBoard(req, res) {
  const job = await Job.findOne({ _id: req.params.id, company: req.user.company });
  if (!job) return res.status(404).json({ error: "Job not found" });
  const PublishedJob = require("../models/PublishedJob");
  const row = await PublishedJob.findOne({ company: req.user.company, job: job._id, board: String(req.body?.board || "").toLowerCase() });
  if (!row) return res.status(404).json({ error: "This job is not published on that board" });
  await require("../services/jobPublishService").processPublication(row._id, "withdraw");
  res.json({ ok: true });
}

module.exports = {
  createJob,
  listJobs,
  listPublishedJobs,
  getJob,
  updateJob,
  publishJob,
  deleteJob,
  listPublications,
  publishBoards,
  withdrawBoard,
};
