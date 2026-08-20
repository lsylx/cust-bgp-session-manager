import cors from 'cors';
import { randomBytes } from 'node:crypto';
import express from 'express';
import { buildCommand } from './commands.js';
import { ADMIN_PERMISSIONS, currentActor, requireActor, requireAdmin, requirePermission, type AdminPermission } from './auth.js';
import { db, type AdminUserRow, type ApplicationRow, type AuditRow, mapApplication, nowIso, queries } from './db.js';
import { getLookingGlassResult } from './lg.js';
import { discoverRouterSessions, executeRouterCommand, getRouterLookingGlassResult, getRouterRouteDetailResult, routerExecutionEnabled } from './routerSsh.js';
import {
  commandPreviewSchema,
  createApplicationSchema,
  executeSchema,
  loginSchema,
  lookingGlassSchema,
  routeLookupSchema,
  reviewSchema,
  validateSessionInput,
} from './validation.js';

const app = express();
const port = Number(process.env.PORT || 8787);

app.use(cors({ origin: true }));
app.use(express.json({ limit: '1mb' }));

function parseBody<T>(schema: { parse: (value: unknown) => T }, value: unknown): T {
  return schema.parse(value);
}

function getApplicationOr404(id: string, res: express.Response): ApplicationRow | null {
  if (!/^\d+$/.test(id)) {
    res.status(400).json({ error: 'Invalid application id.' });
    return null;
  }
  const row = queries.getApplication.get(Number(id)) as ApplicationRow | undefined;
  if (!row) {
    res.status(404).json({ error: 'Application not found.' });
    return null;
  }
  return row;
}

function routeId(req: express.Request): string {
  const id = req.params.id;
  return Array.isArray(id) ? '' : id || '';
}

function canCustomerRead(row: ApplicationRow, customerId: string): boolean {
  return row.customer_id === customerId;
}

function adminActorPayload(row: AdminUserRow, permissions: AdminPermission[]) {
  return {
    role: 'admin' as const,
    customerId: row.username,
    username: row.username,
    displayName: row.display_name,
    permissions,
  };
}

function loadAdminPermissions(userId: number): AdminPermission[] {
  return (queries.listAdminUserPermissionsByUser.all(userId) as Array<{ permission: string }>).map((row) => row.permission as AdminPermission).filter((permission): permission is AdminPermission => ADMIN_PERMISSIONS.includes(permission));
}

function createMd5Password(): string {
  return randomBytes(24).toString('base64url').slice(0, 32);
}

function applicationMd5Password(row: ApplicationRow): string {
  if (row.md5_password.length === 32) return row.md5_password;
  const md5Password = createMd5Password();
  queries.updateApplicationMd5Password.run(md5Password, row.id);
  row.md5_password = md5Password;
  return md5Password;
}

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, mode: 'local-test', realDeviceExecution: routerExecutionEnabled() });
});

app.post('/api/customer-session', (req, res) => {
  const body = req.body as { customerId?: string };
  const customerId = String(body.customerId || '').trim();
  if (!/^[0-9a-f-]{36}$/i.test(customerId)) {
    res.status(400).json({ error: 'Invalid customer UUID.' });
    return;
  }
  res.setHeader('Set-Cookie', `bgp_user_token=customer%3A${encodeURIComponent(customerId)}; Max-Age=31536000; Path=/; SameSite=Lax`);
  res.json({
    role: 'customer',
    customerId,
    username: customerId,
    displayName: customerId,
    permissions: [],
  });
});

app.post('/api/login', (req, res) => {
  const body = parseBody(loginSchema, req.body);
  if (body.role === 'admin') {
    if (!body.username || !body.password) {
      res.status(400).json({ error: 'Admin username and password are required.' });
      return;
    }
    const user = queries.getAdminUserByUsername.get(body.username) as AdminUserRow | undefined;
    if (!user || !user.is_active || user.password_hash !== body.password) {
      res.status(401).json({ error: 'Invalid admin username or password.' });
      return;
    }
    res.json(adminActorPayload(user, loadAdminPermissions(user.id)));
    return;
  }
  res.json({
    role: body.role,
    customerId: body.customerId || 'customer-demo',
    username: body.customerId || 'customer-demo',
    displayName: body.customerId || 'customer-demo',
    permissions: [],
  });
});

