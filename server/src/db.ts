import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const dataDir = join(root, 'data');
mkdirSync(dataDir, { recursive: true });

export const db = new Database(join(dataDir, 'bgp-manager.db'));
db.pragma('journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS applications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id TEXT NOT NULL,
  asn TEXT NOT NULL,
  peer_v4 TEXT NOT NULL,
  peer_v6 TEXT NOT NULL,
  md5_password TEXT NOT NULL DEFAULT '',
  contact_email TEXT NOT NULL,
  proof TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  review_note TEXT,
  created_at TEXT NOT NULL,
  reviewed_at TEXT,
  opened_at TEXT,
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  application_id INTEGER NOT NULL,
  command TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS router_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  peer_v4 TEXT NOT NULL,
  peer_v6 TEXT NOT NULL,
  asn TEXT NOT NULL,
  family TEXT NOT NULL DEFAULT 'ipv4',
  uptime TEXT NOT NULL DEFAULT '',
  state TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT 'router',
  last_seen_at TEXT NOT NULL,
  UNIQUE(peer_v4, peer_v6, asn, family)
);

CREATE TABLE IF NOT EXISTS admin_users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS admin_user_permissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  permission TEXT NOT NULL,
  UNIQUE(user_id, permission)
);
`);

const routerSessionColumns = db.prepare('PRAGMA table_info(router_sessions)').all() as Array<{ name: string }>;
const routerSessionColumnNames = new Set(routerSessionColumns.map((column) => column.name));
if (!routerSessionColumnNames.has('family')) db.exec("ALTER TABLE router_sessions ADD COLUMN family TEXT NOT NULL DEFAULT 'ipv4'");
if (!routerSessionColumnNames.has('uptime')) db.exec("ALTER TABLE router_sessions ADD COLUMN uptime TEXT NOT NULL DEFAULT ''");
if (!routerSessionColumnNames.has('state')) db.exec("ALTER TABLE router_sessions ADD COLUMN state TEXT NOT NULL DEFAULT ''");
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS router_sessions_peer_family_idx ON router_sessions(peer_v4, peer_v6, asn, family)');

const applicationColumns = db.prepare('PRAGMA table_info(applications)').all() as Array<{ name: string }>;
const applicationColumnNames = new Set(applicationColumns.map((column) => column.name));
if (!applicationColumnNames.has('md5_password')) db.exec("ALTER TABLE applications ADD COLUMN md5_password TEXT NOT NULL DEFAULT ''");

const adminUsersColumns = db.prepare('PRAGMA table_info(admin_users)').all() as Array<{ name: string }>;
const adminUsersColumnNames = new Set(adminUsersColumns.map((column) => column.name));
if (!adminUsersColumnNames.has('display_name')) db.exec("ALTER TABLE admin_users ADD COLUMN display_name TEXT NOT NULL DEFAULT ''");
if (!adminUsersColumnNames.has('is_active')) db.exec('ALTER TABLE admin_users ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1');
if (!adminUsersColumnNames.has('created_at')) db.exec("ALTER TABLE admin_users ADD COLUMN created_at TEXT NOT NULL DEFAULT ''");
if (!adminUsersColumnNames.has('updated_at')) db.exec("ALTER TABLE admin_users ADD COLUMN updated_at TEXT NOT NULL DEFAULT ''");

db.exec(`
INSERT OR IGNORE INTO admin_users (username, display_name, password_hash, is_active, created_at, updated_at)
VALUES ('admin', 'Admin', 'admin', 1, datetime('now'), datetime('now'))
`);

export interface ApplicationRow {
  id: number;
  customer_id: string;
  asn: string;
  peer_v4: string;
  peer_v6: string;
  md5_password: string;
  contact_email: string;
  proof: string;
  status: 'pending' | 'approved' | 'rejected' | 'opened' | 'deleted';
  review_note: string | null;
  created_at: string;
  reviewed_at: string | null;
  opened_at: string | null;
  deleted_at: string | null;
}

export interface AuditRow {
  id: number;
  actor: string;
  action: string;
  application_id: number;
  command: string;
  created_at: string;
}

export interface RouterSessionRow {
  id: number;
  peer_v4: string;
  peer_v6: string;
  asn: string;
  family: string;
  uptime: string;
  state: string;
  source: string;
  last_seen_at: string;
}

export interface AdminUserRow {
  id: number;
  username: string;
  display_name: string;
  password_hash: string;
  is_active: number;
  created_at: string;
  updated_at: string;
}

export interface AdminUserPermissionRow {
  id: number;
  user_id: number;
  permission: string;
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function mapApplication(row: ApplicationRow) {
  return {
    id: row.id,
    customerId: row.customer_id,
    asn: row.asn,
    peerV4: row.peer_v4,
    peerV6: row.peer_v6,
    contactEmail: row.contact_email,
    proof: row.proof,
    status: row.status,
    reviewNote: row.review_note,
    createdAt: row.created_at,
    reviewedAt: row.reviewed_at,
    openedAt: row.opened_at,
    deletedAt: row.deleted_at,
  };
}

export const queries = {
  createApplication: db.prepare(`
    INSERT INTO applications (customer_id, asn, peer_v4, peer_v6, md5_password, contact_email, proof, created_at)
    VALUES (@customerId, @asn, @peerV4, @peerV6, @md5Password, @contactEmail, @proof, @createdAt)
  `),
  listAllApplications: db.prepare('SELECT * FROM applications ORDER BY id DESC'),
  listCustomerApplications: db.prepare('SELECT * FROM applications WHERE customer_id = ? ORDER BY id DESC'),
  getApplication: db.prepare('SELECT * FROM applications WHERE id = ?'),
  reviewApplication: db.prepare(`
    UPDATE applications
    SET status = @status, review_note = @reviewNote, reviewed_at = @reviewedAt
    WHERE id = @id
  `),
  markOpened: db.prepare(`
    UPDATE applications SET status = 'opened', opened_at = @createdAt WHERE id = @id
  `),
  markDeleted: db.prepare(`
    UPDATE applications SET status = 'deleted', deleted_at = @createdAt WHERE id = @id
  `),
  updateApplicationMd5Password: db.prepare('UPDATE applications SET md5_password = ? WHERE id = ?'),
  createAudit: db.prepare(`
    INSERT INTO audit_logs (actor, action, application_id, command, created_at)
    VALUES (@actor, @action, @applicationId, @command, @createdAt)
  `),
  listAudits: db.prepare('SELECT * FROM audit_logs ORDER BY id DESC LIMIT 50'),
  listRouterSessions: db.prepare('SELECT * FROM router_sessions ORDER BY id DESC'),
  getRouterSession: db.prepare('SELECT * FROM router_sessions WHERE id = ?'),
  clearRouterSessions: db.prepare('DELETE FROM router_sessions'),
  upsertRouterSession: db.prepare(`
    INSERT INTO router_sessions (peer_v4, peer_v6, asn, family, uptime, state, source, last_seen_at)
    VALUES (@peerV4, @peerV6, @asn, @family, @uptime, @state, @source, @lastSeenAt)
    ON CONFLICT(peer_v4, peer_v6, asn, family) DO UPDATE SET
      uptime = excluded.uptime,
      state = excluded.state,
      source = excluded.source,
      last_seen_at = excluded.last_seen_at
  `),
  listAdminUsers: db.prepare('SELECT * FROM admin_users ORDER BY id DESC'),
  getAdminUser: db.prepare('SELECT * FROM admin_users WHERE id = ?'),
  getAdminUserByUsername: db.prepare('SELECT * FROM admin_users WHERE username = ?'),
  createAdminUser: db.prepare(`
    INSERT INTO admin_users (username, display_name, password_hash, is_active, created_at, updated_at)
    VALUES (@username, @displayName, @passwordHash, @isActive, @createdAt, @updatedAt)
  `),
  updateAdminUser: db.prepare(`
    UPDATE admin_users
    SET display_name = @displayName,
        password_hash = @passwordHash,
        is_active = @isActive,
        updated_at = @updatedAt
    WHERE id = @id
  `),
  deleteAdminUserPermissionsByUser: db.prepare('DELETE FROM admin_user_permissions WHERE user_id = ?'),
  listAdminUserPermissions: db.prepare('SELECT * FROM admin_user_permissions ORDER BY id ASC'),
  listAdminUserPermissionsByUser: db.prepare('SELECT * FROM admin_user_permissions WHERE user_id = ? ORDER BY permission ASC'),
  upsertAdminUserPermission: db.prepare(`
    INSERT INTO admin_user_permissions (user_id, permission)
    VALUES (@userId, @permission)
    ON CONFLICT(user_id, permission) DO NOTHING
  `),
  deleteAdminUserPermission: db.prepare('DELETE FROM admin_user_permissions WHERE user_id = ? AND permission = ?'),
};
