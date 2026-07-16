const STORAGE_KEY = "candidatePostAuthRedirect";

export function setReturnTo(path) {
  if (!path || path === "/login" || path === "/register") return;
  localStorage.setItem(STORAGE_KEY, path);
}

export function getReturnTo() {
  return localStorage.getItem(STORAGE_KEY);
}

export function clearReturnTo() {
  localStorage.removeItem(STORAGE_KEY);
}
