import { useCallback, useEffect, useRef, useState } from "react";
import { Link, NavLink, useLocation, useNavigate } from "react-router-dom";
import {
  Sparkles,
  Menu,
  X,
  LogOut,
  LayoutDashboard,
  FileText,
  UserRound,
  Briefcase,
  BookOpen,
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react";
import { useAccountAuth } from "../../auth/useAccountAuth.js";
import { logoutAccount } from "../../auth/logout.js";
import { NotificationProvider } from "../../context/NotificationContext.jsx";
import NotificationBell from "./NotificationBell.jsx";

/**
 * The candidate app's chrome: a collapsible left rail, a slim header that owns
 * identity, and the content column.
 *
 * DESIGN.md used to say this app has no sidebar, on the grounds that a fixed
 * 256px rail of mostly-irrelevant links spends a quarter of a phone viewport
 * saying so. That objection is answered by collapsibility rather than by going
 * back to a top bar: the rail is off-canvas below `lg`, and above it the reader
 * can drop it to an icon-only strip and keep the choice. The doc has been
 * updated to match.
 *
 * Division of labour, same as the admin shell so the two apps don't drift:
 * the SIDEBAR holds destinations, the HEADER holds who you are (notifications,
 * account, sign in/out). Nothing appears in both.
 */

// Public destinations. "How it Works" is the explainer for someone still
// deciding whether to trust an AI screen — it lives on the marketing landing
// page. A signed-in candidate has already decided and is now inside a process
// with state; sending them back out to the pitch is chrome that costs a row and
// tells them nothing about their application. So it is public-only, not
// permanent.
//
// "Interview Dashboard" (/portal/dashboard) is deliberately in NEITHER list: it
// needs a magic-link session, so for a signed-in candidate without one it is a
// dead end that looks like their dashboard.
const PUBLIC_NAV = [
  { to: "/", label: "Careers", icon: Briefcase, end: true },
  { to: "/welcome", label: "How it Works", icon: BookOpen },
];

const ACCOUNT_NAV = [
  { to: "/", label: "Careers", icon: Briefcase, end: true },
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/resume", label: "My Resumes", icon: FileText },
];

// Fixed ids rather than useId(): `aria-controls` has to name a node that
// actually exists, and both of these are referenced from a control that lives
// in a different component.
const SIDEBAR_ID = "app-sidebar";
const DRAWER_ID = "app-sidebar-drawer";

// Remembered across visits — a reader who collapsed the rail to get their
// screen back does not want to redo it on every page load. Wrapped because
// localStorage throws outright in some privacy modes, and a nav that crashes
// the app is a worse outcome than a nav that forgets.
const COLLAPSE_KEY = "candidateNavCollapsed";
function readCollapsed() {
  try {
    return window.localStorage.getItem(COLLAPSE_KEY) === "1";
  } catch {
    return false;
  }
}
function writeCollapsed(value) {
  try {
    window.localStorage.setItem(COLLAPSE_KEY, value ? "1" : "0");
  } catch {
    /* non-fatal: the preference just doesn't survive the session */
  }
}

const NAV_ROW =
  "tap-target flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium whitespace-nowrap transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600";

const HEADER_ACTION =
  "tap-target inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2";

// Everything the drawer's focus trap considers reachable.
const FOCUSABLE = 'a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])';

// `label` is a required distinction, not decoration. The persistent rail is
// still in the DOM below `lg` behind `hidden`, so when the drawer is open there
// are two of these mounted at once — and two navigation landmarks sharing one
// name is a maze to anyone listing landmarks to get their bearings.
function SidebarNav({ collapsed, onNavigate, label }) {
  const { isAuthenticated } = useAccountAuth();
  const items = isAuthenticated ? ACCOUNT_NAV : PUBLIC_NAV;

  return (
    <nav aria-label={label} className="flex flex-1 flex-col gap-1 overflow-y-auto px-3 py-2">
      {items.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.end}
          onClick={onNavigate}
          // The tooltip is for the pointer; the sr-only label below is what
          // gives the link an accessible name once the text is gone. An
          // icon-only rail with neither is a row of unnamed links.
          title={collapsed ? item.label : undefined}
          className={({ isActive }) =>
            `${NAV_ROW} ${collapsed ? "justify-center px-2" : ""} ${
              isActive ? "bg-brand-600 text-white shadow-soft" : "text-slate-600 hover:bg-brand-50 hover:text-brand-700"
            }`
          }
        >
          <item.icon className="h-4.5 w-4.5 shrink-0" aria-hidden="true" />
          <span className={collapsed ? "sr-only" : "truncate"}>{item.label}</span>
        </NavLink>
      ))}
    </nav>
  );
}

