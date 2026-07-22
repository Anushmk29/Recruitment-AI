import axios from "axios";
import {
  getAccountAuth,
  getAccountRefreshToken,
  updateAccountTokens,
  clearAccountAuth,
} from "../auth/accountAuth.js";

const baseURL = import.meta.env.VITE_API_URL || "http://localhost:9000/api";

const api = axios.create({ baseURL });

// Silent refresh for CANDIDATE ACCOUNT calls only. This app also makes anonymous calls
// (apply form, public jobs) and interview-portal calls (a separate token/secret) through
// the same instance — those must NOT trigger an account refresh. We only refresh when the
// failing request actually carried the current account access token.
let refreshPromise = null;

function refreshTokens() {
  if (!refreshPromise) {
    const refreshToken = getAccountRefreshToken();
    if (!refreshToken) return Promise.reject(new Error("no refresh token"));
    // Bare axios so this skips interceptors and can't recurse.
    refreshPromise = axios
      .post(`${baseURL}/auth/refresh`, { refreshToken })
      .then((res) => {
        updateAccountTokens({ token: res.data.token, refreshToken: res.data.refreshToken });
        return res.data.token;
      })
      .finally(() => {
        refreshPromise = null;
      });
  }
  return refreshPromise;
}

function authHeaderOf(config) {
  const h = config?.headers;
  if (!h) return undefined;
  // axios 1.x request config headers are an AxiosHeaders instance (.get); fall back to
  // plain-object access for safety.
  if (typeof h.get === "function") return h.get("Authorization") || h.get("authorization");
  return h.Authorization || h.authorization;
}

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const original = error.config;
    const status = error.response?.status;
    const account = getAccountAuth();
    const carriedAccountToken =
      account?.token && authHeaderOf(original) === `Bearer ${account.token}`;
    const isRefreshCall = original?.url?.includes("/auth/refresh");

    if (
      status === 401 &&
      original &&
      !original._retry &&
      !isRefreshCall &&
      carriedAccountToken &&
      getAccountRefreshToken()
    ) {
      original._retry = true;
      try {
        const newToken = await refreshTokens();
        original.headers = original.headers || {};
        original.headers.Authorization = `Bearer ${newToken}`;
        return api(original);
      } catch {
        clearAccountAuth();
        return Promise.reject(error);
      }
    }
    return Promise.reject(error);
  }
);

export default api;
