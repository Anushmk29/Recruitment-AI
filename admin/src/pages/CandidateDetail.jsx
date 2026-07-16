import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { ArrowLeft, Link2, Globe, FileText, Mail, Phone, MapPin } from "lucide-react";
import api from "../api/client.js";
import { Card, Badge, Skeleton } from "../components/ui/Card.jsx";
import { Select } from "../components/ui/Field.jsx";

const STATUSES = ["applied", "shortlisted", "next_round", "rejected"];

function statusTone(status) {
  return { applied: "slate", interview_queue: "brand", shortlisted: "green", next_round: "brand", rejected: "red" }[status] || "slate";
}

function Section({ title, children }) {
  return (
    <Card>
      <h3 className="mb-3 text-base font-semibold text-slate-900">{title}</h3>
      {children}
    </Card>
  );
}

export default function CandidateDetail() {
  const { id } = useParams();
  const [candidate, setCandidate] = useState(null);

  function load() {
    api.get(`/candidates/${id}`).then((res) => setCandidate(res.data));
  }

  useEffect(load, [id]);

  async function handleStatusChange(status) {
    await api.patch(`/candidates/${id}/status`, { status });
    load();
  }

  if (!candidate) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-6 w-40" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  const { basicDetails, experience, education, skills, projects, certificates, ats } = candidate;

  return (
    <div className="space-y-6">
      <Link
        to={`/jobs/${candidate.job?._id}/candidates`}
        className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-brand-700"
      >
        <ArrowLeft className="h-4 w-4" /> Back to candidates
      </Link>

      <Card>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">{basicDetails.name}</h1>
            <p className="mt-1 text-sm text-slate-500">
              Applied for <span className="font-medium text-slate-700">{candidate.job?.title}</span>
            </p>
          </div>
          <div className="flex items-center gap-3">
            {ats?.overallScore != null && (
              <Badge tone={ats.decision === "pass" ? "green" : ats.decision === "fail" ? "red" : "slate"}>
                ATS {ats.overallScore}%
              </Badge>
            )}
            <Select value={candidate.status} onChange={(e) => handleStatusChange(e.target.value)} className="w-auto">
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s.replace("_", " ")}
                </option>
              ))}
            </Select>
          </div>
        </div>

        <div className="mt-5 grid gap-3 border-t border-slate-100 pt-5 sm:grid-cols-2">
          <div className="flex items-center gap-2 text-sm text-slate-600">
            <Mail className="h-4 w-4 text-slate-400" /> {basicDetails.email}
          </div>
          <div className="flex items-center gap-2 text-sm text-slate-600">
            <Phone className="h-4 w-4 text-slate-400" /> {basicDetails.phone || "—"}
          </div>
          <div className="flex items-center gap-2 text-sm text-slate-600">
            <MapPin className="h-4 w-4 text-slate-400" /> {basicDetails.location || "—"}
          </div>
          <div className="flex items-center gap-2 text-sm text-slate-600">
            <FileText className="h-4 w-4 text-slate-400" />
            <a
              href={`${api.defaults.baseURL}/candidates/${candidate._id}/resume`}
              target="_blank"
              rel="noreferrer"
              className="font-medium text-brand-700 hover:underline"
            >
              {candidate.resumeOriginalName}
            </a>
          </div>
          {basicDetails.linkedinUrl && (
            <div className="flex items-center gap-2 text-sm text-slate-600">
              <Link2 className="h-4 w-4 text-slate-400" />
              <a href={basicDetails.linkedinUrl} target="_blank" rel="noreferrer" className="font-medium text-brand-700 hover:underline">
                LinkedIn
              </a>
            </div>
          )}
          {basicDetails.portfolioUrl && (
            <div className="flex items-center gap-2 text-sm text-slate-600">
              <Globe className="h-4 w-4 text-slate-400" />
              <a href={basicDetails.portfolioUrl} target="_blank" rel="noreferrer" className="font-medium text-brand-700 hover:underline">
                Portfolio
              </a>
            </div>
          )}
        </div>
      </Card>

      {ats && ats.overallScore != null && (
        <Section title="ATS Breakdown">
          <div className="grid gap-3 sm:grid-cols-3">
            {[
              ["Skills Match", ats.skillsMatch],
              ["Experience Match", ats.experienceMatch],
              ["Education Match", ats.educationMatch],
              ["Projects Match", ats.projectsMatch],
              ["Certification Match", ats.certificationMatch],
              ["Keyword Match", ats.keywordMatch],
            ].map(([label, value]) => (
              <div key={label} className="rounded-xl bg-slate-50 p-3">
                <p className="text-xs text-slate-400">{label}</p>
                <p className="mt-1 text-lg font-bold text-slate-900">{value}%</p>
              </div>
            ))}
          </div>
          {ats.missingSkills?.length > 0 && (
            <div className="mt-4">
              <p className="mb-2 text-xs font-medium text-slate-400">Missing Skills</p>
              <div className="flex flex-wrap gap-1.5">
                {ats.missingSkills.map((s) => (
                  <Badge key={s} tone="red">{s}</Badge>
                ))}
              </div>
            </div>
          )}
        </Section>
      )}

      <Section title="Experience">
        {experience.length === 0 && <p className="text-sm text-slate-400">—</p>}
        <div className="space-y-3">
          {experience.map((exp, i) => (
            <div className="rounded-xl border border-slate-100 bg-slate-50 p-4" key={i}>
              <p className="font-semibold text-slate-800">
                {exp.role} @ {exp.company}
              </p>
              <p className="text-xs text-slate-400">
                {exp.startDate} — {exp.currentlyWorking ? "Present" : exp.endDate}
              </p>
              {exp.description && <p className="mt-2 text-sm text-slate-600">{exp.description}</p>}
            </div>
          ))}
        </div>
      </Section>

      <Section title="Education">
        {education.length === 0 && <p className="text-sm text-slate-400">—</p>}
        <div className="space-y-3">
          {education.map((edu, i) => (
            <div className="rounded-xl border border-slate-100 bg-slate-50 p-4" key={i}>
              <p className="font-semibold text-slate-800">
                {edu.degree}
                {edu.fieldOfStudy ? ` in ${edu.fieldOfStudy}` : ""} — {edu.institution}
              </p>
              <p className="text-xs text-slate-400">
                {edu.startYear} — {edu.endYear} {edu.grade && `· Grade: ${edu.grade}`}
              </p>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Skills">
        {skills.length === 0 ? (
          <p className="text-sm text-slate-400">—</p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {skills.map((s, i) => (
              <Badge key={i}>{s}</Badge>
            ))}
          </div>
        )}
      </Section>

      <Section title="Projects">
        {projects.length === 0 && <p className="text-sm text-slate-400">—</p>}
        <div className="space-y-3">
          {projects.map((proj, i) => (
            <div className="rounded-xl border border-slate-100 bg-slate-50 p-4" key={i}>
              <p className="font-semibold text-slate-800">{proj.title}</p>
              {proj.techStack && <p className="text-xs text-slate-400">Tech: {proj.techStack}</p>}
              {proj.description && <p className="mt-2 text-sm text-slate-600">{proj.description}</p>}
              {proj.link && (
                <a href={proj.link} target="_blank" rel="noreferrer" className="mt-1 inline-block text-sm font-medium text-brand-700 hover:underline">
                  {proj.link}
                </a>
              )}
            </div>
          ))}
        </div>
      </Section>

      <Section title="Certificates">
        {certificates.length === 0 && <p className="text-sm text-slate-400">—</p>}
        <div className="space-y-3">
          {certificates.map((cert, i) => (
            <div className="rounded-xl border border-slate-100 bg-slate-50 p-4" key={i}>
              <p className="font-semibold text-slate-800">{cert.name}</p>
              <p className="text-xs text-slate-400">
                {cert.issuer} {cert.issueDate && `· ${cert.issueDate}`}
              </p>
              {cert.credentialUrl && (
                <a href={cert.credentialUrl} target="_blank" rel="noreferrer" className="mt-1 inline-block text-sm font-medium text-brand-700 hover:underline">
                  {cert.credentialUrl}
                </a>
              )}
            </div>
          ))}
        </div>
      </Section>
    </div>
  );
}
