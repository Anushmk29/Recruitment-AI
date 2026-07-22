import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { LogOut, User } from "lucide-react";
import api from "../api/client.js";
import { accountAuthHeader, clearAccountAuth } from "../auth/accountAuth.js";
import { logoutAccount } from "../auth/logout.js";
import { Card, Badge, Skeleton } from "../components/ui/Card.jsx";
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
      <h1 className="text-2xl font-bold text-slate-900">My Account</h1>
      <Card>
        <div className="mb-5 flex items-center gap-3">
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-brand-100 text-brand-700">
            <User className="h-6 w-6" />
          </span>
          <div>
            <p className="text-lg font-semibold text-slate-900">{profile.name}</p>
            <Badge tone="brand">{profile.role}</Badge>
          </div>
        </div>
        <dl className="space-y-2 border-t border-slate-100 pt-4 text-sm">
          <div className="flex items-center justify-between">
            <dt className="text-slate-400">Email</dt>
            <dd className="font-medium text-slate-800">{profile.email}</dd>
          </div>
          {profile.phone && (
            <div className="flex items-center justify-between">
              <dt className="text-slate-400">Phone</dt>
              <dd className="font-medium text-slate-800">{profile.phone}</dd>
            </div>
          )}
        </dl>
        <Button variant="outline" onClick={handleLogout} className="mt-6 w-full">
          <LogOut className="h-4 w-4" /> Log Out
        </Button>
      </Card>
    </div>
  );
}