app.get('/api/me', requireActor, (_req, res) => {
  res.json(currentActor(res));
});

app.post('/api/applications', requireActor, (req, res) => {
  const actor = currentActor(res);
  if (actor.role !== 'customer') {
    res.status(403).json({ error: 'Only customer users can submit applications.' });
    return;
  }

  const body = parseBody(createApplicationSchema, req.body);
  const target = validateSessionInput({ asn: body.asn, peerV4: body.peerV4, peerV6: body.peerV6 });
  const createdAt = nowIso();

  const result = queries.createApplication.run({
    customerId: actor.customerId,
    asn: target.asn,
    peerV4: target.peerV4,
    peerV6: target.peerV6,
    md5Password: createMd5Password(),
    contactEmail: body.contactEmail,
    proof: body.proof,
    createdAt,
  });

  const row = queries.getApplication.get(result.lastInsertRowid) as ApplicationRow;
  res.status(201).json(mapApplication(row));
});

app.get('/api/applications', requireActor, (_req, res) => {
  const actor = currentActor(res);
  const rows = actor.role === 'admin'
    ? queries.listAllApplications.all() as ApplicationRow[]
    : queries.listCustomerApplications.all(actor.customerId) as ApplicationRow[];
  res.json(rows.map(mapApplication));
});

app.patch('/api/applications/:id/review', requireAdmin, (req, res) => {
  const row = getApplicationOr404(routeId(req), res);
  if (!row) return;
  if (row.status === 'opened' || row.status === 'deleted') {
    res.status(409).json({ error: 'Opened or deleted applications cannot be reviewed.' });
    return;
  }

  const body = parseBody(reviewSchema, req.body);
  queries.reviewApplication.run({
    id: row.id,
    status: body.status,
    reviewNote: body.reviewNote,
    reviewedAt: nowIso(),
  });
  const updated = queries.getApplication.get(row.id) as ApplicationRow;
  res.json(mapApplication(updated));
});

app.post('/api/applications/:id/command-preview', requireAdmin, (req, res) => {
  const row = getApplicationOr404(routeId(req), res);
  if (!row) return;
  const body = parseBody(commandPreviewSchema, req.body);
  if (body.action === 'open' && row.status !== 'approved') {
    res.status(409).json({ error: 'Session can only be opened after manual approval.' });
    return;
  }
  if (body.action === 'delete' && row.status !== 'opened') {
    res.status(409).json({ error: 'Only opened sessions can be deleted.' });
    return;
  }

  const command = buildCommand(body.action, { asn: row.asn, peerV4: row.peer_v4, peerV6: row.peer_v6, md5Password: applicationMd5Password(row) });
  res.json({ action: body.action, command, requiresConfirmation: 'CONFIRM' });
});

app.post('/api/applications/:id/execute', requireAdmin, async (req, res, next) => {
  const row = getApplicationOr404(routeId(req), res);
  if (!row) return;
  const actor = currentActor(res);
  const body = parseBody(executeSchema, req.body);

  if (body.action === 'open' && row.status !== 'approved') {
    res.status(409).json({ error: 'Session can only be opened after manual approval.' });
    return;
  }
  if (body.action === 'delete' && row.status !== 'opened') {
    res.status(409).json({ error: 'Only opened sessions can be deleted.' });
    return;
  }

  const command = buildCommand(body.action, { asn: row.asn, peerV4: row.peer_v4, peerV6: row.peer_v6, md5Password: applicationMd5Password(row) });
  const createdAt = nowIso();
  try {
    const routerResult = await executeRouterCommand(command);
    queries.createAudit.run({
      actor: actor.customerId,
      action: body.action,
      applicationId: row.id,
      command,
      createdAt,
    });

    if (body.action === 'open') queries.markOpened.run({ id: row.id, createdAt });
    else queries.markDeleted.run({ id: row.id, createdAt });

    const updated = queries.getApplication.get(row.id) as ApplicationRow;
    res.json({ application: mapApplication(updated), executed: routerResult.executed, output: routerResult.output });
  } catch (err) {
    next(err);
  }
});

