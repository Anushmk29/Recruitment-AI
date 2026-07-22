const crypto = require("crypto");
const Resume = require("../models/Resume");
const storageService = require("../services/storageService");
const extractResumeText = require("../utils/extractResumeText");
const { detectFileType } = require("../utils/verifyFileSignature");

async function uploadResume(req, res) {
  if (!req.file) {
    return res.status(400).json({ error: "Resume file is required" });
  }

  const { buffer, originalname, size } = req.file;

  const mimetype = detectFileType(buffer);
  if (!mimetype) {
    return res.status(400).json({ error: "File content does not match a valid PDF or DOCX" });
  }

  const checksum = crypto.createHash("sha256").update(buffer).digest("hex");
  // Identity comes from the authenticated account, never from the request body,
  // so a candidate can only ever write to their own resume library.
  const candidateEmail = req.user.email.trim().toLowerCase();

  const existing = await Resume.findOne({ candidateEmail, checksum });
  if (existing) {
    return res.status(200).json(existing);
  }

  const { text, status } = await extractResumeText(buffer, mimetype);

  const key = await storageService.putObject({
    buffer,
    key: storageService.buildKey("resume-library", { originalName: originalname }),
    contentType: mimetype,
  });

  const resume = await Resume.create({
    candidateEmail,
    originalName: originalname,
    storedFileName: key.split("/").pop(),
    filePath: key,
    mimeType: mimetype,
    sizeBytes: size,
    checksum,
    extractedText: text,
    extractionStatus: status,
  });

  res.status(201).json(resume);
}

// Ownership is enforced by scoping the query to the caller's own email, and a
// mismatch returns 404 (not 403) so an attacker can't use this as an oracle to
// confirm which resume ids exist.
async function getResume(req, res) {
  const resume = await Resume.findOne({ _id: req.params.id, candidateEmail: req.user.email });
  if (!resume) return res.status(404).json({ error: "Resume not found" });
  res.json(resume);
}

async function downloadResume(req, res) {
  const resume = await Resume.findOne({ _id: req.params.id, candidateEmail: req.user.email });
  if (!resume) return res.status(404).json({ error: "Resume not found" });
  await storageService.sendDownload(res, resume.filePath, resume.originalName, resume.mimeType);
}

async function listResumeHistory(req, res) {
  const resumes = await Resume.find({ candidateEmail: req.user.email })
    .select("-extractedText")
    .sort({ createdAt: -1 });
  res.json(resumes);
}

module.exports = { uploadResume, getResume, downloadResume, listResumeHistory };
