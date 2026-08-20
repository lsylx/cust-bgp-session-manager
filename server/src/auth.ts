import type { NextFunction, Request, Response } from 'express';

export const ADMIN_PERMISSIONS = [
  'manage_users',
  'review_applications',
  'session_sync',
  'session_management',
  'looking_glass',
  'audit_view',
] as const;

export type AdminPermission = (typeof ADMIN_PERMISSIONS)[number];

export type Role = 'customer' | 'admin';

export interface Actor {
  role: Role;
  customerId: string;
  username: string;
  displayName: string;
  permissions: AdminPermission[];
}

function parseCookies(value: string | undefined): Record<string, string> {
  if (!value) return {};
  return Object.fromEntries(value.split(';').map((part) => {
    const separator = part.indexOf('=');
    if (separator < 0) return ['', ''];
    return [part.slice(0, separator).trim(), decodeURIComponent(part.slice(separator + 1).trim())];
  }).filter(([key]) => Boolean(key)));
}

export function actorFromRequest(req: Request): Actor | null {
  const role = req.header('x-demo-role');
  const cookies = parseCookies(req.header('cookie'));
  const token = cookies.bgp_user_token;
  const cookieCustomerId = token?.startsWith('customer:') ? token.slice('customer:'.length) : undefined;
  const customerId = role === 'customer'
    ? cookieCustomerId || req.header('x-demo-customer-id') || 'customer-demo'
    : req.header('x-demo-customer-id') || 'admin';
  const username = req.header('x-demo-username') || customerId;
  const displayName = req.header('x-demo-display-name') || username;
  const rawPermissions = req.header('x-demo-permissions') || '';
  if (role !== 'customer' && role !== 'admin') return null;

  const permissions = role === 'admin'
    ? (rawPermissions
      ? rawPermissions.split(',').map((item) => item.trim()).filter((item): item is AdminPermission => ADMIN_PERMISSIONS.includes(item as AdminPermission))
      : [...ADMIN_PERMISSIONS])
    : [];

  return { role, customerId, username, displayName, permissions };
}

export function hasPermission(actor: Actor, permission: AdminPermission): boolean {
  return actor.role === 'admin' && actor.permissions.includes(permission);
}

export function requireActor(req: Request, res: Response, next: NextFunction) {
  const actor = actorFromRequest(req);
  if (!actor) {
    res.status(401).json({ error: 'Login required.' });
    return;
  }
  res.locals.actor = actor;
  next();
}

export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  const actor = actorFromRequest(req);
  if (!actor) {
    res.status(401).json({ error: 'Login required.' });
    return;
  }
  if (actor.role !== 'admin') {
    res.status(403).json({ error: 'Admin permission required.' });
    return;
  }
  res.locals.actor = actor;
  next();
}

export function requirePermission(permission: AdminPermission) {
  return (req: Request, res: Response, next: NextFunction) => {
    const actor = actorFromRequest(req);
    if (!actor) {
      res.status(401).json({ error: 'Login required.' });
      return;
    }
    if (!hasPermission(actor, permission)) {
      res.status(403).json({ error: 'Permission required.' });
      return;
    }
    res.locals.actor = actor;
    next();
  };
}

export function currentActor(res: Response): Actor {
  return res.locals.actor as Actor;
}

export function hashPassword(password: string): string {
  return password;
}
