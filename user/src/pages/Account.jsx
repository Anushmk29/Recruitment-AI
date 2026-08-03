import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { LogOut, User } from "lucide-react";
import api from "../api/client.js";
import { accountAuthHeader, clearAccountAuth } from "../auth/accountAuth.js";
import { logoutAccount } from "../auth/logout.js";
import { Card, Badge, Skeleton, IconTile } from "../components/ui/Card.jsx";
import { PageHero } from "../components/ui/Panels.jsx";
import Button from "../components/ui/Button.jsx";

export default function Account() {
  const navigate = useNavigate();
  const [profile, setProfile] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await api.get("/auth/me", { headers: accountAuthHeader() });
        if (!cancelled) setProfile(res.data);
      } catch (err) {
        if (cancelled) return;
        clearAccountAuth();
        setError("Your session has expired. Please log in again.");
        setTimeout(() => navigate("/login", { replace: true }), 1200);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [navigate]);

  function handleLogout() {
    logoutAccount();
    navigate("/login", { replace: true });
  }

  if (error) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold text-slate-900">My Account</h1>
        <p className="text-sm font-medium text-red-600">{error}</p>
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-6 w-40" />
        <Card><Skeleton className="h-32 w-full" /></Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHero
        eyebrow="Account"
        eyebrowIcon={User}
        title="My account"
        description="The details this portal signs you in with."
      />

      <Card>
        <div className="flex items-center gap-4">
          <IconTile icon={User} size="lg" />
          <div className="min-w-0">
            <p className="font-display text-xl font-bold tracking-tight break-words text-slate-900">{profile.name}</p>
            <Badge tone="brand" className="mt-1.5">
              {profile.role}
            </Badge>
          </div>
        </div>

        <dl className="mt-6 space-y-2.5 border-t border-slate-100 pt-6 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-canvas px-4 py-3">
            {/* Was `slate-400` — 2.5:1 on white. A definition term is a label,
                not a watermark. */}
            <dt className="text-slate-600">Email</dt>
            <dd className="font-medium break-all text-slate-900">{profile.email}</dd>
          </div>
          {profile.phone && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-canvas px-4 py-3">
              <dt className="text-slate-600">Phone</dt>
              <dd className="font-medium text-slate-900">{profile.phone}</dd>
            </div>
          )}
        </dl>

        <Button variant="outline" onClick={handleLogout} className="mt-6 w-full">
          <LogOut className="h-4 w-4" aria-hidden="true" /> Log Out
        </Button>
      </Card>
    </div>
  );
}