function SidebarBrand({ collapsed, onNavigate }) {
  return (
    <Link
      to="/"
      onClick={onNavigate}
      className={`flex h-16 shrink-0 items-center gap-2 rounded-lg font-display text-lg font-bold text-slate-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 ${
        collapsed ? "justify-center px-2" : "px-5"
      }`}
    >
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-600 text-white">
        <Sparkles className="h-4.5 w-4.5" aria-hidden="true" />
      </span>
      {/* Collapsed, the wordmark is dropped from the layout but kept for
          assistive tech — the link is still "HireFlow AI, home". */}
      <span className={collapsed ? "sr-only" : "whitespace-nowrap"}>
        HireFlow <span className="text-brand-600">AI</span>
      </span>
    </Link>
  );
}

/** Identity and session — the header's right side, at every width. */
function HeaderActions({ onNavigate }) {
  const { isAuthenticated, user } = useAccountAuth();
  const navigate = useNavigate();

  if (!isAuthenticated) {
    return (
      <>
        <Link
          to="/login"
          onClick={onNavigate}
          className={`${HEADER_ACTION} text-slate-600 hover:bg-brand-50 hover:text-brand-700 focus-visible:ring-brand-200`}
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
        className={`${HEADER_ACTION} text-slate-600 hover:bg-brand-50 hover:text-brand-700 focus-visible:ring-brand-200`}
      >
        <UserRound className="h-4 w-4 shrink-0" aria-hidden="true" />
        {/* The name is the first thing to go on a narrow header — the icon
            still identifies the destination, and a long display name would
            otherwise push the row wider than the viewport. */}
        <span className="hidden max-w-[10rem] truncate sm:inline">{user?.name || "Account"}</span>
      </Link>
      <button
        type="button"
        onClick={() => {
          logoutAccount();
          onNavigate?.();
          navigate("/login");
        }}
        className={`${HEADER_ACTION} text-slate-500 hover:text-red-600 focus-visible:ring-red-200`}
      >
        <LogOut className="h-4 w-4 shrink-0" aria-hidden="true" />
        <span className="hidden sm:inline">Log Out</span>
        <span className="sr-only sm:hidden">Log Out</span>
      </button>
    </>
  );
}

function ShellInner({ children }) {
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const { pathname } = useLocation();
  const panelRef = useRef(null);
  const closeRef = useRef(null);

  const toggleCollapsed = useCallback(() => {
    setCollapsed((v) => {
      writeCollapsed(!v);
      return !v;
    });
  }, []);

  // Following a link inside the drawer navigates; the drawer has no reason to
  // still be covering the page you just asked for.
  useEffect(() => {
    setDrawerOpen(false);
  }, [pathname]);

  // The drawer's own close button is `lg:hidden`. If the viewport crosses into
  // `lg` while it is open, that button disappears along with it — and the body
  // scroll lock below would outlive the only way to release it. Close on the
  // breakpoint rather than hiding an open drawer at it.
  useEffect(() => {
    if (!drawerOpen) return undefined;
    const mq = window.matchMedia("(min-width: 1024px)");
    const close = () => mq.matches && setDrawerOpen(false);
    close();
    mq.addEventListener("change", close);
    return () => mq.removeEventListener("change", close);
  }, [drawerOpen]);

  // Drawer behaviour while open: lock the page behind it, keep Tab inside it,
  // close on Escape, and hand focus back to whatever opened it. Without the
  // trap, Tab walks straight out of the panel into the page under the scrim —
  // which a sighted mouse user cannot reach but a keyboard user silently can.
  useEffect(() => {
    if (!drawerOpen) return undefined;
    const panel = panelRef.current;
    const opener = document.activeElement;
    closeRef.current?.focus();

    function onKeyDown(event) {
      if (event.key === "Escape") {
        setDrawerOpen(false);
        return;
      }
      if (event.key !== "Tab" || !panel) return;
      const items = panel.querySelectorAll(FOCUSABLE);
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      if (opener instanceof HTMLElement && document.contains(opener)) opener.focus({ preventScroll: true });
    };
  }, [drawerOpen]);

  return (
    <div className="flex min-h-screen">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[60] focus:rounded-xl focus:bg-brand-600 focus:px-4 focus:py-2.5 focus:text-sm focus:font-semibold focus:text-white focus:shadow-soft"
      >
        Skip to main content
      </a>

      {/* Persistent rail, `lg` and up. `sticky h-screen` rather than a plain
          full-height column: the rail should stay put while a long job list
          scrolls past it, not scroll away with the page. */}
      <aside
        id={SIDEBAR_ID}
        className={`sticky top-0 hidden h-screen shrink-0 flex-col border-r border-slate-200 bg-white transition-[width] duration-200 motion-reduce:transition-none lg:flex ${
          collapsed ? "w-[4.5rem]" : "w-64"
        }`}
      >
        <SidebarBrand collapsed={collapsed} />
        <SidebarNav collapsed={collapsed} label="Main" />
      </aside>

      {/* Off-canvas drawer, below `lg`. Rendered only while open, which is also
          why the header's `aria-controls` only names it while open. */}
      {drawerOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div
            className="absolute inset-0 bg-slate-900/50"
            aria-hidden="true"
            onClick={() => setDrawerOpen(false)}
          />
          <div
            ref={panelRef}
            id={DRAWER_ID}
            role="dialog"
            aria-modal="true"
            aria-label="Navigation menu"
            className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col border-r border-slate-200 bg-white shadow-soft"
          >
            <button
              ref={closeRef}
              type="button"
              onClick={() => setDrawerOpen(false)}
              aria-label="Close menu"
              className="tap-target absolute right-3 top-4 inline-flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
            >
              <X className="h-5 w-5" aria-hidden="true" />
            </button>
            <SidebarBrand onNavigate={() => setDrawerOpen(false)} />
            <SidebarNav label="Menu" onNavigate={() => setDrawerOpen(false)} />
          </div>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-40 flex h-16 items-center justify-between gap-2 border-b border-slate-200 bg-white/90 px-4 backdrop-blur sm:px-6">
          <div className="flex min-w-0 items-center gap-2">
            {/* Two controls, not one with branching behaviour: below `lg` the
                rail is off-canvas and the gesture is "open the menu"; above it
                the rail is already there and the gesture is "give me the
                space back". Conflating them makes the icon lie at one width. */}
            <button
              type="button"
              onClick={() => setDrawerOpen(true)}
              aria-label="Open menu"
              aria-expanded={drawerOpen}
              aria-controls={drawerOpen ? DRAWER_ID : undefined}
              className="tap-target -ml-1.5 inline-flex items-center justify-center rounded-lg p-1.5 text-slate-600 transition-colors hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300 lg:hidden"
            >
              <Menu className="h-6 w-6" aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={toggleCollapsed}
              aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
              aria-expanded={!collapsed}
              aria-controls={SIDEBAR_ID}
              className="tap-target -ml-1.5 hidden items-center justify-center rounded-lg p-1.5 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300 lg:inline-flex"
            >
              {collapsed ? (
                <PanelLeftOpen className="h-5 w-5" aria-hidden="true" />
              ) : (
                <PanelLeftClose className="h-5 w-5" aria-hidden="true" />
              )}
            </button>

            {/* The wordmark lives in the rail; below `lg` the rail is off-canvas,
                so the header carries it instead. */}
            <Link
              to="/"
              className="flex items-center gap-2 rounded-lg font-display text-base font-bold text-slate-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 lg:hidden"
            >
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-600 text-white">
                <Sparkles className="h-4.5 w-4.5" aria-hidden="true" />
              </span>
              <span className="truncate">
                HireFlow <span className="text-brand-600">AI</span>
              </span>
            </Link>
          </div>

          <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
            <HeaderActions />
          </div>
        </header>

        <main id="main-content" tabIndex={-1} className="flex-1 focus:outline-none">
          <div className="mx-auto max-w-5xl px-5 py-8 sm:px-8">{children}</div>
        </main>
      </div>
    </div>
  );
}

export default function AppShell({ children }) {
  return (
    <NotificationProvider>
      <ShellInner>{children}</ShellInner>
    </NotificationProvider>
  );
}
