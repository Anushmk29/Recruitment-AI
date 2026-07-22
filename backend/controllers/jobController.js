const Job = require("../models/Job");
const { generateJobSlug } = require("../utils/slug");

async function createJob(req, res) {
  const { slug, ...body } = req.body;
  const job = await Job.create({ ...body, company: req.user.company, slug: generateJobSlug(body.title) });
  res.status(201).json(job);
}

async function listJobs(req, res) {
  const jobs = await Job.find({ company: req.user.company }).sort({ createdAt: -1 });
  res.json(jobs);
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
  res.json(job);
}

async function updateJob(req, res) {
  const { company, ...updates } = req.body;
  const job = await Job.findOneAndUpdate({ _id: req.params.id, company: req.user.company }, updates, { new: true });
  if (!job) return res.status(404).json({ error: "Job not found" });
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
  res.status(204).send();
}

module.exports = {
  createJob,
  listJobs,
  listPublishedJobs,
  getJob,
  updateJob,
  publishJob,
  deleteJob,
};
