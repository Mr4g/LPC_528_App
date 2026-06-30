export type UserRole = 'operator' | 'line_leader' | 'admin';

export interface UserRecord {
  id: string;
  login: string;
  passwordHash: string;
  role: UserRole;
  isActive: number;
  createdAt: string;
  updatedAt: string;
  lastLoginAt: string | null;
  createdBy: string | null;
}

export interface PublicUser {
  id: string;
  login: string;
  role: UserRole;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  lastLoginAt: string | null;
  createdBy: string | null;
}

export interface AuthUser {
  id: string;
  login: string;
  role: UserRole;
}
