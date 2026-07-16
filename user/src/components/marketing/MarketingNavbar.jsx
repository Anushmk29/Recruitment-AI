import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Menu, X, Sparkles } from "lucide-react";
import Button from "../ui/Button.jsx";

const LINKS = [
  { label: "Jobs", href: "/" },
  { label: "Interview Tips", href: "/welcome#tips" },
  { label: "About", href: "/welcome#about" },
  { label: "Contact", href: "/welcome#contact" },
];

export default function MarketingNavbar() {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();

  return (
    <header className="sticky top-0 z-50 border-b border-slate-200/80 bg-white/80 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-5 sm:px-8">
        <Link to="/welcome" className="flex items-center gap-2 font-display text-lg font-bold text-slate-900">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600 text-white">
            <Sparkles className="h-4.5 w-4.5" />
          </span>
          HireFlow <span className="text-brand-600">AI</span>
        </Link>

        <nav className="hidden items-center gap-8 md:flex">
          {LINKS.map((link) => (
            <a key={link.label} href={link.href} className="text-sm font-medium text-slate-600 transition hover:text-brand-700">
              {link.label}
            </a>
          ))}
        </nav>

        <div className="hidden items-center gap-3 md:flex">
          <Button variant="ghost" size="sm" onClick={() => navigate("/login")}>
            Log In
          </Button>
          <Button size="sm" onClick={() => navigate("/register")}>
            Create Account
          </Button>
        </div>

        <button className="md:hidden" onClick={() => setOpen((v) => !v)} aria-label="Toggle menu">
          {open ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
        </button>
      </div>

      {open && (
        <div className="border-t border-slate-200 bg-white px-5 pb-5 pt-3 md:hidden">
          <nav className="flex flex-col gap-3">
            {LINKS.map((link) => (
              <a key={link.label} href={link.href} className="py-1 text-sm font-medium text-slate-700" onClick={() => setOpen(false)}>
                {link.label}
              </a>
            ))}
          </nav>
          <div className="mt-4 flex flex-col gap-2">
            <Button variant="outline" onClick={() => navigate("/login")}>
              Log In
            </Button>
            <Button onClick={() => navigate("/register")}>Create Account</Button>
          </div>
        </div>
      )}
    </header>
  );
}
