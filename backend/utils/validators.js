const STRONG_PASSWORD_REGEX = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{8,}$/;
const PHONE_REGEX = /^\+?[0-9 ()-]{7,15}$/;

function isStrongPassword(password) {
  return typeof password === "string" && STRONG_PASSWORD_REGEX.test(password);
}

function isValidPhone(phone) {
  return typeof phone === "string" && PHONE_REGEX.test(phone.trim());
}

module.exports = { isStrongPassword, isValidPhone };