app.get('/api/applications/:id/looking-glass', requireActor, (req, res) => {
  const row = getApplicationOr404(routeId(req), res);
  if (!row) return;
  const actor = currentActor(res);
  if (actor.role !== 'admin' && !canCustomerRead(row, actor.customerId)) {
    res.status(403).json({ error: 'Permission denied.' });
    return;
  }
  if (actor.role !== 'admin' && row.status !== 'opened') {
    res.status(403).json({ error: 'Looking Glass is available after the session is opened.' });
    return;
  }

  const query = parseBody(lookingGlassSchema, req.query);
  const result = getLookingGlassResult(query.type, { asn: row.asn, peerV4: row.peer_v4, peerV6: row.peer_v6 });
  res.json({ result });
});

app.get('/api/router-sessions/:id/looking-glass', requireAdmin, async (req, res, next) => {
  const id = routeId(req);
  if (!/^\d+$/.test(id)) {
    res.status(400).json({ error: 'Invalid router session id.' });
    return;
  }
  const row = queries.getRouterSession.get(Number(id)) as { peer_v4: string; peer_v6: string; asn: string; family: 'ipv4' | 'ipv6' } | undefined;
  if (!row) {
    res.status(404).json({ error: 'Router session not found.' });
    return;
  }
  const query = parseBody(lookingGlassSchema, req.query);
  try {
    const result = await getRouterLookingGlassResult(query.type, { asn: row.asn, peerV4: row.peer_v4, peerV6: row.peer_v6, family: row.family });
    res.json({ result });
  } catch (err) {
    next(err);
  }
});

app.get('/api/router-route-detail', requireAdmin, async (req, res, next) => {
  try {
    const query = parseBody(routeLookupSchema, req.query);
    const result = await getRouterRouteDetailResult(query.family, query.route);
    res.json({ result });
  } catch (err) {
    next(err);
  }
});

app.get('/api/audits', requireAdmin, (_req, res) => {
  const rows = queries.listAudits.all() as AuditRow[];
  res.json(rows.map((row) => ({
    id: row.id,
    actor: row.actor,
    action: row.action,
    applicationId: row.application_id,
    command: row.command,
    createdAt: row.created_at,
  })));
});

app.get('/api/admin-users', requirePermission('manage_users'), (_req, res) => {
  const rows = queries.listAdminUsers.all() as AdminUserRow[];
  res.json(rows.map((row) => ({
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    isActive: Boolean(row.is_active),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    permissions: loadAdminPermissions(row.id),
  })));
});

app.post('/api/admin-users', requirePermission('manage_users'), (req, res) => {
  const body = req.body as { username?: string; displayName?: string; password?: string; permissions?: string[]; isActive?: boolean };
  const username = String(body.username || '').trim();
  const displayName = String(body.displayName || '').trim();
  const password = String(body.password || '').trim();
  const permissions = Array.isArray(body.permissions) ? body.permissions.filter((item): item is AdminPermission => ADMIN_PERMISSIONS.includes(item as AdminPermission)) : [];
  if (!username || !displayName || !password) {
    res.status(400).json({ error: 'Username, display name and password are required.' });
    return;
  }
  if (queries.getAdminUserByUsername.get(username)) {
    res.status(409).json({ error: 'Admin username already exists.' });
    return;
  }
  const createdAt = nowIso();
  const result = queries.createAdminUser.run({
    username,
    displayName,
    passwordHash: password,
    isActive: body.isActive === false ? 0 : 1,
    createdAt,
    updatedAt: createdAt,
  });
  for (const permission of permissions) {
    queries.upsertAdminUserPermission.run({ userId: Number(result.lastInsertRowid), permission });
  }
  const row = queries.getAdminUser.get(result.lastInsertRowid) as AdminUserRow;
  res.status(201).json({
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    isActive: Boolean(row.is_active),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    permissions: loadAdminPermissions(row.id),
  });
});

