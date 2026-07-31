import { useEffect, useState } from "react";
import { useNavigate, useParams, Link } from "react-router-dom";
import { ArrowLeft, Save, ClipboardCheck, AlertTriangle } from "lucide-react";
import api from "../api/client.js";
import { useToast } from "../components/ui/Toast.jsx";
import { Card, Badge, Skeleton } from "../components/ui/Card.jsx";
import { Input, Textarea, Label, FormGroup, Select } from "../components/ui/Field.jsx";
import Button from "../components/ui/Button.jsx";

const EMPTY = {
  title: "",
  department: "",
  location: "",
  description: "",
  requirements: "",
  requiredSkills: "",
  minExperienceYears: "0",
  requiredEducation: "",
  atsThreshold: "60",
  interviewMinQuestions: "",
  interviewMaxQuestions: "",
  interviewInstructions: "",
  assessmentPolicy: "off",
};

// Kept in sync with JobList.jsx's RUBRIC_STATUS_META — an unapproved rubric
// means every candidate is silently scored by the legacy keyword engine
// (evidenceAtsService.js), so this has to be visible right where the
// recruiter edits the job, not just discoverable candidate-by-candidate.
const RUBRIC_STATUS_META = {
  approved: { tone: "green", label: "Approved — evidence scoring active" },
  draft: { tone: "amber", label: "Draft — approve to enable evidence scoring" },
  archived: { tone: "amber", label: "Draft — approve to enable evidence scoring" },
  none: { tone: "slate", label: "Not compiled yet" },
};

// API job document → flat form state (skills array ⇄ comma-separated text).
function fromJob(j) {
  return {
    title: j.title || "",
    department: j.department || "",
    location: j.location || "",
    description: j.description || "",
    requirements: j.requirements || "",
    requiredSkills: (j.requiredSkills || []).join(", "),
    minExperienceYears: String(j.minExperienceYears ?? 0),
    requiredEducation: j.requiredEducation || "",
    atsThreshold: String(j.atsThreshold ?? 60),
    interviewMinQuestions: j.interviewMinQuestions != null ? String(j.interviewMinQuestions) : "",
    interviewMaxQuestions: j.interviewMaxQuestions != null ? String(j.interviewMaxQuestions) : "",
    interviewInstructions: j.interviewInstructions || "",
    assessmentPolicy: j.assessmentPolicy || "off",
  };
}

// Flat form state → API payload. Optional numbers are omitted when blank so
// Mongoose never sees "" (CastError); skills text becomes a trimmed array.
function toPayload(f) {
  const payload = {
    title: f.title.trim(),
    department: f.department.trim(),
    location: f.location.trim(),
    description: f.description,
    requirements: f.requirements,
    requiredSkills: f.requiredSkills
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    minExperienceYears: Number(f.minExperienceYears) || 0,
    requiredEducation: f.requiredEducation.trim(),
    atsThreshold: Number(f.atsThreshold),
    interviewInstructions: f.interviewInstructions.trim(),
  };
  if (f.interviewMinQuestions !== "") payload.interviewMinQuestions = Number(f.interviewMinQuestions);
  if (f.interviewMaxQuestions !== "") payload.interviewMaxQuestions = Number(f.interviewMaxQuestions);
  payload.assessmentPolicy = f.assessmentPolicy || "off";
  return payload;
}

