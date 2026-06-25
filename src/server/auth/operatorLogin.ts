export const OPERATOR_LOGIN_REGEX = /^[A-Za-z]{3,5}$/;

export function validateOperatorLogin(login: string): boolean {
  return OPERATOR_LOGIN_REGEX.test(login);
}

export function normalizeOperatorLogin(login: string): string {
  return login.trim().toUpperCase();
}
