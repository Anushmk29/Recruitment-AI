const STORAGE_KEY = "interviewPortalAuth";

export function saveAuth({ jwt, rawToken }) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ jwt, rawToken }));
}

export function getAuth() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY));
  } catch {
    return null;
  }
}

export function clearAuth() {
  localStorage.removeItem(STORAGE_KEY);
}

export function authHeader() {
  const auth = getAuth();
  return auth?.jwt ? { Authorization: `Bearer ${auth.jwt}` } : {};
}

export function getInterviewLink() {
  const auth = getAuth();
  if (!auth?.rawToken) return "";
  return `${window.location.origin}/interview/${auth.rawToken}`;
}
