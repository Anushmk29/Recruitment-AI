import { useEffect, useMemo, useState } from "react";
import { useParams, Link } from "react-router-dom";
import {
  ArrowLeft,
  Plus,
  Trash2,
  CheckCircle2,
  Paperclip,
  Sparkles,
  Quote,
  Check,
  Loader2,
  AlertTriangle,
  Info,
} from "lucide-react";
import api from "../api/client.js";
import { accountAuthHeader, getAccountAuth } from "../auth/accountAuth.js";
import { Card } from "../components/ui/Card.jsx";
import { Input, Textarea, Label, FormGroup } from "../components/ui/Field.jsx";
import Button from "../components/ui/Button.jsx";

const EMPTY_EXPERIENCE = { company: "", role: "", startDate: "", endDate: "", currentlyWorking: false, description: "" };
const EMPTY_EDUCATION = { institution: "", degree: "", fieldOfStudy: "", startYear: "", endYear: "", grade: "" };
const EMPTY_PROJECT = { title: "", description: "", techStack: "", link: "" };
const EMPTY_CERTIFICATE = { name: "", issuer: "", issueDate: "", credentialUrl: "" };

// Entries carry their review state alongside their values. `suggested` means the
// machine proposed it and the person has not yet said it is right — those block
// submission. Underscore-prefixed keys are stripped before the form is sent; the
// server recomputes provenance from its own cached suggestions regardless, so
// nothing here is load-bearing for the audit record.
const SUGGESTED = "suggested";

function stripMeta({ _state, _spans, ...rest }) {
  return rest;
}

