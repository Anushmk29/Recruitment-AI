import { useEffect, useState } from "react";
import { FileText, UploadCloud, Download } from "lucide-react";
import api from "../api/client.js";
import { accountAuthHeader } from "../auth/accountAuth.js";
import { Card, EmptyState } from "../components/ui/Card.jsx";
import { Label, FormGroup } from "../components/ui/Field.jsx";
import Button from "../components/ui/Button.jsx";

const STATUS_LABEL = {
  success: "Text extracted",
  empty: "No extractable text found",
  failed: "Extraction failed",
};

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function ResumeUpload() {
  const [file, setFile] = useState(null);
  const [status, setStatus] = useState("idle");
  const [error, setError] = useState("");
  const [history, setHistory] = useState([]);
  const [loaded, setLoaded] = useState(false);

  // The resume library is scoped server-side to the logged-in account, so there
  // is no email to type — just load this candidate's own history on mount.
  async function loadHistory() {
    try {
      const res = await api.get("/resumes/history", { headers: accountAuthHeader() });
      setHistory(res.data);
    } catch (err) {
      setError(err.response?.data?.error || "Could not load your resume history");
    } finally {
      setLoaded(true);
    }
  }

  useEffect(() => {
    loadHistory();
  }, []);

  async function handleUpload(e) {
    e.preventDefault();
    if (!file) {
      setError("Please choose a PDF or DOCX file");
      return;
    }
    setError("");
    setStatus("uploading");

    const data = new FormData();
    data.append("resume", file);

    try {
      await api.post("/resumes", data, {
        headers: { "Content-Type": "multipart/form-data", ...accountAuthHeader() },
      });
      setStatus("uploaded");
      setFile(null);
      await loadHistory();
    } catch (err) {
      setError(err.response?.data?.error || "Upload failed");
      setStatus("idle");
    }
  }

  // Downloads go through axios (not a bare <a href>) so the bearer token is sent;
  // the response is streamed to a temporary object URL and clicked.
  async function handleDownload(resume) {
    setError("");
    try {
      const res = await api.get(`/resumes/${resume._id}/download`, {
        headers: accountAuthHeader(),
        responseType: "blob",
      });
      const url = URL.createObjectURL(res.data);
      const link = document.createElement("a");
      link.href = url;
      link.download = resume.originalName || "resume";
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch {
      setError("Download failed");
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">My Resumes</h1>
        <p className="mt-1 text-sm text-slate-500">Upload your resume as a PDF or DOCX. We keep a history of every version.</p>
      </div>

      <Card>
        <form onSubmit={handleUpload}>
          {error && <p className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm font-medium text-red-700">{error}</p>}
          {status === "uploaded" && (
            <p className="mb-4 rounded-lg bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-700">Resume uploaded successfully.</p>
          )}
          <FormGroup>
            <Label required>Resume File</Label>
            <label className="flex cursor-pointer items-center gap-2 rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-3 text-sm text-slate-600 hover:border-brand-400">
              <UploadCloud className="h-4 w-4 text-slate-400" />
              {file ? file.name : "Choose a PDF or DOCX file"}
              <input type="file" accept=".pdf,.docx" className="hidden" onChange={(e) => setFile(e.target.files[0])} required />
            </label>
          </FormGroup>
          <Button type="submit" loading={status === "uploading"}>
            Upload Resume
          </Button>
        </form>
      </Card>

      {loaded && (
        <div>
          <h3 className="mb-3 text-base font-semibold text-slate-900">Resume History</h3>
          {history.length === 0 ? (
            <Card>
              <EmptyState icon={FileText} title="No resumes uploaded yet" description="Resumes you upload will show up here." />
            </Card>
          ) : (
            <div className="space-y-3">
              {history.map((r) => (
                <Card key={r._id} className="flex items-center justify-between">
                  <div>
                    <p className="font-semibold text-slate-800">{r.originalName}</p>
                    <p className="mt-1 text-xs text-slate-400">
                      {formatSize(r.sizeBytes)} · Uploaded {new Date(r.createdAt).toLocaleString()} ·{" "}
                      {STATUS_LABEL[r.extractionStatus] || r.extractionStatus}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleDownload(r)}
                    className="flex items-center gap-1.5 text-sm font-semibold text-brand-700 hover:underline"
                  >
                    <Download className="h-4 w-4" /> Download
                  </button>
                </Card>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
