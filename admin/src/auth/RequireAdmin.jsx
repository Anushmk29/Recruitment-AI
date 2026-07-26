import { Navigate, useLocation } from "react-router-dom";
import { useAdminAuth } from "./useAdminAuth.js";
import { getViewAsCompany } from "../api/client.js";

// Phase 13 fix: this used to check only that a token existed — any stored
// token (a candidate account, a superadmin) opened the recruiter dashboard.
// Now the stored user's role must actually be "admin". Superadmins are
// platform staff: they get the platform console, or — with view-as active
// (Phase 16.5) — a read-only look at one tenant's dashboard, where the server
// rejects every mutation they might attempt.
export default function RequireAdmin({ children }) {
  const { isAuthenticated, user } = useAdminAuth();
  const location = useLocation();

  if (!isAuthenticated) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  if (user?.role === "superadmin") {
    if (getViewAsCompany()) return children; // read-only, server-enforced
    return <Navigate to="/platform" replace />;
  }

  if (user?.role !== "admin") {
    return <Navigate to="/login" replace state={{ from: location.pathname, roleDenied: true }} />;
  }

  return children;
}
