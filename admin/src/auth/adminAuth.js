const STORAGE_KEY = "adminAuth";

export function saveAdminAuth({ token, user }) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ token, user }));
  window.dispatchEvent(new Event("admin-auth-changed"));
}

export function getAdminAuth() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY));
  } catch {
    return null;
  }
}

export function clearAdminAuth() {
  localStorage.removeItem(STORAGE_KEY);
  window.dispatchEvent(new Event("admin-auth-changed"));
}
