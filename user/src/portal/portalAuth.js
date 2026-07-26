const STORAGE_KEY = "interviewPortalAuth";

// Merges onto whatever is already stored, so a later partial call (e.g. the dashboard refreshing
// just jobTitle/candidateName) can't clobber the jwt/rawToken an earlier call already saved.
export function saveAuth(patch) {
  const current = getAuth() || {};
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...current, ...patch }));
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
