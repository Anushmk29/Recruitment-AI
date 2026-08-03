import { useEffect, useState } from "react";
import { FileText, UploadCloud, Download, Layers, CircleCheck, AlertTriangle } from "lucide-react";
import api from "../api/client.js";
import { accountAuthHeader } from "../auth/accountAuth.js";
import { Card, EmptyState, IconTile, Badge, SectionHeader } from "../components/ui/Card.jsx";
import { PageHero } from "../components/ui/Panels.jsx";
import { Label, FormGroup } from "../components/ui/Field.jsx";
import Button from "../components/ui/Button.jsx";

const STATUS_LABEL = {
  success: "Text extracted",
  empty: "No extractable text found",
  failed: "Extraction failed",
};

// Extraction outcome is a fact about the file, so it reads from the verdict
// tokens the rest of the system uses for outcomes. "Empty" is amber rather than
// red on purpose: the upload worked, but a résumé we cannot read is a résumé
// screening cannot cite — that is a thing for the candidate to fix, not a
// failure to report.
const STATUS_TONE = {
  success: "green",
  empty: "amber",
  failed: "red",
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
      <PageHero
        eyebrow="Resume library"
        eyebrowIcon={Layers}
        title="My resumes"
        description="Upload your resume as a PDF or DOCX. Every version is kept, so you can see exactly which file a given application was screened against."
      />

      <Card>
        <SectionHeader
          icon={UploadCloud}
          title="Upload a new version"
          description="PDF or DOCX. The newest upload is the one used for applications you submit from now on."
        />
        <form onSubmit={handleUpload} className="mt-5">
          {error && (
            <p
              role="alert"
              className="mb-4 flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm font-medium text-verdict-negative"
            >
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              {error}
            </p>
          )}
          {status === "uploaded" && (
            <p
              role="status"
              className="mb-4 flex items-start gap-2 rounded-xl border border-emerald-200 bg-verdict-positive-tint px-3.5 py-2.5 text-sm font-medium text-verdict-positive"
            >
              <CircleCheck className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              Resume uploaded successfully.
            </p>
          )}
          <FormGroup>
            <Label required>Resume File</Label>
            {/* A taller dashed target than a form row: this is the primary act
                on the page, and at input height it read as one more field in a
                stack rather than as the thing to drop a file on. */}
            <label className="flex cursor-pointer flex-col items-center gap-2 rounded-2xl border border-dashed border-slate-300 bg-canvas px-4 py-8 text-center text-sm text-slate-600 transition-colors hover:border-brand-400 hover:bg-brand-50/50">
              <IconTile icon={UploadCloud} />
              <span className="font-medium break-all text-slate-700">
                {file ? file.name : "Choose a PDF or DOCX file"}
              </span>
              <span className="text-xs text-slate-500">
                {file ? formatSize(file.size) : "Click to browse your device"}
              </span>
              {/* Deliberately NOT `required`: the input is visually hidden, and Chrome
                  refuses to submit a form whose invalid control cannot be focused —
                  it aborts silently ("An invalid form control is not focusable") and
                  onSubmit never runs, so the button appeared dead. The check below in
                  handleUpload is the real one, and it can actually say something. */}
              <input
                type="file"
                name="resume"
                accept=".pdf,.docx"
                className="hidden"
                onChange={(e) => setFile(e.target.files[0] || null)}
              />
            </label>
          </FormGroup>
          <Button type="submit" loading={status === "uploading"}>
            Upload Resume
          </Button>
        </form>
      </Card>

      {loaded && (
        <Card as="section">
          <SectionHeader
            icon={FileText}
            title="Version history"
            description="Every file you've uploaded, newest first."
            action={
              history.length > 0 ? (
                <span className="text-xs text-slate-500">
                  {history.length} {history.length === 1 ? "version" : "versions"}
                </span>
              ) : null
            }
          />
          <div className="mt-5">
            {history.length === 0 ? (
              <EmptyState
                icon={FileText}
                title="No resumes uploaded yet"
                description="Resumes you upload will show up here."
              />
            ) : (
              <ul className="grid list-none gap-4 lg:grid-cols-2">
                {history.map((r, i) => (
                  <li
                    key={r._id}
                    className="flex h-full flex-col rounded-2xl border border-slate-200 bg-white p-5 transition-colors hover:border-brand-200"
                  >
                    <div className="flex items-start gap-3">
                      <IconTile icon={FileText} size="sm" />
                      <div className="min-w-0 flex-1">
                        {/* Filenames are user-supplied and routinely arrive as one
                            unbroken 80-character string. */}
                        <p className="text-sm font-semibold break-words text-slate-900">{r.originalName}</p>
                        <p className="mt-0.5 text-xs text-slate-500">{new Date(r.createdAt).toLocaleString()}</p>
                      </div>
                      {/* The newest upload is the one applications use, so it is
                          worth saying outright rather than leaving to sort order. */}
                      {i === 0 && (
                        <Badge tone="brand" className="shrink-0">
                          Current
                        </Badge>
                      )}
                    </div>

                    {/* The inset fact block from the reference: a quiet ground
                        under the label/value pairs so they read as data about
                        the file rather than as more prose about it. */}
                    <dl className="mt-4 space-y-2 rounded-xl bg-canvas px-4 py-3 text-xs">
                      <div className="flex items-baseline justify-between gap-3">
                        <dt className="text-slate-600">File size</dt>
                        <dd className="font-semibold tabular-nums text-slate-900">{formatSize(r.sizeBytes)}</dd>
                      </div>
                      <div className="flex items-baseline justify-between gap-3">
                        <dt className="text-slate-600">Text extraction</dt>
                        <dd>
                          <Badge tone={STATUS_TONE[r.extractionStatus] || "slate"}>
                            {STATUS_LABEL[r.extractionStatus] || r.extractionStatus}
                          </Badge>
                        </dd>
                      </div>
                    </dl>

                    <div className="mt-auto pt-4">
                      <Button type="button" variant="outline" size="sm" className="w-full" onClick={() => handleDownload(r)}>
                        <Download className="h-4 w-4" aria-hidden="true" /> Download
                        <span className="sr-only"> {r.originalName}</span>
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Card>
      )}
    </div>
  );
}
