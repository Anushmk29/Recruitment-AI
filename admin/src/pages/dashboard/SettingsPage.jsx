import { Building2, User, Mail, Phone } from "lucide-react";
import { useAdminAuth } from "../../auth/useAdminAuth.js";
import { useCompanyData } from "../../context/CompanyDataContext.jsx";
import { Card, Badge, Skeleton } from "../../components/ui/Card.jsx";

export default function SettingsPage() {
  const { user } = useAdminAuth();
  const { me, loading } = useCompanyData();
  const company = me?.company;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Settings</h1>
        <p className="mt-1 text-sm text-slate-500">Your account and company details.</p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <h2 className="mb-4 flex items-center gap-2 text-base font-semibold text-slate-900">
            <User className="h-4.5 w-4.5 text-brand-600" /> Account
          </h2>
          <dl className="space-y-3 text-sm">
            <div className="flex items-center justify-between">
              <dt className="text-slate-400">Name</dt>
              <dd className="font-medium text-slate-800">{user?.name || "—"}</dd>
            </div>
            <div className="flex items-center justify-between">
              <dt className="flex items-center gap-1.5 text-slate-400">
                <Mail className="h-3.5 w-3.5" /> Email
              </dt>
              <dd className="font-medium text-slate-800">{user?.email || "—"}</dd>
            </div>
            <div className="flex items-center justify-between">
              <dt className="flex items-center gap-1.5 text-slate-400">
                <Phone className="h-3.5 w-3.5" /> Phone
              </dt>
              <dd className="font-medium text-slate-800">{user?.phone || "—"}</dd>
            </div>
            <div className="flex items-center justify-between">
              <dt className="text-slate-400">Role</dt>
              <dd><Badge tone="brand">{user?.role}</Badge></dd>
            </div>
          </dl>
        </Card>

        <Card>
          <h2 className="mb-4 flex items-center gap-2 text-base font-semibold text-slate-900">
            <Building2 className="h-4.5 w-4.5 text-brand-600" /> Company
          </h2>
          {loading ? (
            <Skeleton className="h-24 w-full" />
          ) : (
            <dl className="space-y-3 text-sm">
              <div className="flex items-center justify-between">
                <dt className="text-slate-400">Company Name</dt>
                <dd className="font-medium text-slate-800">{company?.name || "—"}</dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="text-slate-400">Company Code</dt>
                <dd className="font-mono text-xs font-medium text-slate-800">{company?.companyCode || "—"}</dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="text-slate-400">Status</dt>
                <dd><Badge tone={company?.status === "active" ? "green" : "amber"}>{company?.status || "—"}</Badge></dd>
              </div>
            </dl>
          )}
        </Card>
      </div>
    </div>
  );
}
