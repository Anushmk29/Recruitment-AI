import { useEffect, useState } from "react";
import { getAdminAuth } from "./adminAuth.js";

export function useAdminAuth() {
  const [auth, setAuth] = useState(getAdminAuth());

  useEffect(() => {
    function refresh() {
      setAuth(getAdminAuth());
    }
    window.addEventListener("admin-auth-changed", refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener("admin-auth-changed", refresh);
      window.removeEventListener("storage", refresh);
    };
  }, []);

  return { user: auth?.user || null, token: auth?.token || null, isAuthenticated: !!auth?.token };
}
