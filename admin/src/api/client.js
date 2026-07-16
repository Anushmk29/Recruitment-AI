import axios from "axios";
import { getAdminAuth, clearAdminAuth } from "../auth/adminAuth.js";

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || "http://localhost:9000/api",
});

api.interceptors.request.use((config) => {
  const auth = getAdminAuth();
  if (auth?.token) {
    config.headers.Authorization = `Bearer ${auth.token}`;
  }
  return config;
});

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      clearAdminAuth();
      if (window.location.pathname !== "/login") {
        window.location.assign("/login");
      }
    }
    return Promise.reject(error);
  }
);

export default api;
