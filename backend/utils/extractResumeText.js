const pdfParse = require("pdf-parse");
const mammoth = require("mammoth");

async function extractResumeText(buffer, mimeType) {
  try {
    let text = "";
    if (mimeType === "application/pdf") {
      const result = await pdfParse(buffer);
      text = result.text || "";
    } else {
      const result = await mammoth.extractRawText({ buffer });
      text = result.value || "";
    }

    text = text.trim();
    return { text, status: text.length > 0 ? "success" : "empty" };
  } catch (err) {
    console.error("Resume text extraction failed:", err.message);
    return { text: "", status: "failed" };
  }
}

module.exports = extractResumeText;
