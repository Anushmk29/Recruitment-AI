const path = require("path");
const multer = require("multer");

// Memory storage so the file buffer can be handed to storageService (S3/MinIO in
// production, local disk in dev). Avoids the multi-instance defect where a file
// written to one instance's local disk is invisible to the others.
const allowedTypes = new Set([".pdf", ".doc", ".docx"]);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!allowedTypes.has(path.extname(file.originalname).toLowerCase())) {
      return cb(new Error("Only PDF, DOC, or DOCX resumes are allowed"));
    }
    cb(null, true);
  },
});

module.exports = upload;
