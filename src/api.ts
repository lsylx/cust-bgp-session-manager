export type Role = 'customer' | 'admin';
export type AppStatus = 'pending' | 'approved' | 'rejected' | 'opened' | 'deleted';
export type LgFamily = 'ipv4' | 'ipv6';
export type LgType = 'summary' | 'routes' | 'adv';
export type LgQueryType = 'v4-summary' | 'v6-summary' | 'routes-v4' | 'routes-v6' | 'adv-v4' | 'adv-v6';
export type AdminPermission = 'manage_users' | 'review_applications' | 'session_sync' | 'session_management' | 'looking_glass' | 'audit_view';

export interface Actor {
  role: Role;
  customerId: string;
  username: string;
  displayName: string;
  permissions: AdminPermission[];
}

export interface BgpApplication {
  id: number;
  customerId: string;
  asn: string;
  peerV4: string;
  peerV6: string;
  contactEmail: string;
  proof: string;
  status: AppStatus;
  reviewNote: string | null;
  createdAt: string;
  reviewedAt: string | null;
  openedAt: string | null;
  deletedAt: string | null;
}

export interface AuditLog {
  id: number;
  actor: string;
  action: string;
  applicationId: number;
  command: string;
  createdAt: string;
}

export interface RouterSession {
  id: number;
  peerV4: string;
  peerV6: string;
  asn: string;
  family: string;
  uptime: string;
  state: string;
  source: string;
  lastSeenAt: string;
}

export interface AdminUser {
  id: number;
  username: string;
  displayName: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  permissions: AdminPermission[];
}

const actorStorageKey = 'cust-bgp-session-manager.actor';
const customerUuidCookie = 'bgp_customer_uuid';
const customerTokenCookie = 'bgp_user_token';

function readCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const match = document.cookie.split('; ').find((item) => item.startsWith(`${name}=`));
  return match ? decodeURIComponent(match.slice(name.length + 1)) : null;
}

function writeCookie(name: string, value: string) {
  if (typeof document === 'undefined') return;
  document.cookie = `${name}=${encodeURIComponent(value)}; Max-Age=${365 * 24 * 60 * 60}; Path=/; SameSite=Lax`;
}

function createCustomerUuid(): string {
  const existing = readCookie(customerUuidCookie);
  if (existing) return existing;
  const uuid = crypto.randomUUID();
  writeCookie(customerUuidCookie, uuid);
  writeCookie(customerTokenCookie, `customer:${uuid}`);
  return uuid;
}

function readStoredActor(): Actor {
  const customerUuid = createCustomerUuid();
  if (typeof window === 'undefined') return { role: 'customer', customerId: customerUuid, username: customerUuid, displayName: customerUuid, permissions: [] };
  if (window.location.pathname.replace(/\/$/, '') !== '/admin') {
    return { role: 'customer', customerId: customerUuid, username: customerUuid, displayName: customerUuid, permissions: [] };
  }
  const raw = window.localStorage.getItem(actorStorageKey);
  if (!raw) return { role: 'customer', customerId: customerUuid, username: customerUuid, displayName: customerUuid, permissions: [] };
  try {
    const parsed = JSON.parse(raw) as Actor;
    if ((parsed.role === 'customer' || parsed.role === 'admin') && typeof parsed.customerId === 'string') {
      if (parsed.role === 'customer' && parsed.customerId === 'customer-demo') {
        return { role: 'customer', customerId: customerUuid, username: customerUuid, displayName: customerUuid, permissions: [] };
      }
      return parsed;
    }
  } catch {
    // ignore malformed state
  }
  return { role: 'customer', customerId: customerUuid, username: customerUuid, displayName: customerUuid, permissions: [] };
}

let actor: Actor = readStoredActor();

export function setActor(next: Actor) {
  actor = next;
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(actorStorageKey, JSON.stringify(next));
  }
}

export function getActor() {
  if (typeof window !== 'undefined' && actor === undefined) {
    actor = readStoredActor();
  }
  return actor;
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(path, {
    ...options,
    credentials: 'include',
    headers: {
      'content-type': 'application/json',
      'x-demo-role': actor.role,
      'x-demo-customer-id': actor.customerId,
      ...(options.headers || {}),
    },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `Request failed: ${res.status}`);
  return body as T;
}

export const api = {
  ensureCustomerSession: (customerId: string) => request<Actor>('/api/customer-session', {
    method: 'POST',
    body: JSON.stringify({ customerId }),
  }),
  login: (role: Role, customerId: string, credentials?: { username: string; password: string }) => request<Actor>('/api/login', {
    method: 'POST',
    body: JSON.stringify({ role, customerId, ...(credentials || {}) }),
  }),
  listApplications: () => request<BgpApplication[]>('/api/applications'),
  createApplication: (payload: { asn: string; peerV4: string; peerV6?: string; contactEmail: string; proof: string }) => request<BgpApplication>('/api/applications', {
    method: 'POST',
    body: JSON.stringify(payload),
  }),
  reviewApplication: (id: number, status: 'approved' | 'rejected', reviewNote: string) => request<BgpApplication>(`/api/applications/${id}/review`, {
    method: 'PATCH',
    body: JSON.stringify({ status, reviewNote }),
  }),
  previewCommand: (id: number, action: 'open' | 'delete') => request<{ action: 'open' | 'delete'; command: string; requiresConfirmation: 'CONFIRM' }>(`/api/applications/${id}/command-preview`, {
    method: 'POST',
    body: JSON.stringify({ action }),
  }),
  executeCommand: (id: number, action: 'open' | 'delete') => request<{ application: BgpApplication; executed: boolean; output: string }>(`/api/applications/${id}/execute`, {
    method: 'POST',
    body: JSON.stringify({ action, confirmation: 'CONFIRM' }),
  }),
  lookingGlass: (id: number, type: LgQueryType, route?: string) => request<{ result: string }>(`/api/applications/${id}/looking-glass?type=${encodeURIComponent(type)}${route ? `&route=${encodeURIComponent(route)}` : ''}`),
  routerLookingGlass: (id: number, type: LgQueryType, route?: string) => request<{ result: string }>(`/api/router-sessions/${id}/looking-glass?type=${encodeURIComponent(type)}${route ? `&route=${encodeURIComponent(route)}` : ''}`),
  routerRouteDetail: (family: LgFamily, route: string) => request<{ result: string }>(`/api/router-route-detail?family=${encodeURIComponent(family)}&route=${encodeURIComponent(route)}`),
  audits: () => request<AuditLog[]>('/api/audits'),
  routerSessions: () => request<RouterSession[]>('/api/router-sessions'),
  syncRouterSessions: () => request<{ synced: number; sessions: RouterSession[] }>('/api/router-sessions/sync', { method: 'POST' }),
  adminUsers: () => request<AdminUser[]>('/api/admin-users'),
  createAdminUser: (payload: { username: string; displayName: string; password: string; permissions: AdminPermission[]; isActive: boolean }) => request<AdminUser>('/api/admin-users', {
    method: 'POST',
    body: JSON.stringify(payload),
  }),
  updateAdminUser: (id: number, payload: { displayName: string; password?: string; permissions: AdminPermission[]; isActive: boolean }) => request<AdminUser>(`/api/admin-users/${id}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  }),
  deleteAdminUser: (id: number) => request<void>(`/api/admin-users/${id}`, {
    method: 'DELETE',
  }),
};
