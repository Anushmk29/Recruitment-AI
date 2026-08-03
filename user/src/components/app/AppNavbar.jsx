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

// Every nav control shares one shell so focus, hit area, and hover read the
// same across links and buttons. `tap-target` lifts these to 44px on a thumb;
// on a mouse they stay at their text height, which is what keeps the bar tight.
// The hover pill (px-3 + a brand-50 ground) is what makes a row of bare text
// links read as navigation rather than as prose — it gives each item a visible
// extent before the pointer commits to it.
const NAV_ACTION =
  "tap-target inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2";

// The drawer the hamburger controls. A fixed id rather than useId(): the header
// mounts once, and `aria-controls` has to name a node that exists.
const MOBILE_NAV_ID = "app-nav-mobile";

function AccountLinks({ onNavigate }) {
  const { isAuthenticated, user } = useAccountAuth();
  const navigate = useNavigate();

  if (!isAuthenticated) {
    return (
      <>
        <Link
          to="/login"
          onClick={onNavigate}
          className={`${NAV_ACTION} text-slate-600 hover:bg-brand-50 hover:text-brand-700 focus-visible:ring-brand-200`}
        >
          Log In
        </Link>
        <Link
          to="/register"
          onClick={onNavigate}
          className="tap-target inline-flex items-center justify-center rounded-xl bg-brand-600 px-4 py-2 text-sm font-semibold text-white shadow-soft transition-colors hover:bg-brand-700 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-300"
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
        className={`${NAV_ACTION} text-slate-600 hover:bg-brand-50 hover:text-brand-700 focus-visible:ring-brand-200`}
      >
        <UserRound className="h-4 w-4" aria-hidden="true" />
        {/* A long display name should not push the nav wider than the viewport. */}
        <span className="max-w-[10rem] truncate">{user?.name || "Account"}</span>
      </Link>
      <button
        type="button"
        onClick={() => {
          logoutAccount();
          onNavigate?.();
          navigate("/login");
        }}
        className={`${NAV_ACTION} text-slate-500 hover:text-red-600 focus-visible:ring-red-200`}
      >
        <LogOut className="h-4 w-4" aria-hidden="true" /> Log Out
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
        <Link
          to="/"
          className="flex items-center gap-2 rounded-lg font-display text-lg font-bold text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300"
        >
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600 text-white">
            <Sparkles className="h-4.5 w-4.5" aria-hidden="true" />
          </span>
          HireFlow <span className="text-brand-600">AI</span>
        </Link>

        <nav aria-label="Main" className="hidden items-center gap-5 md:flex">
          {links.map((link) => (
            <Link
              key={link.to}
              to={link.to}
              className={`${NAV_ACTION} text-slate-600 hover:bg-brand-50 hover:text-brand-700 focus-visible:ring-brand-200`}
            >
              {link.icon && <link.icon className="h-4 w-4" aria-hidden="true" />}
              {link.label}
            </Link>
          ))}
          <span aria-hidden="true" className="h-5 w-px bg-slate-200" />
          <AccountLinks />
        </nav>

        <button
          type="button"
          className="tap-target -mr-1.5 flex items-center justify-center rounded-lg p-1.5 text-slate-600 transition-colors hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300 md:hidden"
          onClick={() => setOpen((v) => !v)}
          aria-label={open ? "Close menu" : "Open menu"}
          aria-expanded={open}
          aria-controls={MOBILE_NAV_ID}
        >
          {open ? <X className="h-6 w-6" aria-hidden="true" /> : <Menu className="h-6 w-6" aria-hidden="true" />}
        </button>
      </div>

      {open && (
        <div id={MOBILE_NAV_ID} className="border-t border-slate-200 bg-white px-5 pb-5 pt-3 md:hidden">
          {/* Not "Main" — the desktop <nav> holds that name and is still in the
              DOM behind `hidden`. Two landmarks with one label is a maze. */}
          <nav aria-label="Mobile" className="flex flex-col gap-1">
            {links.map((link) => (
              <Link
                key={link.to}
                to={link.to}
                onClick={() => setOpen(false)}
                className={`${NAV_ACTION} text-slate-700 hover:bg-brand-50 hover:text-brand-700 focus-visible:ring-brand-200`}
              >
                {link.icon && <link.icon className="h-4 w-4" aria-hidden="true" />}
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
