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
    // Resumes uploaded before span-addressable ingest shipped have no textHash /
    // pageBreaks / artifacts, so autofill could not run the defense pass on them.
    // Backfill from the bytes we already have in hand rather than leaving a
    // silently second-class resume in the library.
    if (!existing.textHash && existing.extractedText) {
      const ingest = await extractResumeText(buffer, mimetype);
      applyIngest(existing, ingest);
      await existing.save();
    }
    return res.status(200).json(existing);
  }

  const ingest = await extractResumeText(buffer, mimetype);

  const key = await storageService.putObject({
    buffer,
    key: storageService.buildKey("resume-library", { originalName: originalname }),
    contentType: mimetype,
  });

  const resume = new Resume({
    candidateEmail,
    originalName: originalname,
    storedFileName: key.split("/").pop(),
    filePath: key,
    mimeType: mimetype,
    sizeBytes: size,
    checksum,
  });
  applyIngest(resume, ingest);
  await resume.save();

  res.status(201).json(resume);
}

// Copy one extraction result onto a Resume doc. The canonical text and its
// derived coordinates (textHash, pageBreaks) always move together — a text
// change with stale pageBreaks would put every downstream span in the wrong place.
function applyIngest(resume, ingest) {
  resume.extractedText = ingest.text;
  resume.textHash = ingest.text ? crypto.createHash("sha256").update(ingest.text, "utf8").digest("hex") : "";
  resume.pageBreaks = ingest.pageBreaks || [];
  resume.artifacts = ingest.artifacts || {};
  resume.extractionStatus = ingest.status;
  // The cached suggestions describe the OLD text. Drop them rather than serve a
  // parse of a document this resume no longer holds.
  resume.autofill = undefined;
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
  // The full text and the cached suggestion payload are both large and neither
  // is used by a list view — fetch them per-resume, not per-page.
  const resumes = await Resume.find({ candidateEmail: req.user.email })
    .select("-extractedText -autofill")
    .sort({ createdAt: -1 });
  res.json(resumes);
}

module.exports = { uploadResume, getResume, downloadResume, listResumeHistory };