// ---------------------------------------------------------------------------
// The quote that backs a suggestion, shown in situ. This is the whole promise of
// the feature: nothing is proposed that cannot be pointed at in the candidate's
// own document, so the candidate can check a field against its source instead of
// trusting that a parser read it correctly.
// ---------------------------------------------------------------------------
function SourceQuote({ spans }) {
  const [open, setOpen] = useState(false);
  if (!spans || spans.length === 0) return null;

  return (
    <div className="sm:col-span-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-brand-700"
      >
        <Quote className="h-3.5 w-3.5" />
        {open ? "Hide source" : "Show where this came from"}
      </button>
      {open && (
        <div className="mt-2 space-y-2">
          {spans.map((span, i) => (
            <p key={i} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs leading-relaxed text-slate-400">
              {span.context?.before ? `…${span.context.before}` : ""}
              <mark className="rounded bg-amber-100 px-0.5 font-medium text-slate-900">{span.quote}</mark>
              {span.context?.after ? `${span.context.after}…` : ""}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

function Repeatable({ title, items, setItems, empty, renderFields, addLabel }) {
  function update(index, field, value) {
    const next = items.slice();
    next[index] = { ...next[index], [field]: value };
    setItems(next);
  }

  function confirm(index) {
    const next = items.slice();
    next[index] = { ...next[index], _state: "confirmed" };
    setItems(next);
  }

  function remove(index) {
    setItems(items.filter((_, i) => i !== index));
  }

  const pending = items.filter((i) => i._state === SUGGESTED).length;

  return (
    <FormGroup>
      <div className="mb-1.5 flex items-center justify-between gap-3">
        <Label className="mb-0">{title}</Label>
        {pending > 0 && (
          <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-800">
            {pending} to check
          </span>
        )}
      </div>
      <div className="space-y-3">
        {items.map((item, index) => {
          const isSuggested = item._state === SUGGESTED;
          return (
            <div
              key={index}
              className={`relative rounded-xl border p-4 ${
                isSuggested ? "border-amber-300 bg-amber-50/60" : "border-slate-200 bg-slate-50"
              }`}
            >
              <button
                type="button"
                onClick={() => remove(index)}
                className="absolute right-3 top-3 text-slate-400 hover:text-red-600"
                aria-label="Remove"
              >
                <Trash2 className="h-4 w-4" />
              </button>

              {isSuggested && (
                <p className="mb-3 inline-flex items-center gap-1.5 text-xs font-semibold text-amber-800">
                  <Sparkles className="h-3.5 w-3.5" />
                  Read from your résumé — please check it
                </p>
              )}

              <div className="grid gap-3 pr-8 sm:grid-cols-2">
                {renderFields(item, (field, value) => update(index, field, value))}
                <SourceQuote spans={item._spans} />
              </div>

              {isSuggested && (
                <div className="mt-3 flex items-center gap-2 border-t border-amber-200 pt-3">
                  <Button type="button" size="sm" variant="secondary" onClick={() => confirm(index)}>
                    <Check className="h-3.5 w-3.5" /> This is correct
                  </Button>
                  <button
                    type="button"
                    onClick={() => remove(index)}
                    className="text-xs font-semibold text-slate-500 hover:text-red-600"
                  >
                    Not right — remove it
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
      <button
        type="button"
        onClick={() => setItems([...items, { ...empty }])}
        className="mt-3 flex items-center gap-1.5 text-sm font-semibold text-brand-700 hover:underline"
      >
        <Plus className="h-4 w-4" /> {addLabel}
      </button>
    </FormGroup>
  );
}

export default function ApplyForm() {
  const { id } = useParams();
  const [job, setJob] = useState(null);

  // Prefill from the signed-in account. The server binds the application to the
  // account's email regardless, so the email field is shown but not editable.
  const account = getAccountAuth()?.user;
  const [basicDetails, setBasicDetails] = useState({
    name: account?.name || "",
    email: account?.email || "",
    phone: account?.phone || "",
    location: "",
    linkedinUrl: "",
    portfolioUrl: "",
  });
  const [receipt, setReceipt] = useState(null);

  const [resume, setResume] = useState(null);
  const [resumeId, setResumeId] = useState(null);
  const [parseState, setParseState] = useState("idle"); // idle | working | done | failed
  const [autofill, setAutofill] = useState(null);

  const [experience, setExperience] = useState([]);
  const [education, setEducation] = useState([]);
  const [skillsInput, setSkillsInput] = useState("");
  const [suggestedSkills, setSuggestedSkills] = useState([]);
  const [projects, setProjects] = useState([]);
  const [certificates, setCertificates] = useState([]);
  const [consentData, setConsentData] = useState(false);
  const [attested, setAttested] = useState(false);

  const [status, setStatus] = useState("idle");
  const [error, setError] = useState("");

  useEffect(() => {
    api.get(`/jobs/${id}`).then((res) => setJob(res.data));
  }, [id]);

  const skills = useMemo(
    () => skillsInput.split(",").map((s) => s.trim()).filter(Boolean),
    [skillsInput]
  );

  const pendingReview =
    [experience, education, projects, certificates].reduce(
      (n, list) => n + list.filter((i) => i._state === SUGGESTED).length,
      0
    );

  // Attestation is only asked for when a machine actually contributed something.
  // A hand-typed application does not need the candidate to vouch for a parse
  // that never happened.
  const usedSuggestions =
    autofill &&
    ([experience, education, projects, certificates].some((l) => l.some((i) => i._spans)) ||
      suggestedSkills.some((s) => skills.some((v) => v.toLowerCase() === s.name.toLowerCase())));

  function handleBasicChange(e) {
    setBasicDetails({ ...basicDetails, [e.target.name]: e.target.value });
  }

  // Suggestions arrive as { value, spans } — unwrap into form entries carrying
  // their citation and marked as needing review.
  function toEntries(list) {
    return (list || []).map((s) => ({ ...s.value, _state: SUGGESTED, _spans: s.spans }));
  }

  async function handleResumeChange(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setResume(file);
    setResumeId(null);
    setAutofill(null);
    setError("");
    setParseState("working");

    try {
      // Upload to the candidate's own résumé library first, so the file is parsed
      // once and reused — including across applications. Deduped by checksum
      // server-side, so re-picking the same file costs nothing.
      const form = new FormData();
      form.append("resume", file);
      const uploaded = await api.post("/resumes", form, {
        headers: { "Content-Type": "multipart/form-data", ...accountAuthHeader() },
      });
      setResumeId(uploaded.data._id);

      const res = await api.post(
        `/jobs/${id}/apply/autofill`,
        { resumeId: uploaded.data._id },
        { headers: accountAuthHeader() }
      );
      const payload = res.data;
      setAutofill(payload);

      const s = payload.sections || {};
      setExperience(toEntries(s.experience));
      setEducation(toEntries(s.education));
      setProjects(toEntries(s.projects));
      setCertificates(toEntries(s.certificates));
      setSuggestedSkills((s.skills || []).map((k) => ({ name: k.value.name, spans: k.spans })));

      // Contact details are matched exactly rather than inferred, so they fill
      // straight in — but only where the candidate has not already typed something.
      setBasicDetails((prev) => ({
        ...prev,
        location: prev.location || s.basics?.location?.value || "",
        linkedinUrl: prev.linkedinUrl || s.basics?.linkedinUrl?.value || "",
        portfolioUrl: prev.portfolioUrl || s.basics?.portfolioUrl?.value || "",
      }));

      setParseState("done");
    } catch (err) {
      // Autofill is a convenience and must never block an application: the file
      // is still attached and the form still submits, just without suggestions.
      console.warn("autofill unavailable", err);
      setParseState("failed");
    }
  }

  function addSkill(name) {
    if (skills.some((s) => s.toLowerCase() === name.toLowerCase())) return;
    setSkillsInput(skills.concat(name).join(", "));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (status === "submitting") return; // double-click guard — one application, one submit
    if (!resume && !resumeId) {
      setError("Please attach your resume");
      return;
    }
    if (pendingReview > 0) {
      setError(`Please check the ${pendingReview} highlighted entr${pendingReview === 1 ? "y" : "ies"} we read from your résumé before submitting.`);
      return;
    }
    if (usedSuggestions && !attested) {
      setError("Please confirm that the details taken from your résumé are accurate.");
      return;
    }
    if (!consentData) {
      setError("Please agree to the processing of your application data to continue.");
      return;
    }
    setError("");
    setStatus("submitting");

    const data = new FormData();
    Object.entries(basicDetails).forEach(([key, value]) => data.append(key, value));
    // Prefer the library reference: the file is already stored and parsed. The
    // raw upload stays supported for the case where that upload failed.
    if (resumeId) data.append("resumeId", resumeId);
    else data.append("resume", resume);
    data.append("experience", JSON.stringify(experience.map(stripMeta)));
    data.append("education", JSON.stringify(education.map(stripMeta)));
    data.append("skills", JSON.stringify(skills));
    data.append("projects", JSON.stringify(projects.map(stripMeta)));
    data.append("certificates", JSON.stringify(certificates.map(stripMeta)));
    data.append("consentDataProcessing", consentData);
    // The AI-assisted interview (including camera use) is a mandatory part of this
    // process, not an opt-in — see the single consent checkbox below.
    data.append("consentAiProcessing", true);
    // Phase 15.1 — source attribution carried from the apply link (?src=…).
    // Analytics-only; the server sanitises and it never affects scoring.
    const params = new URLSearchParams(window.location.search);
    if (params.get("src")) data.append("src", params.get("src"));
    if (params.get("campaign")) data.append("campaign", params.get("campaign"));

    try {
      const res = await api.post(`/jobs/${id}/apply`, data, {
        headers: { "Content-Type": "multipart/form-data", ...accountAuthHeader() },
      });
      setReceipt(res.data);
      setStatus("submitted");
    } catch (err) {
      setError(err.response?.data?.error || "Failed to submit application");
      setStatus("idle");
    }
  }

  if (!job) return <p className="text-sm text-slate-400">Loading…</p>;

  if (status === "submitted") {
    return (
      <Card className="py-10 text-center">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-verdict-positive-tint text-verdict-positive">
          <CheckCircle2 className="h-7 w-7" aria-hidden="true" />
        </div>
        <h1 className="font-display text-xl font-bold tracking-tight text-slate-900">Application submitted</h1>
        <p className="mx-auto mt-2 max-w-md text-sm text-slate-500">
          Your application for <span className="font-medium text-slate-700">{job.title}</span> was received.
        </p>
        {receipt?._id && (
          // Was `slate-400` at 12px. This is the one string a candidate might
          // have to quote back to a recruiter — it has to be readable.
          <p className="mt-2 text-xs text-slate-500">
            Reference ID: <span className="font-mono text-slate-700">{receipt._id}</span>
          </p>
        )}
        <div className="mx-auto mt-6 max-w-md rounded-2xl border border-slate-200 bg-canvas p-5 text-left text-sm text-slate-600">
          <p className="font-semibold text-slate-800">What happens next</p>
          <ol className="mt-2 list-decimal space-y-1 pl-5">
            <li>Your resume is being screened now — this runs in the background.</li>
            <li>You'll get an email (and a dashboard update) with the outcome.</li>
            <li>If you're shortlisted, the email includes your interview link. A laptop or desktop is recommended for the interview.</li>
          </ol>
        </div>
        <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
          <Button as={Link} to="/dashboard" size="sm">
            Track it on your dashboard
          </Button>
          <Button as={Link} to="/" size="sm" variant="outline">
            Back to listings
          </Button>
        </div>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <Link to={`/jobs/${job.slug || id}`} className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-brand-700">
        <ArrowLeft className="h-4 w-4" /> Back to job
      </Link>
      <div>
        <h1 className="font-display text-2xl font-extrabold tracking-tight text-slate-900">Apply — {job.title}</h1>
        <p className="mt-1.5 text-sm text-slate-500">
          {job.company?.name ? `${job.company.name} · ` : ""}Screening starts as soon as you submit.
        </p>
      </div>

      <Card>
        <form onSubmit={handleSubmit}>
          {error && (
            <p
              role="alert"
              className="mb-4 rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm font-medium text-verdict-negative"
            >
              {error}
            </p>
          )}

          <p className="mb-3 text-sm font-semibold text-brand-700">Basic Details</p>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormGroup>
              <Label required>Full Name</Label>
              <Input name="name" value={basicDetails.name} onChange={handleBasicChange} required />
            </FormGroup>
            <FormGroup>
              <Label required>Email</Label>
              <Input name="email" type="email" value={basicDetails.email} disabled readOnly />
              <p className="mt-1 text-xs text-slate-400">Applications are linked to your account email.</p>
            </FormGroup>
            <FormGroup>
              <Label>Phone</Label>
              <Input name="phone" value={basicDetails.phone} onChange={handleBasicChange} />
            </FormGroup>
            <FormGroup>
              <Label>Location</Label>
              <Input name="location" value={basicDetails.location} onChange={handleBasicChange} />
            </FormGroup>
            <FormGroup>
              <Label>LinkedIn URL</Label>
              <Input name="linkedinUrl" value={basicDetails.linkedinUrl} onChange={handleBasicChange} />
            </FormGroup>
            <FormGroup>
              <Label>Portfolio URL</Label>
              <Input name="portfolioUrl" value={basicDetails.portfolioUrl} onChange={handleBasicChange} />
            </FormGroup>
          </div>

          <FormGroup className="mt-2">
            <Label required>Resume</Label>
            <label className="flex cursor-pointer items-center gap-2 rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-3 text-sm text-slate-600 hover:border-brand-400">
              <Paperclip className="h-4 w-4 text-slate-400" />
              {resume ? resume.name : "Choose a PDF or DOCX file (max 5 MB)"}
              {/* Not `required` — see ResumeUpload.jsx: a hidden invalid control makes
                  Chrome abort the submit silently and onSubmit never fires, so the
                  candidate gets no message at all. handleSubmit enforces the resume. */}
              <input
                type="file"
                name="resume"
                accept=".pdf,.docx"
                className="hidden"
                onChange={handleResumeChange}
              />
            </label>
            <p className="mt-1.5 text-xs text-slate-400">
              We'll read it and suggest entries for the sections below. Nothing is submitted until you've checked them.
            </p>

            {parseState === "working" && (
              <p className="mt-3 inline-flex items-center gap-2 text-sm font-medium text-brand-700">
                <Loader2 className="h-4 w-4 animate-spin" /> Reading your résumé…
              </p>
            )}

            {parseState === "failed" && (
              <div className="mt-3 flex gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
                <Info className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
                <p>
                  We couldn't read your résumé automatically, so nothing below has been filled in. Your file is still
                  attached and your application is unaffected — please fill in the sections yourself.
                </p>
              </div>
            )}

            {/* Degraded runs are labelled, never dressed up as a complete parse. */}
            {parseState === "done" && autofill?.degraded && (
              <div className="mt-3 flex gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <p>{autofill.degraded.message}</p>
              </div>
            )}

            {parseState === "done" &&
              (autofill?.notices || []).map((notice) => (
                <div
                  key={notice.code}
                  className="mt-3 flex gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600"
                >
                  <Info className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
                  <p>{notice.message}</p>
                </div>
              ))}

            {parseState === "done" && !autofill?.degraded && pendingReview > 0 && (
              <div className="mt-3 flex gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                <Sparkles className="mt-0.5 h-4 w-4 shrink-0" />
                <p>
                  We read <strong>{pendingReview}</strong> entr{pendingReview === 1 ? "y" : "ies"} from your résumé and
                  filled them in below. Please check each one against your own CV — you can edit or remove anything —
                  then mark it correct. Only you can submit this application.
                </p>
              </div>
            )}
          </FormGroup>

          <Repeatable
            title="Experience"
            items={experience}
            setItems={setExperience}
            empty={EMPTY_EXPERIENCE}
            addLabel="Add experience"
            renderFields={(item, update) => (
              <>
                <Input placeholder="Company" value={item.company} onChange={(e) => update("company", e.target.value)} />
                <Input placeholder="Role" value={item.role} onChange={(e) => update("role", e.target.value)} />
                <Input placeholder="Start date" value={item.startDate} onChange={(e) => update("startDate", e.target.value)} />
                <Input
                  placeholder="End date"
                  value={item.endDate}
                  onChange={(e) => update("endDate", e.target.value)}
                  disabled={item.currentlyWorking}
                />
                <label className="flex items-center gap-2 text-sm text-slate-600 sm:col-span-2">
                  <input
                    type="checkbox"
                    checked={item.currentlyWorking}
                    onChange={(e) => update("currentlyWorking", e.target.checked)}
                    className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-400"
                  />
                  Currently working here
                </label>
                <Textarea
                  placeholder="Description"
                  rows={2}
                  value={item.description}
                  onChange={(e) => update("description", e.target.value)}
                  className="sm:col-span-2"
                />
              </>
            )}
          />

          <Repeatable
            title="Education"
            items={education}
            setItems={setEducation}
            empty={EMPTY_EDUCATION}
            addLabel="Add education"
            renderFields={(item, update) => (
              <>
                <Input placeholder="Institution" value={item.institution} onChange={(e) => update("institution", e.target.value)} />
                <Input placeholder="Degree" value={item.degree} onChange={(e) => update("degree", e.target.value)} />
                <Input placeholder="Field of study" value={item.fieldOfStudy} onChange={(e) => update("fieldOfStudy", e.target.value)} />
                <Input placeholder="Start year" value={item.startYear} onChange={(e) => update("startYear", e.target.value)} />
                <Input placeholder="End year" value={item.endYear} onChange={(e) => update("endYear", e.target.value)} />
                <Input placeholder="Grade" value={item.grade} onChange={(e) => update("grade", e.target.value)} />
              </>
            )}
          />

          <FormGroup>
            <Label>Skills</Label>
            <Input
              placeholder="Comma-separated, e.g. React, Node.js, SQL"
              value={skillsInput}
              onChange={(e) => setSkillsInput(e.target.value)}
            />
            {suggestedSkills.length > 0 && (
              <div className="mt-3">
                <p className="mb-2 inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500">
                  <Sparkles className="h-3.5 w-3.5 text-amber-500" />
                  Found in your résumé — tap to add
                </p>
                <div className="flex flex-wrap gap-2">
                  {suggestedSkills.map((s) => {
                    const added = skills.some((v) => v.toLowerCase() === s.name.toLowerCase());
                    return (
                      <button
                        key={s.name}
                        type="button"
                        onClick={() => addSkill(s.name)}
                        disabled={added}
                        title={s.spans?.[0]?.quote ? `From: “${s.spans[0].quote}”` : undefined}
                        className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-semibold transition ${
                          added
                            ? "cursor-default border border-emerald-200 bg-emerald-50 text-emerald-700"
                            : "border border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100"
                        }`}
                      >
                        {added ? <Check className="h-3 w-3" /> : <Plus className="h-3 w-3" />}
                        {s.name}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </FormGroup>

          <Repeatable
            title="Projects"
            items={projects}
            setItems={setProjects}
            empty={EMPTY_PROJECT}
            addLabel="Add project"
            renderFields={(item, update) => (
              <>
                <Input placeholder="Title" value={item.title} onChange={(e) => update("title", e.target.value)} />
                <Input placeholder="Tech stack" value={item.techStack} onChange={(e) => update("techStack", e.target.value)} />
                <Textarea
                  placeholder="Description"
                  rows={2}
                  value={item.description}
                  onChange={(e) => update("description", e.target.value)}
                  className="sm:col-span-2"
                />
                <Input placeholder="Link" value={item.link} onChange={(e) => update("link", e.target.value)} className="sm:col-span-2" />
              </>
            )}
          />

          <Repeatable
            title="Certificates"
            items={certificates}
            setItems={setCertificates}
            empty={EMPTY_CERTIFICATE}
            addLabel="Add certificate"
            renderFields={(item, update) => (
              <>
                <Input placeholder="Name" value={item.name} onChange={(e) => update("name", e.target.value)} />
                <Input placeholder="Issuer" value={item.issuer} onChange={(e) => update("issuer", e.target.value)} />
                <Input placeholder="Issue date" value={item.issueDate} onChange={(e) => update("issueDate", e.target.value)} />
                <Input placeholder="Credential URL" value={item.credentialUrl} onChange={(e) => update("credentialUrl", e.target.value)} />
              </>
            )}
          />

          <FormGroup className="mt-4">
            <Label>Consent &amp; Privacy</Label>
            <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-4">
              <label className="flex items-start gap-2 text-sm text-slate-600">
                <input
                  type="checkbox"
                  checked={consentData}
                  onChange={(e) => setConsentData(e.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-400"
                />
                <span>
                  I consent to {job.company?.name || "the employer"} processing my application data (resume, profile, and
                  interview responses) for this recruitment process, including a mandatory AI-assisted interview that
                  may use my camera and a third-party AI model to generate questions and assess my answers.{" "}
                  <span className="text-red-600">*</span>
                </span>
              </label>

              {/* Attestation is deliberately separate from consent. Consent is
                  permission to process; this is authorship — the point at which
                  machine-suggested text becomes the candidate's own claim. */}
              {usedSuggestions && (
                <label className="flex items-start gap-2 border-t border-slate-200 pt-3 text-sm text-slate-600">
                  <input
                    type="checkbox"
                    checked={attested}
                    onChange={(e) => setAttested(e.target.checked)}
                    className="mt-0.5 h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-400"
                  />
                  <span>
                    I have reviewed the details that were read from my résumé and confirm they are accurate and my own.{" "}
                    <span className="text-red-600">*</span>
                  </span>
                </label>
              )}
            </div>
          </FormGroup>

          {pendingReview > 0 && (
            <p className="mb-3 text-sm font-medium text-amber-800">
              {pendingReview} entr{pendingReview === 1 ? "y" : "ies"} still need{pendingReview === 1 ? "s" : ""} your
              check before you can submit.
            </p>
          )}

          <Button
            type="submit"
            size="lg"
            loading={status === "submitting"}
            disabled={pendingReview > 0}
            className="mt-2 w-full sm:w-auto"
          >
            Submit Application
          </Button>
        </form>
      </Card>
    </div>
  );
}
