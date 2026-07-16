import { useEffect, useState } from "react";
import { getAccountAuth } from "./accountAuth.js";

export function useAccountAuth() {
  const [auth, setAuth] = useState(getAccountAuth());

  useEffect(() => {
    function refresh() {
      setAuth(getAccountAuth());
    }
    window.addEventListener("account-auth-changed", refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener("account-auth-changed", refresh);
      window.removeEventListener("storage", refresh);
    };
  }, []);

  return { user: auth?.user || null, token: auth?.token || null, isAuthenticated: !!auth?.token };
}
