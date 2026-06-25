import type { NextFunction, Request, Response } from 'express';
import type { AuthService } from './authService';
import type { AuthUser, UserRole } from './types';

export interface AuthenticatedRequest extends Request {
  user?: AuthUser;
}

const COOKIE_NAME = 'lpc_session';

export function getSessionCookieName(): string {
  return COOKIE_NAME;
}

export function parseCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  return header.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${name}=`))?.slice(name.length + 1);
}

export function setSessionCookie(res: Response, token: string): void {
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 12 * 60 * 60 * 1000,
    path: '/',
  });
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(COOKIE_NAME, { path: '/' });
}

export function attachAuth(authService: AuthService) {
  return (req: AuthenticatedRequest, _res: Response, next: NextFunction) => {
    const token = parseCookie(req.headers.cookie, COOKIE_NAME);
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
