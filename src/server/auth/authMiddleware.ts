import type { NextFunction, Request, Response } from 'express';
import type { AuthService } from './authService';
import type { AuthUser, UserRole } from './types';

export interface AuthenticatedRequest extends Request {
  user?: AuthUser;
}

export interface AuthCookieOptions {
  name: string;
  maxAgeMs: number;
  secure: boolean;
  sameSite: 'lax' | 'strict' | 'none';
}

let cookieOptions: AuthCookieOptions = {
  name: 'lpc_auth',
  maxAgeMs: 12 * 60 * 60 * 1000,
  secure: false,
  sameSite: 'lax',
};

export function configureAuthCookies(options: AuthCookieOptions): void {
  cookieOptions = options;
}

export function getAuthCookieOptions(): AuthCookieOptions {
  return { ...cookieOptions };
}

export function getSessionCookieName(): string {
  return cookieOptions.name;
}

export function parseCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  return header.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${name}=`))?.slice(name.length + 1);
}

export function setSessionCookie(res: Response, token: string): void {
  res.cookie(cookieOptions.name, token, {
    httpOnly: true,
    sameSite: cookieOptions.sameSite,
    secure: cookieOptions.secure,
    maxAge: cookieOptions.maxAgeMs,
    path: '/',
  });
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(cookieOptions.name, { path: '/', sameSite: cookieOptions.sameSite, secure: cookieOptions.secure });
}

export function attachAuth(authService: AuthService) {
  return (req: AuthenticatedRequest, _res: Response, next: NextFunction) => {
    const token = parseCookie(req.headers.cookie, cookieOptions.name);
    const user = authService.verifySession(token);
    if (user) req.user = user;
    next();
  };
}

export function requireAuth(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  if (!req.user) return res.status(401).json({ ok: false, error: 'AUTH_REQUIRED', message: 'Wymagane logowanie.' });
  return next();
}

export function requireRole(roles: UserRole[]) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    if (!req.user) return res.status(401).json({ ok: false, error: 'AUTH_REQUIRED', message: 'Wymagane logowanie.' });
    if (!roles.includes(req.user.role)) return res.status(403).json({ ok: false, error: 'FORBIDDEN', message: 'Brak uprawnień.' });
    return next();
  };
}
