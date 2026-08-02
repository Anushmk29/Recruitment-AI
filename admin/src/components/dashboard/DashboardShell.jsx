import { useState } from "react";
import { NavLink, useNavigate, useLocation } from "react-router-dom";
import {
  LayoutDashboard,
  Briefcase,
  Users,
  KanbanSquare,
  Bot,
  BarChart3,
  CreditCard,
  Bell,
  Settings,
  LogOut,
  Menu,
  X,
  ChevronDown,
  Scale,
  History,
} from "lucide-react";
import { useAdminAuth } from "../../auth/useAdminAuth.js";
import { clearAdminAuth, getAdminRefreshToken } from "../../auth/adminAuth.js";
import api, { getViewAsCompany, setViewAsCompany } from "../../api/client.js";
import { CompanyDataProvider, useCompanyData } from "../../context/CompanyDataContext.jsx";
import { NotificationProvider } from "../../context/NotificationContext.jsx";
import NotificationBell from "./NotificationBell.jsx";

const NAV_ITEMS = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, end: true },
  { to: "/jobs", label: "Jobs", icon: Briefcase },
  { to: "/candidates", label: "Candidates", icon: Users },
  { to: "/review-queue", label: "Review Queue", icon: Scale },
  { to: "/pipeline", label: "Pipeline", icon: KanbanSquare },
  { to: "/ai-interviews", label: "AI Interviews", icon: Bot },
  { to: "/reports", label: "Reports", icon: BarChart3 },
  { to: "/subscription", label: "Subscription", icon: CreditCard },
  { to: "/notifications", label: "Notifications", icon: Bell },
  { to: "/audit-trail", label: "Audit Trail", icon: History },
  { to: "/settings", label: "Settings", icon: Settings },
];

function SidebarContent({ onNavigate }) {
  return (
    <>
      {/* Monogram, not a sparkle. DESIGN.md's Don't list names sparkle icons
          explicitly — on a product whose credibility rests on looking measured,
          the AI-hype glyph works against the pitch. */}
      <div className="flex h-16 items-center gap-2 px-5 font-display text-lg font-bold text-white">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600 text-sm font-bold text-white">
          H
        </span>
        HireFlow AI
      </div>
      <nav aria-label="Dashboard" className="mt-4 flex flex-1 flex-col gap-1 px-3">
        {NAV_ITEMS.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            onClick={onNavigate}
            className={({ isActive }) =>
              // Named properties, not `transition`: the bare utility animates
              // box-shadow too, which would fade the focus ring in.
              `flex items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm font-medium whitespace-nowrap transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-400 ${
                isActive ? "bg-brand-600 text-white shadow-soft" : "text-slate-300 hover:bg-white/5 hover:text-white"
              }`
            }
          >
            <item.icon className="h-4.5 w-4.5 shrink-0" aria-hidden="true" />
            {item.label}
          </NavLink>
        ))}
      </nav>
    </>
  );
}

function TopNav({ onMenuClick }) {
  const { user } = useAdminAuth();
  const { me } = useCompanyData();
  const navigate = useNavigate();
  const [profileOpen, setProfileOpen] = useState(false);
  const companyName = me?.company?.name || "Your Workspace";

  return (
    <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-slate-200 bg-white/90 px-4 backdrop-blur sm:px-6">
      <div className="flex items-center gap-3">
        <button className="text-slate-500 lg:hidden" onClick={onMenuClick} aria-label="Open menu">
          <Menu className="h-5.5 w-5.5" />
        </button>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-slate-800">{companyName}</p>
          {/* slate-500, not slate-400: 4.76:1 vs 2.8:1 on white. */}
          <p className="truncate text-xs tabular-nums text-slate-500">{me?.company?.companyCode}</p>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <NotificationBell />

        <div className="relative">
          <button
            onClick={() => setProfileOpen((v) => !v)}
            className="flex items-center gap-2 rounded-full px-2 py-1.5 transition-colors duration-150 hover:bg-slate-100"
          >
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-100 text-sm font-bold text-brand-700">
              {(user?.name || "A")[0].toUpperCase()}
            </span>
            <span className="hidden text-sm font-medium text-slate-700 sm:block">{user?.name}</span>
            <ChevronDown className="h-4 w-4 text-slate-500" />
          </button>
          {profileOpen && (
            <div
              className="absolute right-0 mt-2 w-48 rounded-xl border border-slate-200 bg-white py-1.5 shadow-soft"
              onMouseLeave={() => setProfileOpen(false)}
            >
              <button
                onClick={() => navigate("/settings")}
                className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-slate-600 hover:bg-slate-50"
              >
                <Settings className="h-4 w-4" /> Settings
              </button>
              <button
                onClick={() => {
                  // Best-effort server-side revocation of the refresh-token family, then
                  // clear local state regardless of the request outcome.
                  const refreshToken = getAdminRefreshToken();
                  if (refreshToken) {
                    api.post("/auth/logout", { refreshToken }).catch(() => {});
                  }
                  clearAdminAuth();
                  navigate("/login");
                }}
                className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-red-600 hover:bg-red-50"
              >
                <LogOut className="h-4 w-4" /> Log Out
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}

function ShellInner({ children }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const { pathname } = useLocation();
  const viewAs = getViewAsCompany();

  return (
    <div className="flex min-h-screen flex-col bg-slate-50">
      {/* Phase 16.5 — view-as banner: platform staff looking at a tenant.
          Read-only is enforced SERVER-side; this banner is honesty, not the guard. */}
      {viewAs && (
        <div className="flex items-center justify-between gap-3 bg-amber-500 px-4 py-2 text-sm font-medium text-white">
          <span>
            Viewing as tenant <span className="font-bold">{viewAs.name}</span> — read-only. Every mutation is rejected by
            the server.
          </span>
          <button
            onClick={() => {
              setViewAsCompany(null);
              window.location.assign("/platform");
            }}
            className="shrink-0 rounded-lg bg-white/20 px-3 py-1 text-xs font-semibold hover:bg-white/30"
          >
            Exit view-as
          </button>
        </div>
      )}
      <div className="flex min-h-0 flex-1">
      <aside className="hidden w-64 shrink-0 flex-col bg-slate-900 lg:flex">
        <SidebarContent />
      </aside>

      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-slate-900/50" onClick={() => setMobileOpen(false)} />
          <aside className="absolute inset-y-0 left-0 flex w-64 flex-col bg-slate-900">
            <button
              className="absolute right-3 top-4 rounded-lg p-1 text-slate-300 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-400"
              onClick={() => setMobileOpen(false)}
              aria-label="Close menu"
            >
              <X className="h-5 w-5" />
            </button>
            <SidebarContent onNavigate={() => setMobileOpen(false)} />
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <TopNav onMenuClick={() => setMobileOpen(true)} />
        {/* Keyed on the route so every dashboard screen gets the same quiet
            entrance — one place, twenty pages. Reduced motion neutralises the
            keyframe in index.css rather than here. */}
        <main key={pathname} data-page-enter="" className="flex-1 px-4 py-6 sm:px-6 lg:px-8">
          {children}
        </main>
      </div>
      </div>
    </div>
  );
}

export default function DashboardShell({ children }) {
  return (
    <CompanyDataProvider>
      <NotificationProvider>
        <ShellInner>{children}</ShellInner>
      </NotificationProvider>
    </CompanyDataProvider>
  );
}
