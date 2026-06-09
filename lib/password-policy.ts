export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_PATTERN = "(?=.*[a-z])(?=.*[A-Z])(?=.*\\d).{8,}";
export const PASSWORD_REQUIREMENTS =
  "Use at least 8 characters with uppercase, lowercase, and a number.";

export function isValidPassword(password: string) {
  return /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/.test(password);
}
