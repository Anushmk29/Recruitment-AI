import { useEffect, useState } from "react";
import { useNavigate, useParams, Link } from "react-router-dom";
import { ArrowLeft, Save } from "lucide-react";
import api from "../api/client.js";
import { useToast } from "../components/ui/Toast.jsx";
import { Card } from "../components/ui/Card.jsx";
import { Input, Textarea, Label, FormGroup } from "../components/ui/Field.jsx";
import Button from "../components/ui/Button.jsx";

const EMPTY = { title: "", department: "", location: "", description: "", requirements: "" };

export default function JobForm() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const [form, setForm] = useState(EMPTY);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (id) {
      api.get(`/jobs/${id}`).then((res) => setForm(res.data));
    }
  }, [id]);

  function handleChange(e) {
    setForm({ ...form, [e.target.name]: e.target.value });
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setSubmitting(true);
    try {
      if (id) {
        await api.put(`/jobs/${id}`, form);
        toast.success("Job updated");
      } else {
        await api.post("/jobs", form);
        toast.success("Job created");
      }
      navigate("/jobs");
    } catch (err) {
      toast.error(err.response?.data?.error || "Could not save job");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-6">
      <Link to="/jobs" className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-brand-700">
        <ArrowLeft className="h-4 w-4" /> Back to jobs
      </Link>
      <h1 className="text-2xl font-bold text-slate-900">{id ? "Edit Job" : "New Job"}</h1>

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
          <Button type="submit" loading={submitting}>
            <Save className="h-4 w-4" /> Save Job
          </Button>
        </form>
      </Card>
    </div>
  );
}