app.put('/api/admin-users/:id', requirePermission('manage_users'), (req, res) => {
  const id = routeId(req);
  if (!/^\d+$/.test(id)) {
    res.status(400).json({ error: 'Invalid user id.' });
    return;
  }
  const row = queries.getAdminUser.get(Number(id)) as AdminUserRow | undefined;
  if (!row) {
    res.status(404).json({ error: 'Admin user not found.' });
    return;
  }
  const body = req.body as { displayName?: string; password?: string; permissions?: string[]; isActive?: boolean };
  const displayName = String(body.displayName || row.display_name).trim();
  const passwordHash = body.password ? String(body.password).trim() : row.password_hash;
  const permissions = Array.isArray(body.permissions) ? body.permissions.filter((item): item is AdminPermission => ADMIN_PERMISSIONS.includes(item as AdminPermission)) : loadAdminPermissions(row.id);
  const updatedAt = nowIso();
  queries.updateAdminUser.run({
    id: row.id,
    displayName,
    passwordHash,
    isActive: body.isActive === false ? 0 : 1,
    updatedAt,
  });
  queries.deleteAdminUserPermissionsByUser.run(row.id);
  for (const permission of permissions) {
    queries.upsertAdminUserPermission.run({ userId: row.id, permission });
  }
  const updated = queries.getAdminUser.get(row.id) as AdminUserRow;
  res.json({
    id: updated.id,
    username: updated.username,
    displayName: updated.display_name,
    isActive: Boolean(updated.is_active),
    createdAt: updated.created_at,
    updatedAt: updated.updated_at,
    permissions: loadAdminPermissions(updated.id),
  });
});

app.delete('/api/admin-users/:id', requirePermission('manage_users'), (req, res) => {
  const id = routeId(req);
  if (!/^\d+$/.test(id)) {
    res.status(400).json({ error: 'Invalid user id.' });
    return;
  }
  const row = queries.getAdminUser.get(Number(id)) as AdminUserRow | undefined;
  if (!row) {
    res.status(404).json({ error: 'Admin user not found.' });
    return;
  }
  if (row.username === 'admin') {
    res.status(409).json({ error: 'Default admin account cannot be removed.' });
    return;
  }
  db.prepare('DELETE FROM admin_user_permissions WHERE user_id = ?').run(row.id);
  db.prepare('DELETE FROM admin_users WHERE id = ?').run(row.id);
  res.status(204).end();
});

app.get('/api/router-sessions', requireAdmin, (_req, res) => {
  const rows = queries.listRouterSessions.all() as Array<{ id: number; peer_v4: string; peer_v6: string; asn: string; family: string; uptime: string; state: string; source: string; last_seen_at: string }>;
  res.json(rows.map((row) => ({
    id: row.id,
    peerV4: row.peer_v4,
    peerV6: row.peer_v6,
    asn: row.asn,
    family: row.family,
    uptime: row.uptime,
    state: row.state,
    source: row.source,
    lastSeenAt: row.last_seen_at,
  })));
});

app.post('/api/router-sessions/sync', requireAdmin, async (_req, res, next) => {
  try {
    const discovered = await discoverRouterSessions();
    const now = nowIso();
    const sync = db.transaction((sessions: typeof discovered, syncTime: string) => {
      queries.clearRouterSessions.run();
      for (const session of sessions) {
        if (!session.asn || (!session.peerV4 && !session.peerV6)) continue;
        queries.upsertRouterSession.run({
          peerV4: session.peerV4 || '',
          peerV6: session.peerV6 || '',
          asn: session.asn,
          family: session.family,
          uptime: session.uptime,
          state: session.state,
          source: 'router-sync',
          lastSeenAt: syncTime,
        });
      }
    });
    sync(discovered, now);
    const rows = queries.listRouterSessions.all() as Array<{ id: number; peer_v4: string; peer_v6: string; asn: string; family: string; uptime: string; state: string; source: string; last_seen_at: string }>;
    res.json({ synced: discovered.length, sessions: rows.map((row) => ({
      id: row.id,
      peerV4: row.peer_v4,
      peerV6: row.peer_v6,
      asn: row.asn,
      family: row.family,
      uptime: row.uptime,
      state: row.state,
      source: row.source,
      lastSeenAt: row.last_seen_at,
    })) });
  } catch (err) {
    next(err);
  }
});

app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const message = err instanceof Error ? err.message : 'Unexpected error.';
  res.status(400).json({ error: message });
});

app.listen(port, '127.0.0.1', () => {
  console.log(`BGP manager API listening on http://127.0.0.1:${port}`);
});
