import { useEffect, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { ArrowLeft, Plus, Trash2, CheckCircle2, Paperclip } from "lucide-react";
import api from "../api/client.js";
import { accountAuthHeader } from "../auth/accountAuth.js";
import { Card } from "../components/ui/Card.jsx";
import { Input, Textarea, Label, FieldError, FormGroup } from "../components/ui/Field.jsx";
import Button from "../components/ui/Button.jsx";

const EMPTY_EXPERIENCE = { company: "", role: "", startDate: "", endDate: "", currentlyWorking: false, description: "" };
const EMPTY_EDUCATION = { institution: "", degree: "", fieldOfStudy: "", startYear: "", endYear: "", grade: "" };
const EMPTY_PROJECT = { title: "", description: "", techStack: "", link: "" };
const EMPTY_CERTIFICATE = { name: "", issuer: "", issueDate: "", credentialUrl: "" };

function Repeatable({ title, items, setItems, empty, renderFields, addLabel }) {
  function update(index, field, value) {
    const next = items.slice();
    next[index] = { ...next[index], [field]: value };
    setItems(next);
  }

  function remove(index) {
    setItems(items.filter((_, i) => i !== index));
  }

  return (
    <FormGroup>
      <Label>{title}</Label>
      <div className="space-y-3">
        {items.map((item, index) => (
          <div className="relative rounded-xl border border-slate-200 bg-slate-50 p-4" key={index}>
            <button
              type="button"
              onClick={() => remove(index)}
              className="absolute right-3 top-3 text-slate-400 hover:text-red-600"
              aria-label="Remove"
            >
              <Trash2 className="h-4 w-4" />
            </button>
            <div className="grid gap-3 pr-8 sm:grid-cols-2">{renderFields(item, (field, value) => update(index, field, value))}</div>
          </div>
        ))}
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

  const [basicDetails, setBasicDetails] = useState({
    name: "",
    email: "",
    phone: "",
    location: "",
    linkedinUrl: "",
    portfolioUrl: "",
  });
  const [resume, setResume] = useState(null);
  const [experience, setExperience] = useState([]);
  const [education, setEducation] = useState([]);
  const [skillsInput, setSkillsInput] = useState("");
  const [projects, setProjects] = useState([]);
  const [certificates, setCertificates] = useState([]);

  const [status, setStatus] = useState("idle");
  const [error, setError] = useState("");

  useEffect(() => {
    api.get(`/jobs/${id}`).then((res) => setJob(res.data));
  }, [id]);

  function handleBasicChange(e) {
    setBasicDetails({ ...basicDetails, [e.target.name]: e.target.value });
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!resume) {
      setError("Please attach your resume");
      return;
    }
    setError("");
    setStatus("submitting");

    const skills = skillsInput.split(",").map((s) => s.trim()).filter(Boolean);

    const data = new FormData();
    Object.entries(basicDetails).forEach(([key, value]) => data.append(key, value));
    data.append("resume", resume);
    data.append("experience", JSON.stringify(experience));
    data.append("education", JSON.stringify(education));
    data.append("skills", JSON.stringify(skills));
    data.append("projects", JSON.stringify(projects));
    data.append("certificates", JSON.stringify(certificates));

    try {
      await api.post(`/jobs/${id}/apply`, data, {
        headers: { "Content-Type": "multipart/form-data", ...accountAuthHeader() },
      });
      setStatus("submitted");
    } catch (err) {
      setError(err.response?.data?.error || "Failed to submit application");
      setStatus("idle");
    }
  }

  if (!job) return <p className="text-sm text-slate-400">Loading…</p>;

  if (status === "submitted") {
    return (
      <Card className="text-center">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-emerald-100 text-emerald-600">
          <CheckCircle2 className="h-7 w-7" />
        </div>
        <h1 className="text-lg font-semibold text-slate-900">Application Submitted!</h1>
        <p className="mt-2 text-sm text-slate-500">Check your email for next steps.</p>
        <Link to="/" className="mt-5 inline-block text-sm font-semibold text-brand-700 hover:underline">
          &larr; Back to listings
        </Link>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <Link to={`/jobs/${job.slug || id}`} className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-brand-700">
        <ArrowLeft className="h-4 w-4" /> Back to job
      </Link>
      <h1 className="text-2xl font-bold text-slate-900">Apply — {job.title}</h1>

      <Card>
        <form onSubmit={handleSubmit}>
          {error && <p className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm font-medium text-red-700">{error}</p>}

          <p className="mb-3 text-sm font-semibold text-brand-700">Basic Details</p>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormGroup>
              <Label required>Full Name</Label>
              <Input name="name" value={basicDetails.name} onChange={handleBasicChange} required />
            </FormGroup>
            <FormGroup>
              <Label required>Email</Label>
              <Input name="email" type="email" value={basicDetails.email} onChange={handleBasicChange} required />
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
              {resume ? resume.name : "Choose a PDF or DOCX file"}
              <input type="file" accept=".pdf,.doc,.docx" className="hidden" onChange={(e) => setResume(e.target.files[0])} required />
            </label>
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

          <Button type="submit" size="lg" loading={status === "submitting"} className="mt-2 w-full sm:w-auto">
            Submit Application
          </Button>
        </form>
      </Card>
    </div>
  );
}