export default function JobForm() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const [form, setForm] = useState(EMPTY);
  const [rubricStatus, setRubricStatus] = useState("none");
  const [loading, setLoading] = useState(Boolean(id));
  const [notFound, setNotFound] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!id) return;
    let active = true;
    api
      .get(`/jobs/${id}`)
      .then((res) => {
        if (!active) return;
        setForm(fromJob(res.data));
        setRubricStatus(res.data.rubricStatus || "none");
      })
      .catch((err) => {
        if (!active) return;
        if (err.response?.status === 404) setNotFound(true);
        else toast.error(err.response?.data?.error || "Could not load the job");
      })
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  function handleChange(e) {
    setForm({ ...form, [e.target.name]: e.target.value });
  }

  function validate() {
    const threshold = Number(form.atsThreshold);
    if (!Number.isFinite(threshold) || threshold < 0 || threshold > 100)
      return "Screening threshold must be between 0 and 100";
    const exp = Number(form.minExperienceYears);
    if (!Number.isFinite(exp) || exp < 0) return "Minimum experience must be 0 or more years";
    const min = form.interviewMinQuestions === "" ? null : Number(form.interviewMinQuestions);
    const max = form.interviewMaxQuestions === "" ? null : Number(form.interviewMaxQuestions);
    for (const [label, v] of [["Minimum questions", min], ["Maximum questions", max]]) {
      if (v != null && (!Number.isInteger(v) || v < 1 || v > 30)) return `${label} must be a whole number from 1 to 30`;
    }
    if (min != null && max != null && min > max) return "Minimum questions cannot exceed maximum questions";
    return null;
  }

  async function handleSubmit(e) {
    e.preventDefault();
    const problem = validate();
    if (problem) return toast.error(problem);
    setSubmitting(true);
    try {
      if (id) {
        await api.put(`/jobs/${id}`, toPayload(form));
        toast.success("Job updated");
      } else {
        const res = await api.post("/jobs", toPayload(form));
        toast.success("Job created — review its scoring rubric next");
        navigate(`/jobs/${res.data._id}/rubric`);
        return;
      }
      navigate("/jobs");
    } catch (err) {
      toast.error(err.response?.data?.error || "Could not save job");
    } finally {
      setSubmitting(false);
    }
  }

  const noScreeningCriteria =
    !form.requiredSkills.trim() && Number(form.minExperienceYears) === 0 && !form.requiredEducation.trim();

  if (notFound) {
    return (
      <div className="space-y-6">
        <Link to="/jobs" className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-brand-700">
          <ArrowLeft className="h-4 w-4" /> Back to jobs
        </Link>
        <Card className="max-w-2xl text-center">
          <p className="text-sm font-medium text-slate-700">This job no longer exists.</p>
          <p className="mt-1 text-sm text-slate-500">It may have been deleted by a teammate.</p>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Link to="/jobs" className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-brand-700">
        <ArrowLeft className="h-4 w-4" /> Back to jobs
      </Link>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-slate-900">{id ? "Edit Job" : "New Job"}</h1>
        {id && (
          <div className="flex items-center gap-2">
            <Badge tone={(RUBRIC_STATUS_META[rubricStatus] || RUBRIC_STATUS_META.none).tone}>
              {(RUBRIC_STATUS_META[rubricStatus] || RUBRIC_STATUS_META.none).label}
            </Badge>
            <Button as={Link} to={`/jobs/${id}/rubric`} variant="secondary">
              <ClipboardCheck className="h-4 w-4" /> Scoring Rubric
            </Button>
            <Button as={Link} to={`/jobs/${id}/assessment`} variant="secondary">
              <ClipboardCheck className="h-4 w-4" /> Assessment Paper
            </Button>
            <Button as={Link} to={`/jobs/${id}/assessments`} variant="secondary">
              <ClipboardCheck className="h-4 w-4" /> Assessments
            </Button>
          </div>
        )}
      </div>

      {loading ? (
        <Card className="max-w-2xl">
          <Skeleton className="h-96 w-full" />
        </Card>
      ) : (
        <Card className="max-w-2xl">
          <form onSubmit={handleSubmit}>
            <div className="grid gap-4 sm:grid-cols-2">
              <FormGroup className="sm:col-span-2">
                <Label required>Title</Label>
                <Input name="title" value={form.title} onChange={handleChange} required />
              </FormGroup>
              <FormGroup>
                <Label>Department</Label>
                <Input name="department" value={form.department} onChange={handleChange} />
              </FormGroup>
              <FormGroup>
                <Label>Location</Label>
                <Input name="location" value={form.location} onChange={handleChange} />
              </FormGroup>
              <FormGroup className="sm:col-span-2">
                <Label required>Description</Label>
                <Textarea name="description" rows={5} value={form.description} onChange={handleChange} required />
              </FormGroup>
              <FormGroup className="sm:col-span-2">
                <Label>Requirements</Label>
                <Textarea name="requirements" rows={4} value={form.requirements} onChange={handleChange} />
              </FormGroup>
            </div>

            <h2 className="mb-1 mt-2 text-base font-semibold text-slate-900">Screening criteria</h2>
            <p className="mb-4 text-sm text-slate-500">
              What the ATS scores applicants against. Leaving these empty means the screen cannot reject anyone —
              every applicant advances to an AI interview and uses interview quota.
            </p>
            {noScreeningCriteria && (
              <div className="mb-4 flex items-start gap-2 rounded-xl bg-amber-50 p-3 text-xs text-amber-800">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                No screening criteria set — with no required skills, experience or education, every applicant will
                score above the threshold and be invited to interview.
              </div>
            )}
            <div className="grid gap-4 sm:grid-cols-2">
              <FormGroup className="sm:col-span-2">
                <Label>Required skills</Label>
                <Input
                  name="requiredSkills"
                  value={form.requiredSkills}
                  onChange={handleChange}
                  placeholder="e.g. React, Node.js, PostgreSQL (comma-separated)"
                />
              </FormGroup>
              <FormGroup>
                <Label>Minimum experience (years)</Label>
                <Input type="number" min="0" max="50" step="1" name="minExperienceYears" value={form.minExperienceYears} onChange={handleChange} />
              </FormGroup>
              <FormGroup>
                <Label>Required education</Label>
                <Input name="requiredEducation" value={form.requiredEducation} onChange={handleChange} placeholder="e.g. B.Tech / any bachelor's degree" />
              </FormGroup>
              <FormGroup className="sm:col-span-2">
                <Label>Screening threshold (0–100)</Label>
                <Input type="number" min="0" max="100" step="1" name="atsThreshold" value={form.atsThreshold} onChange={handleChange} className="max-w-[10rem]" />
                <p className="mt-1 text-xs text-slate-400">Applicants scoring at or above this advance to the AI interview. Default 60.</p>
              </FormGroup>
            </div>

            <h2 className="mb-1 mt-2 text-base font-semibold text-slate-900">Skills assessment</h2>
            <p className="mb-4 text-sm text-slate-500">
              A timed, proctored test generated from this job's approved rubric. Runs only for candidates you assign — nothing is
              automatic in manual mode.
            </p>
            <div className="mb-6 grid gap-4 sm:grid-cols-2">
              <FormGroup className="sm:col-span-2">
                <Label>Assessment policy</Label>
                <Select name="assessmentPolicy" value={form.assessmentPolicy} onChange={handleChange}>
                  <option value="off">Off — candidates go straight to the AI interview (default)</option>
                  <option value="manual">Manual — you decide per candidate: send assessment, or skip to interview</option>
                  <option value="auto">Auto — every ATS pass is assigned (for high-volume drives only)</option>
                </Select>
                <p className="mt-1 text-xs text-slate-400">
                  In manual mode, ATS-passed candidates wait in an "awaiting decision" queue — a senior hire can be skipped
                  straight to the interview with one click, and the skip is recorded as your decision (it never reads as missing
                  data, and it costs nothing).
                </p>
              </FormGroup>
            </div>

            <h2 className="mb-1 mt-2 text-base font-semibold text-slate-900">AI interview</h2>
            <p className="mb-4 text-sm text-slate-500">Optional overrides for how the AI interviews candidates for this role.</p>
            <div className="grid gap-4 sm:grid-cols-2">
              <FormGroup>
                <Label>Minimum questions</Label>
                <Input type="number" min="1" max="30" step="1" name="interviewMinQuestions" value={form.interviewMinQuestions} onChange={handleChange} placeholder="Default" />
              </FormGroup>
              <FormGroup>
                <Label>Maximum questions</Label>
                <Input type="number" min="1" max="30" step="1" name="interviewMaxQuestions" value={form.interviewMaxQuestions} onChange={handleChange} placeholder="Default" />
              </FormGroup>
              <FormGroup className="sm:col-span-2">
                <Label>Interview instructions</Label>
                <Textarea
                  name="interviewInstructions"
                  rows={3}
                  value={form.interviewInstructions}
                  onChange={handleChange}
                  placeholder="Anything the AI interviewer should focus on for this role, e.g. 'probe production debugging experience'"
                />
              </FormGroup>
            </div>

            <Button type="submit" loading={submitting}>
              <Save className="h-4 w-4" /> Save Job
            </Button>
          </form>
        </Card>
      )}
    </div>
  );
}
