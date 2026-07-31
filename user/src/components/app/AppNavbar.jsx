import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Sparkles, Menu, X, LogOut, LayoutDashboard, FileText, UserRound } from "lucide-react";
import { useAccountAuth } from "../../auth/useAccountAuth.js";
import { logoutAccount } from "../../auth/logout.js";
import NotificationBell from "./NotificationBell.jsx";

// Public links, shown to everyone. "Interview Dashboard" is deliberately NOT
// here: /portal/dashboard needs a magic-link session, so for a signed-in
// candidate without one it is a dead end that looks like their dashboard.
const PUBLIC_LINKS = [
  { to: "/", label: "Careers" },
  { to: "/welcome", label: "How it Works" },
];

// Signed-in links. "Dashboard" is labelled as itself rather than being folded
// into the account name — it used to render as the user's name with a
// dashboard icon, which reads as a profile menu, so the tracking screen was
// effectively unreachable for anyone who did not already know the URL.
const ACCOUNT_LINKS = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/resume", label: "My Resumes", icon: FileText },
];

function AccountLinks({ onNavigate }) {
  const { isAuthenticated, user } = useAccountAuth();
  const navigate = useNavigate();

  if (!isAuthenticated) {
    return (
      <>
        <Link to="/login" onClick={onNavigate} className="text-sm font-medium text-slate-600 hover:text-brand-700">
          Log In
        </Link>
        <Link
          to="/register"
          onClick={onNavigate}
          className="rounded-xl bg-brand-600 px-4 py-2 text-sm font-semibold text-white shadow-soft transition hover:bg-brand-700"
        >
          Register
        </Link>
      </>
    );
  }

  return (
    <>
      <NotificationBell />
      <Link
        to="/account"
        onClick={onNavigate}
        className="flex items-center gap-1.5 text-sm font-medium text-slate-600 hover:text-brand-700"
      >
        <UserRound className="h-4 w-4" /> {user?.name || "Account"}
      </Link>
      <button
        type="button"
        onClick={() => {
          logoutAccount();
          onNavigate?.();
          navigate("/login");
        }}
        className="flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-red-600"
      >
        <LogOut className="h-4 w-4" /> Log Out
      </button>
    </>
  );
}

export default function AppNavbar() {
  const [open, setOpen] = useState(false);
  const { isAuthenticated } = useAccountAuth();
  const links = isAuthenticated ? [...PUBLIC_LINKS, ...ACCOUNT_LINKS] : PUBLIC_LINKS;

  return (
    <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/90 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-5xl items-center justify-between px-5 sm:px-8">
        <Link to="/" className="flex items-center gap-2 font-display text-lg font-bold text-slate-900">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600 text-white">
            <Sparkles className="h-4.5 w-4.5" />
          </span>
          HireFlow <span className="text-brand-600">AI</span>
        </Link>

        <nav className="hidden items-center gap-6 md:flex">
          {links.map((link) => (
            <Link
              key={link.to}
              to={link.to}
              className="flex items-center gap-1.5 text-sm font-medium text-slate-600 hover:text-brand-700"
            >
              {link.icon && <link.icon className="h-4 w-4" />}
              {link.label}
            </Link>
          ))}
          <span className="h-5 w-px bg-slate-200" />
          <AccountLinks />
        </nav>

        <button className="md:hidden" onClick={() => setOpen((v) => !v)} aria-label="Toggle menu">
          {open ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
        </button>
      </div>

      {open && (
        <div className="border-t border-slate-200 bg-white px-5 pb-5 pt-3 md:hidden">
          <nav className="flex flex-col gap-3">
            {links.map((link) => (
              <Link
                key={link.to}
                to={link.to}
                onClick={() => setOpen(false)}
                className="flex items-center gap-1.5 py-1 text-sm font-medium text-slate-700"
              >
                {link.icon && <link.icon className="h-4 w-4" />}
                {link.label}
              </Link>
            ))}
            <div className="mt-2 flex flex-col gap-3 border-t border-slate-100 pt-3">
              <AccountLinks onNavigate={() => setOpen(false)} />
            </div>
          </nav>
        </div>
      )}
    </header>
  );
}
