// Admin AssessmentPaper endpoints (ASSESSMENT-ENGINE-PLAN A1.4 backend).
// Item stems/keys are visible HERE (the recruiter's item-review screen) and
// nowhere candidate-facing — leak control lives at the portal serializers and
// the PDF (§A3.5).

const Job = require("../models/Job");
const AssessmentPaper = require("../models/AssessmentPaper");
const paperService = require("../services/assessmentPaperService");
const itemGenService = require("../services/itemGenService");

async function loadJob(req) {
  const job = await Job.findOne({ _id: req.params.jobId, company: req.user.company });
  if (!job) {
    const err = new Error("Job not found");
    err.status = 404;
    throw err;
  }
  return job;
}

async function compileForJob(req, res) {
  const job = await loadJob(req);
  const paper = await paperService.compileBlueprint(job);
  res.status(201).json(paper);
}

async function getForJob(req, res) {
  const job = await loadJob(req);
  const papers = await paperService.listForJob(job._id, req.user.company);
  res.json(papers);
}

async function getPaper(req, res) {
  const paper = await AssessmentPaper.findOne({ _id: req.params.id, company: req.user.company });
  if (!paper) return res.status(404).json({ error: "Assessment paper not found" });
  res.json(paper);
}

async function updatePaper(req, res) {
  const paper = await paperService.updateDraft(req.params.id, req.user.company, req.body || {});
  res.json(paper);
}

// Long-running (N items × 1 gen + 3 blind solves). Fires the run and returns
// 202 — the editor polls GET /:id and renders paper.generationRun.
async function generateItems(req, res) {
  const paper = await AssessmentPaper.findOne({ _id: req.params.id, company: req.user.company });
  if (!paper) return res.status(404).json({ error: "Assessment paper not found" });
  if (paper.status !== "draft") return res.status(409).json({ error: "Items can only be generated on a draft paper" });
  if (paper.generationRun?.status === "running") return res.status(409).json({ error: "Generation is already running" });

  const companyId = req.user.company;
  const paperId = paper._id;
  // Detached on purpose; errors land on paper.generationRun for the poller.
  itemGenService.runGeneration(paperId, companyId).catch((err) => {
    console.error(`[itemGen] background run failed for paper ${paperId}: ${err.message}`);
  });

  res.status(202).json({ started: true });
}

async function regenerateItem(req, res) {
  const paper = await itemGenService.regenerateItem(req.params.id, req.user.company, req.params.itemId);
  res.json(paper);
}

// A5.2 — retire an item (the one item mutation a FROZEN paper permits; excluded
// from future assembly only, in-flight sessions unaffected).
async function retireItem(req, res) {
  const paper = await AssessmentPaper.findOne({ _id: req.params.id, company: req.user.company });
  if (!paper) return res.status(404).json({ error: "Assessment paper not found" });
  const item = paper.items.find((i) => i.id === req.params.itemId);
  if (!item) return res.status(404).json({ error: "Item not found" });
  if (item.status === "retired") return res.json(paper);
  item.status = "retired";
  paper.markModified("items");
  await paper.save();
  res.json(paper);
}

async function approvePaper(req, res) {
  const paper = await paperService.approve(req.params.id, req.user.company, req.user);
  res.json(paper);
}

module.exports = { compileForJob, getForJob, getPaper, updatePaper, generateItems, regenerateItem, retireItem, approvePaper };
