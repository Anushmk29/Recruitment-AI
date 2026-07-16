import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { motion } from "framer-motion";
import { CalendarCheck, CheckCircle2 } from "lucide-react";
import MarketingNavbar from "../components/marketing/MarketingNavbar.jsx";
import { Card } from "../components/ui/Card.jsx";
import { Input, Textarea, Select, Label, FieldError, FormGroup } from "../components/ui/Field.jsx";
import Button from "../components/ui/Button.jsx";

const SALES_EMAIL = "sales@hireflow.ai";

const schema = z.object({
  companyName: z.string().min(2, "Company name is required"),
  email: z.string().email("Enter a valid email address"),
  phone: z.string().min(7, "Enter a valid phone number"),
  companySize: z.string().min(1, "Select a company size"),
  message: z.string().optional(),
});

export default function Demo() {
  const [sent, setSent] = useState(false);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm({ resolver: zodResolver(schema) });

  function onSubmit(data) {
    const body = encodeURIComponent(
      `Company: ${data.companyName}\nEmail: ${data.email}\nPhone: ${data.phone}\nCompany Size: ${data.companySize}\n\nMessage:\n${data.message || "-"}`
    );
    window.location.href = `mailto:${SALES_EMAIL}?subject=${encodeURIComponent(
      `Demo request from ${data.companyName}`
    )}&body=${body}`;
    setSent(true);
  }

  return (
    <div className="min-h-screen bg-white">
      <MarketingNavbar />
      <div className="mx-auto flex max-w-3xl flex-col items-center px-5 py-20 sm:px-8">
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="mb-10 text-center">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-100 px-3 py-1 text-xs font-semibold text-brand-700">
            <CalendarCheck className="h-3.5 w-3.5" /> Book a walkthrough
          </span>
          <h1 className="mt-4 text-3xl font-bold text-slate-900 sm:text-4xl">Request a Demo</h1>
          <p className="mt-3 text-slate-600">
            Tell us about your team and we'll walk you through how HireFlow AI fits your hiring workflow.
          </p>
        </motion.div>

        <Card className="w-full">
          {sent ? (
            <div className="flex flex-col items-center py-8 text-center">
              <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100 text-emerald-600">
                <CheckCircle2 className="h-6 w-6" />
              </div>
              <h3 className="text-lg font-semibold text-slate-900">Thanks — we'll be in touch</h3>
              <p className="mt-1.5 max-w-sm text-sm text-slate-500">
                Your email client should have opened with your request pre-filled to our sales team. If it didn't,
                write to us directly at <a className="font-medium text-brand-700" href={`mailto:${SALES_EMAIL}`}>{SALES_EMAIL}</a>.
              </p>
            </div>
          ) : (
            <form onSubmit={handleSubmit(onSubmit)} noValidate>
              <div className="grid gap-4 sm:grid-cols-2">
                <FormGroup>
                  <Label required>Company Name</Label>
                  <Input {...register("companyName")} error={errors.companyName} placeholder="Acme Inc." />
                  <FieldError>{errors.companyName?.message}</FieldError>
                </FormGroup>
                <FormGroup>
                  <Label required>Work Email</Label>
                  <Input type="email" {...register("email")} error={errors.email} placeholder="you@company.com" />
                  <FieldError>{errors.email?.message}</FieldError>
                </FormGroup>
                <FormGroup>
                  <Label required>Phone</Label>
                  <Input type="tel" {...register("phone")} error={errors.phone} placeholder="+91 98765 43210" />
                  <FieldError>{errors.phone?.message}</FieldError>
                </FormGroup>
                <FormGroup>
                  <Label required>Company Size</Label>
                  <Select {...register("companySize")} error={errors.companySize} defaultValue="">
                    <option value="" disabled>
                      Select size
                    </option>
                    <option value="1-10">1-10 employees</option>
                    <option value="11-50">11-50 employees</option>
                    <option value="51-200">51-200 employees</option>
                    <option value="201-500">201-500 employees</option>
                    <option value="500+">500+ employees</option>
                  </Select>
                  <FieldError>{errors.companySize?.message}</FieldError>
                </FormGroup>
              </div>
              <FormGroup>
                <Label>Message (optional)</Label>
                <Textarea rows={4} {...register("message")} placeholder="What are you hoping to solve?" />
              </FormGroup>
              <Button type="submit" size="lg" loading={isSubmitting} className="w-full">
                Request Demo
              </Button>
            </form>
          )}
        </Card>
      </div>
    </div>
  );
}
