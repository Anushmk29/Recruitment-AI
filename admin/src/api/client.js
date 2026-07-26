import axios from "axios";
import {
  getAdminAuth,
  getAdminRefreshToken,
  updateAdminTokens,
  clearAdminAuth,
} from "../auth/adminAuth.js";

const baseURL = import.meta.env.VITE_API_URL || "http://localhost:9000/api";

const api = axios.create({ baseURL });

// Phase 16.5 — read-only "view as tenant". When platform staff activate it,
// every request carries the header; the SERVER rejects any non-GET carrying it,
// so the read-only guarantee never depends on this client.
export function getViewAsCompany() {
  try {
    return JSON.parse(sessionStorage.getItem("platformViewAs") || "null");
  } catch {
    return null;
  }
}
export function setViewAsCompany(company) {
  if (company) sessionStorage.setItem("platformViewAs", JSON.stringify(company));
  else sessionStorage.removeItem("platformViewAs");
}

api.interceptors.request.use((config) => {
  const auth = getAdminAuth();
  if (auth?.token) {
    config.headers.Authorization = `Bearer ${auth.token}`;
  }
  const viewAs = getViewAsCompany();
  if (viewAs?.id) {
    config.headers["X-View-As-Company"] = viewAs.id;
  }
  return config;
});

// Silent access-token refresh. Access tokens are short-lived; when one expires the API
// returns 401 and we transparently exchange the stored refresh token for a fresh pair,
// then replay the original request. Concurrent 401s share a single in-flight refresh so
// we don't hammer /auth/refresh (and don't trip its rotation reuse-detection).
let refreshPromise = null;

function refreshTokens() {
  if (!refreshPromise) {
    const refreshToken = getAdminRefreshToken();
    if (!refreshToken) return Promise.reject(new Error("no refresh token"));
    // Bare axios (not `api`) so this request skips the interceptors and can't recurse.
    refreshPromise = axios
      .post(`${baseURL}/auth/refresh`, { refreshToken })
      .then((res) => {
        updateAdminTokens({ token: res.data.token, refreshToken: res.data.refreshToken });
        return res.data.token;
      })
      .finally(() => {
        refreshPromise = null;
      });
  }
  return refreshPromise;
}

function forceLogout() {
  clearAdminAuth();
  if (window.location.pathname !== "/login") {
    window.location.assign("/login");
  }
}

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const original = error.config;
    const status = error.response?.status;
    const isRefreshCall = original?.url?.includes("/auth/refresh");

    // Only try to refresh once per request, and never for the refresh call itself.
    if (status === 401 && original && !original._retry && !isRefreshCall && getAdminRefreshToken()) {
      original._retry = true;
      try {
        const newToken = await refreshTokens();
        original.headers = original.headers || {};
        original.headers.Authorization = `Bearer ${newToken}`;
        return api(original);
      } catch {
        forceLogout();
        return Promise.reject(error);
      }
    }

    if (status === 401) {
      forceLogout();
    }
    return Promise.reject(error);
  }
);

export default api;
