const fs = require("fs/promises");
const path = require("path");
const crypto = require("crypto");
const Resume = require("../models/Resume");
const extractResumeText = require("../utils/extractResumeText");
const { detectFileType } = require("../utils/verifyFileSignature");

const STORAGE_DIR = path.join(__dirname, "..", "uploads", "resume-library");

async function uploadResume(req, res) {
  const { email } = req.body;
  if (!email) {
    return res.status(400).json({ error: "email is required" });
  }
  if (!req.file) {
    return res.status(400).json({ error: "Resume file is required" });
  }

  const { buffer, originalname, size } = req.file;

  const mimetype = detectFileType(buffer);
  if (!mimetype) {
    return res.status(400).json({ error: "File content does not match a valid PDF or DOCX" });
  }

  const checksum = crypto.createHash("sha256").update(buffer).digest("hex");
  const candidateEmail = email.trim().toLowerCase();

  const existing = await Resume.findOne({ candidateEmail, checksum });
  if (existing) {
    return res.status(200).json(existing);
  }

  const { text, status } = await extractResumeText(buffer, mimetype);

  const ext = path.extname(originalname).toLowerCase();
  const storedFileName = `${crypto.randomBytes(16).toString("hex")}${ext}`;
  await fs.mkdir(STORAGE_DIR, { recursive: true });
  const filePath = path.join(STORAGE_DIR, storedFileName);
  await fs.writeFile(filePath, buffer);

  const resume = await Resume.create({
    candidateEmail,
    originalName: originalname,
    storedFileName,
    filePath,
    mimeType: mimetype,
    sizeBytes: size,
    checksum,
    extractedText: text,
    extractionStatus: status,
  });

  res.status(201).json(resume);
}

async function getResume(req, res) {
  const resume = await Resume.findById(req.params.id);
  if (!resume) return res.status(404).json({ error: "Resume not found" });
  res.json(resume);
}

async function downloadResume(req, res) {
  const resume = await Resume.findById(req.params.id);
  if (!resume) return res.status(404).json({ error: "Resume not found" });
  res.download(resume.filePath, resume.originalName);
}

async function listResumeHistory(req, res) {
  const { email } = req.query;
  if (!email) {
    return res.status(400).json({ error: "email query parameter is required" });
  }
  const resumes = await Resume.find({ candidateEmail: email.trim().toLowerCase() })
    .select("-extractedText")
    .sort({ createdAt: -1 });
  res.json(resumes);
}

module.exports = { uploadResume, getResume, downloadResume, listResumeHistory };
