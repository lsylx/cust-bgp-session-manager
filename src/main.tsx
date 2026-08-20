import React from 'react';
import { createRoot } from 'react-dom/client';
import { AlertTriangle, Check, ClipboardList, Eye, Lock, LogIn, Router, ShieldCheck, TerminalSquare, Trash2 } from 'lucide-react';
import { api, type Actor, type AdminPermission, type AdminUser, type AppStatus, type AuditLog, type BgpApplication, getActor, setActor, type LgFamily, type LgQueryType, type LgType, type Role, type RouterSession } from './api';
import './styles.css';

const statusText: Record<AppStatus, string> = {
  pending: '待审核',
  approved: '已审核',
  rejected: '已拒绝',
  opened: '已开通',
  deleted: '已删除',
};

const lgTypes: Record<LgFamily, { value: LgType; label: string }[]> = {
  ipv4: [
    { value: 'summary', label: 'Peer 状态' },
    { value: 'routes', label: '收到的路由' },
    { value: 'adv', label: '发给上游路由' },
  ],
  ipv6: [
    { value: 'summary', label: 'Peer 状态' },
    { value: 'routes', label: '收到的路由' },
    { value: 'adv', label: '发给上游路由' },
  ],
};

const lgQueryTypeMap: Record<LgFamily, Record<LgType, LgQueryType>> = {
  ipv4: {
    summary: 'v4-summary',
    routes: 'routes-v4',
    adv: 'adv-v4',
  },
  ipv6: {
    summary: 'v6-summary',
    routes: 'routes-v6',
    adv: 'adv-v6',
  },
};

function formatTime(value: string | null) {
  if (!value) return '-';
  return new Date(value).toLocaleString();
}

function Badge({ status }: { status: AppStatus }) {
  return <span className={`badge ${status}`}>{statusText[status]}</span>;
}

function App() {
  const [actor, setActorState] = React.useState<Actor>(getActor());
  const [apps, setApps] = React.useState<BgpApplication[]>([]);
  const [audits, setAudits] = React.useState<AuditLog[]>([]);
  const [routerSessions, setRouterSessions] = React.useState<RouterSession[]>([]);
  const [message, setMessage] = React.useState('');
  const [modal, setModal] = React.useState<{ app: BgpApplication; action: 'open' | 'delete'; command: string } | null>(null);
  const [confirmText, setConfirmText] = React.useState('');
  const [adminUsername, setAdminUsername] = React.useState('');
  const [adminPassword, setAdminPassword] = React.useState('');
  const [adminView, setAdminView] = React.useState<'applications' | 'session-sync' | 'session-management' | 'user-management' | 'looking-glass' | 'audits'>('applications');
  const [sessionGroupOpen, setSessionGroupOpen] = React.useState(true);
  const [adminUsers, setAdminUsers] = React.useState<AdminUser[]>([]);
  const isAdminPath = window.location.pathname.replace(/\/$/, '') === '/admin';

  async function load() {
    const list = await api.listApplications();
    setApps(list);
    if (getActor().role === 'admin') {
      setAudits(await api.audits());
      setRouterSessions(await api.routerSessions());
      setAdminUsers(await api.adminUsers());
    } else {
      setAudits([]);
      setRouterSessions([]);
      setAdminUsers([]);
    }
  }

  React.useEffect(() => {
    load().catch((err) => setMessage(err.message));
  }, [actor.role, actor.customerId]);

  React.useEffect(() => {
    if (isAdminPath || actor.role !== 'customer') return;
    api.ensureCustomerSession(actor.customerId)
      .then((next) => {
        setActor(next);
        setActorState(next);
      })
      .catch((err) => setMessage(err.message));
  }, [actor.customerId, actor.role, isAdminPath]);

  async function login(role: Role) {
    const next = await api.login(role, role === 'admin' ? 'admin' : 'customer-demo');
    setActor(next);
    setActorState(next);
    setMessage('已切换身份');
  }

  async function adminLogin(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const next = await api.login('admin', 'admin', { username: adminUsername, password: adminPassword });
    setActor(next);
    setActorState(next);
    setMessage('管理员已登录');
  }

  async function submitApplication(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const created = await api.createApplication({
      asn: String(data.get('asn') || ''),
      peerV4: String(data.get('peerV4') || ''),
      peerV6: String(data.get('peerV6') || ''),
      contactEmail: String(data.get('contactEmail') || ''),
      proof: String(data.get('proof') || ''),
    });
    setMessage(`申请 #${created.id} 已提交，等待人工审核。`);
    event.currentTarget.reset();
    await load();
  }

  async function review(app: BgpApplication, status: 'approved' | 'rejected', reviewNote?: string) {
    const note = status === 'approved' ? '人工核验 AS 所有权通过' : (reviewNote || '人工核验未通过');
    await api.reviewApplication(app.id, status, note);
    setMessage(`申请 #${app.id} 已${status === 'approved' ? '审核通过' : '拒绝'}。`);
    await load();
  }

  async function preview(app: BgpApplication, action: 'open' | 'delete') {
    const result = await api.previewCommand(app.id, action);
    setModal({ app, action, command: result.command });
    setConfirmText('');
  }

  async function executeModal() {
    if (!modal || confirmText !== 'CONFIRM') return;
    const result = await api.executeCommand(modal.app.id, modal.action);
    setMessage(result.executed
      ? `申请 #${modal.app.id} 已执行并写入审计记录。`
      : `申请 #${modal.app.id} 已写入审计记录，设备命令未真实下发。`);
    setModal(null);
    await load();
  }

  async function syncRouterSessions() {
    const result = await api.syncRouterSessions();
    setRouterSessions(result.sessions);
    setMessage(`已同步 ${result.synced} 条路由器 session。`);
  }

  async function reloadUsers() {
    setAdminUsers(await api.adminUsers());
  }

  if (isAdminPath && actor.role !== 'admin') {
    return (
      <div className="app-shell auth-shell">
        <section className="panel auth-panel">
          <div className="panel-title"><Lock size={18} /><h2>管理员登录</h2></div>
          {message && <div className="notice"><AlertTriangle size={16} /> {message}</div>}
          <form onSubmit={(event) => adminLogin(event).catch((err) => setMessage(err.message))}>
            <label>用户名<input value={adminUsername} onChange={(event) => setAdminUsername(event.target.value)} autoComplete="username" placeholder="admin" required /></label>
            <label>密码<input value={adminPassword} onChange={(event) => setAdminPassword(event.target.value)} autoComplete="current-password" type="password" placeholder="admin" required /></label>
            <button className="primary" type="submit"><LogIn size={16} /> 登录</button>
          </form>
        </section>
      </div>
    );
  }

  const sessionGroupItems: Array<{ id: typeof adminView; label: string }> = [
    { id: 'applications', label: '申请审核' },
    { id: 'session-sync', label: 'Session 同步' },
    { id: 'session-management', label: 'Session 管理' },
    { id: 'user-management', label: '用户管理' },
  ];

  const otherMenu: Array<{ id: typeof adminView; label: string }> = [
    { id: 'looking-glass', label: 'Looking Glass' },
    { id: 'audits', label: '审计记录' },
  ];

  return isAdminPath ? (
    <div className="admin-shell">
      <aside className="admin-sidebar">
        <div className="admin-brand">
          <h1>BGP 管理后台</h1>
          <span>admin / {actor.customerId}</span>
        </div>
        <div className="sidebar-group">
          <button className={`sidebar-group-toggle ${sessionGroupOpen ? 'open' : ''}`} onClick={() => setSessionGroupOpen((value) => !value)}>
            <span>Session 管理</span>
            <span aria-hidden="true">{sessionGroupOpen ? '−' : '+'}</span>
          </button>
          {sessionGroupOpen && (
            <nav>
              {sessionGroupItems.map((item) => (
                <button key={item.id} className={adminView === item.id ? 'active' : ''} onClick={() => setAdminView(item.id)}>{item.label}</button>
              ))}
            </nav>
          )}
        </div>
        <div className="sidebar-group sidebar-group-secondary">
          <div className="sidebar-group-label">其他功能</div>
          <nav>
            {otherMenu.map((item) => (
              <button key={item.id} className={adminView === item.id ? 'active' : ''} onClick={() => setAdminView(item.id)}>{item.label}</button>
            ))}
          </nav>
        </div>
      </aside>
      <main className="admin-main">
        {message && <div className="notice"><AlertTriangle size={16} /> {message}</div>}
        {adminView === 'applications' && (
          <section className="panel">
            <div className="panel-title"><ShieldCheck size={18} /><h2>申请审核</h2></div>
            <ApplicationList apps={apps} actor={actor} onReview={review} onPreview={preview} onMessage={setMessage} />
          </section>
        )}
        {adminView === 'session-sync' && (
          <section className="panel">
            <div className="panel-title"><Router size={18} /><h2>Session 同步</h2></div>
            <SessionSyncPanel sessions={routerSessions} onSync={() => syncRouterSessions().catch((err) => setMessage(err.message))} />
          </section>
        )}
        {adminView === 'session-management' && (
          <section className="panel">
            <div className="panel-title"><Router size={18} /><h2>Session 管理</h2></div>
            <SessionManagementPanel apps={apps} onPreview={preview} onMessage={setMessage} />
          </section>
        )}
        {adminView === 'user-management' && (
          <section className="panel">
            <div className="panel-title"><ShieldCheck size={18} /><h2>用户管理</h2></div>
            <UserManagementPanel users={adminUsers} onReload={() => reloadUsers().catch((err) => setMessage(err.message))} onMessage={setMessage} />
          </section>
        )}
        {adminView === 'looking-glass' && (
          <div className="admin-section-stack">
            <section className="panel">
              <div className="panel-title"><Eye size={18} /><h2>Looking Glass</h2></div>
              <LookingGlass apps={apps} routerSessions={routerSessions} actor={actor} onMessage={setMessage} />
            </section>
            <section className="panel">
              <div className="panel-title"><Eye size={18} /><h2>路由详细查询</h2></div>
              <RouteDetailLookup onMessage={setMessage} />
            </section>
          </div>
        )}
        {adminView === 'audits' && (
          <section className="panel">
            <AuditList audits={audits} />
          </section>
        )}
      </main>
      {modal && (
        <CommandModal modal={modal} confirmText={confirmText} setConfirmText={setConfirmText} onClose={() => setModal(null)} onExecute={() => executeModal().catch((err) => setMessage(err.message))} />
      )}
    </div>
  ) : (
    <div className="app-shell">
      <header className="topbar">
        <div>
          <h1>BGP Session 管理平台</h1>
          <p>客户提交申请，后台人工核验 AS 所有权，管理员确认后开通或删除 session。</p>
        </div>
        <div className="customer-identity">
          <span>用户 UUID</span>
          <strong>{actor.customerId}</strong>
        </div>
      </header>

      {message && <div className="notice"><AlertTriangle size={16} /> {message}</div>}

      <main className="layout">
        <section className="panel application-form">
          <div className="panel-title"><Router size={18} /><h2>用户申请</h2></div>
          <p className="muted">用户只能提交申请，不能自助开通或删除 BGP session。</p>
          <form onSubmit={(event) => submitApplication(event).catch((err) => setMessage(err.message))}>
            <label>AS 号码<input name="asn" placeholder="65535" required /></label>
            <label>IPv4 Peer<input name="peerV4" placeholder="10.255.255.255" required /></label>
            <label>IPv6 Peer（可选）<input name="peerV6" placeholder="fe80:ff:ff:ff:ff::1" /></label>
            <label>联系人邮箱<input name="contactEmail" type="email" placeholder="admin@example.com" required /></label>
            <label className="wide">AS 所有权证明<textarea name="proof" placeholder="填写 PeeringDB、RIR、邮件证明或人工核验材料" required /></label>
            <button className="primary" type="submit" disabled={actor.role !== 'customer'}><ClipboardList size={16} /> 提交申请</button>
          </form>
        </section>

        <section className="panel list-panel">
          <div className="panel-title"><ShieldCheck size={18} /><h2>我的申请</h2></div>
          <ApplicationList apps={apps} actor={actor} onReview={review} onPreview={preview} onMessage={setMessage} />
        </section>

        <section className="panel side-panel">
          <div className="panel-title"><Eye size={18} /><h2>Looking Glass</h2></div>
          <LookingGlass apps={apps} routerSessions={routerSessions} actor={actor} onMessage={setMessage} />
        </section>
      </main>

      {modal && (
        <CommandModal modal={modal} confirmText={confirmText} setConfirmText={setConfirmText} onClose={() => setModal(null)} onExecute={() => executeModal().catch((err) => setMessage(err.message))} />
      )}
    </div>
  );
}

function CommandModal({ modal, confirmText, setConfirmText, onClose, onExecute }: {
  modal: { app: BgpApplication; action: 'open' | 'delete'; command: string };
  confirmText: string;
  setConfirmText: (value: string) => void;
  onClose: () => void;
  onExecute: () => void;
}) {
  return (
    <div className="modal-backdrop">
      <div className="modal">
        <div className="modal-head">
          <div><TerminalSquare size={18} /> <strong>{modal.action === 'open' ? '确认开通命令' : '确认删除命令'}</strong></div>
          <button onClick={onClose}>关闭</button>
        </div>
        <div className="warning"><Lock size={16} /> 请逐行核对命令。只有输入 CONFIRM 后才会继续，默认仅写审计记录，不会写入路由器。</div>
        <pre>{modal.command}</pre>
        <label>确认文本<input value={confirmText} onChange={(event) => setConfirmText(event.target.value)} placeholder="CONFIRM" /></label>
        <div className="modal-actions">
          <button onClick={onClose}>取消</button>
          <button className="danger" onClick={onExecute} disabled={confirmText !== 'CONFIRM'}>
            {modal.action === 'open' ? <Check size={16} /> : <Trash2 size={16} />} 继续
          </button>
        </div>
      </div>
    </div>
  );
}

function ApplicationList({ apps, actor, onReview, onPreview, onMessage }: {
  apps: BgpApplication[];
  actor: Actor;
  onReview: (app: BgpApplication, status: 'approved' | 'rejected', reviewNote?: string) => Promise<void>;
  onPreview: (app: BgpApplication, action: 'open' | 'delete') => Promise<void>;
  onMessage: (message: string) => void;
}) {
  if (!apps.length) return <p className="muted">暂无申请。</p>;
  return (
    <div className="cards">
      {apps.map((app) => (
        <article className="card" key={app.id}>
          <div className="card-head">
            <strong>#{app.id} AS{app.asn}</strong>
            <Badge status={app.status} />
          </div>
          <dl>
            <div><dt>IPv4</dt><dd>{app.peerV4}</dd></div>
            <div><dt>IPv6</dt><dd>{app.peerV6}</dd></div>
            <div><dt>客户</dt><dd>{app.customerId}</dd></div>
            <div><dt>创建</dt><dd>{formatTime(app.createdAt)}</dd></div>
          </dl>
          <p className="proof">{app.proof}</p>
          {app.reviewNote && <p className="muted">审核备注：{app.reviewNote}</p>}
          {actor.role === 'admin' && (
            <div className="actions">
              <button disabled={app.status === 'opened' || app.status === 'deleted'} onClick={() => onReview(app, 'approved').catch((err) => onMessage(err.message))}>审核通过</button>
              <button disabled={app.status === 'opened' || app.status === 'deleted'} onClick={() => {
                const reason = window.prompt(`请输入申请 #${app.id} 的拒绝理由`);
                if (reason?.trim()) onReview(app, 'rejected', reason.trim()).catch((err) => onMessage(err.message));
              }}>拒绝</button>
              <button disabled={app.status !== 'approved'} onClick={() => onPreview(app, 'open').catch((err) => onMessage(err.message))}>预览开通</button>
              <button className="danger" disabled={app.status !== 'opened'} onClick={() => onPreview(app, 'delete').catch((err) => onMessage(err.message))}>预览删除</button>
            </div>
          )}
        </article>
      ))}
    </div>
  );
}

function SessionSyncPanel({ sessions, onSync }: { sessions: RouterSession[]; onSync: () => void }) {
  return (
    <div className="session-page">
      <div className="session-page-head">
        <p className="muted">手工同步路由器 session 到本地数据库，便于后续管理和 Looking Glass 查询。</p>
        <button onClick={onSync}>同步路由器 session</button>
      </div>
      {sessions.length === 0 ? <p className="muted">尚无同步数据。</p> : (
        <div className="cards">
          {sessions.map((session) => (
            <article className="card" key={session.id}>
              <div className="card-head">
                <strong>{session.family.toUpperCase()} AS{session.asn}</strong>
                <Badge status={session.state === 'established' ? 'opened' : 'pending'} />
              </div>
              <dl>
                <div><dt>Peer</dt><dd>{session.peerV4 || session.peerV6}</dd></div>
                <div><dt>Family</dt><dd>{session.family}</dd></div>
                <div><dt>Uptime</dt><dd>{session.uptime}</dd></div>
                <div><dt>来源</dt><dd>{session.source}</dd></div>
              </dl>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}

function SessionManagementPanel({ apps, onPreview, onMessage }: { apps: BgpApplication[]; onPreview: (app: BgpApplication, action: 'open' | 'delete') => Promise<void>; onMessage: (message: string) => void; }) {
  const managed = React.useMemo(() => apps.filter((app) => app.status === 'approved' || app.status === 'opened' || app.status === 'deleted'), [apps]);

  return (
    <div className="session-page">
      <p className="muted">这里集中管理已经通过审核、已经开通和已经删除的申请，方便执行开通/删除预览。</p>
      {managed.length === 0 ? <p className="muted">暂无可管理的 session 申请。</p> : (
        <div className="cards">
          {managed.map((app) => (
            <article className="card" key={app.id}>
              <div className="card-head">
                <strong>#{app.id} AS{app.asn}</strong>
                <Badge status={app.status} />
              </div>
              <dl>
                <div><dt>IPv4</dt><dd>{app.peerV4}</dd></div>
                <div><dt>IPv6</dt><dd>{app.peerV6}</dd></div>
                <div><dt>客户</dt><dd>{app.customerId}</dd></div>
                <div><dt>状态</dt><dd>{statusText[app.status]}</dd></div>
              </dl>
              <div className="actions">
                <button disabled={app.status !== 'approved'} onClick={() => onPreview(app, 'open').catch((err) => onMessage(err.message))}>预览开通</button>
                <button className="danger" disabled={app.status !== 'opened'} onClick={() => onPreview(app, 'delete').catch((err) => onMessage(err.message))}>预览删除</button>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}

const permissionLabels: Record<AdminPermission, string> = {
  manage_users: '用户管理',
  review_applications: '申请审核',
  session_sync: 'Session 同步',
  session_management: 'Session 管理',
  looking_glass: 'Looking Glass',
  audit_view: '审计记录',
};

function UserManagementPanel({ users, onReload, onMessage }: { users: AdminUser[]; onReload: () => void; onMessage: (message: string) => void; }) {
  const [editingUser, setEditingUser] = React.useState<AdminUser | null>(null);
  const [form, setForm] = React.useState({ username: '', displayName: '', password: '', isActive: true, permissions: [] as AdminPermission[] });

  React.useEffect(() => {
    if (editingUser) {
      setForm({
        username: editingUser.username,
        displayName: editingUser.displayName,
        password: '',
        isActive: editingUser.isActive,
        permissions: editingUser.permissions,
      });
    } else {
      setForm({ username: '', displayName: '', password: '', isActive: true, permissions: [] });
    }
  }, [editingUser]);

  async function saveUser(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      if (editingUser) {
        await api.updateAdminUser(editingUser.id, {
          displayName: form.displayName,
          password: form.password || undefined,
          permissions: form.permissions,
          isActive: form.isActive,
        });
        onMessage('管理员账号已更新。');
      } else {
        await api.createAdminUser({
          username: form.username,
          displayName: form.displayName,
          password: form.password,
          permissions: form.permissions,
          isActive: form.isActive,
        });
        onMessage('管理员账号已创建。');
      }
      setEditingUser(null);
      onReload();
    } catch (err) {
      onMessage(err instanceof Error ? err.message : '保存失败。');
    }
  }

  function togglePermission(permission: AdminPermission) {
    setForm((current) => ({
      ...current,
      permissions: current.permissions.includes(permission)
        ? current.permissions.filter((item) => item !== permission)
        : [...current.permissions, permission],
    }));
  }

  async function removeUser(user: AdminUser) {
    if (!window.confirm(`删除管理员 ${user.username}？`)) return;
    try {
      await api.deleteAdminUser(user.id);
      onMessage('管理员账号已删除。');
      onReload();
    } catch (err) {
      onMessage(err instanceof Error ? err.message : '删除失败。');
    }
  }

  return (
    <div className="session-page user-management-page">
      <div className="user-management-grid">
        <form className="panel user-form" onSubmit={saveUser}>
          <h3>{editingUser ? '编辑管理员' : '新增管理员'}</h3>
          <label>用户名<input value={form.username} onChange={(event) => setForm((current) => ({ ...current, username: event.target.value }))} disabled={Boolean(editingUser)} required /></label>
          <label>显示名称<input value={form.displayName} onChange={(event) => setForm((current) => ({ ...current, displayName: event.target.value }))} required /></label>
          <label>密码<input value={form.password} onChange={(event) => setForm((current) => ({ ...current, password: event.target.value }))} placeholder={editingUser ? '留空表示不修改' : ''} required={!editingUser} /></label>
          <label className="checkbox-row"><input type="checkbox" checked={form.isActive} onChange={(event) => setForm((current) => ({ ...current, isActive: event.target.checked }))} /> 启用账号</label>
          <div className="permission-grid">
            {Object.entries(permissionLabels).map(([permission, label]) => (
              <label key={permission} className="checkbox-row">
                <input type="checkbox" checked={form.permissions.includes(permission as AdminPermission)} onChange={() => togglePermission(permission as AdminPermission)} />
                {label}
              </label>
            ))}
          </div>
          <div className="actions">
            <button className="primary" type="submit">{editingUser ? '保存修改' : '创建用户'}</button>
            {editingUser && <button type="button" onClick={() => setEditingUser(null)}>取消编辑</button>}
          </div>
        </form>

        <div className="cards">
          {users.length === 0 ? <p className="muted">暂无管理员账号。</p> : users.map((user) => (
            <article className="card" key={user.id}>
              <div className="card-head">
                <strong>{user.displayName}</strong>
                <Badge status={user.isActive ? 'opened' : 'deleted'} />
              </div>
              <dl>
                <div><dt>用户名</dt><dd>{user.username}</dd></div>
                <div><dt>权限</dt><dd>{user.permissions.map((permission) => permissionLabels[permission]).join('、') || '-'}</dd></div>
              </dl>
              <div className="actions">
                <button onClick={() => setEditingUser(user)}>编辑</button>
                {user.username !== 'admin' && <button className="danger" onClick={() => removeUser(user)}>删除</button>}
              </div>
            </article>
          ))}
        </div>
      </div>
    </div>
  );
}

function LookingGlass({ apps, routerSessions, actor, onMessage }: { apps: BgpApplication[]; routerSessions: RouterSession[]; actor: Actor; onMessage: (message: string) => void }) {
  const opened = React.useMemo(() => apps.filter((app) => app.status === 'opened'), [apps]);
  const options = React.useMemo(() => actor.role === 'admin'
    ? [
      ...opened.map((app) => ({ kind: 'application' as const, id: app.id, label: `AS${app.asn} ${app.peerV4 || app.peerV6}`, family: app.peerV4 ? 'ipv4' as const : 'ipv6' as const })),
      ...routerSessions.map((session) => ({ kind: 'router' as const, id: session.id, label: `AS${session.asn} ${session.peerV4 || session.peerV6}`, family: session.family as LgFamily })),
    ]
    : opened.map((app) => ({ kind: 'application' as const, id: app.id, label: `AS${app.asn} ${app.peerV4 || app.peerV6}`, family: app.peerV4 ? 'ipv4' as const : 'ipv6' as const })), [actor.role, opened, routerSessions]);
  const [selectedId, setSelectedId] = React.useState('');
  const [family, setFamily] = React.useState<LgFamily>('ipv4');
  const [type, setType] = React.useState<LgType>('summary');
  const [result, setResult] = React.useState('等待查询。');

  const visibleOptions = React.useMemo(() => options.filter((option) => option.family === family), [family, options]);
  const visibleTypes = lgTypes[family];

  React.useEffect(() => {
    if (selectedId && !visibleOptions.some((option) => `${option.kind}:${option.id}` === selectedId)) {
      setSelectedId('');
    }
    if (!selectedId && visibleOptions[0]) setSelectedId(`${visibleOptions[0].kind}:${visibleOptions[0].id}`);
  }, [selectedId, visibleOptions]);

  async function run() {
    if (!selectedId) return;
    const [kind, rawId] = selectedId.split(':');
    const id = Number(rawId);
    if (!Number.isSafeInteger(id) || id <= 0) return;
    const queryType = lgQueryTypeMap[family][type];
    const res = kind === 'router'
      ? await api.routerLookingGlass(id, queryType)
      : await api.lookingGlass(id, queryType);
    setResult(res.result);
  }

  return (
    <div className="lg-box">
      <label>IP 版本
        <select value={family} onChange={(event) => { setFamily(event.target.value as LgFamily); setType('summary'); }}>
          <option value="ipv4">IPv4</option>
          <option value="ipv6">IPv6</option>
        </select>
      </label>
      <label>已开通 Session
        <select value={selectedId} onChange={(event) => setSelectedId(event.target.value)}>
          <option value="">选择 session</option>
          {visibleOptions.map((option) => <option key={`${option.kind}:${option.id}`} value={`${option.kind}:${option.id}`}>{option.label}</option>)}
        </select>
      </label>
      <label>查询类型
        <select value={type} onChange={(event) => setType(event.target.value as LgType)}>
          {visibleTypes.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
        </select>
      </label>
      <button className="primary" onClick={() => run().catch((err) => onMessage(err.message))}>查询</button>
      <pre>{result}</pre>
    </div>
  );
}

function RouteDetailLookup({ onMessage }: { onMessage: (message: string) => void }) {
  const [family, setFamily] = React.useState<LgFamily>('ipv4');
  const [route, setRoute] = React.useState('');
  const [result, setResult] = React.useState('等待查询。');

  async function run() {
    const value = route.trim();
    if (!value) return;
    const res = await api.routerRouteDetail(family, value);
    setResult(res.result);
  }

  return (
    <div className="lg-box">
      <label>IP 版本
        <select value={family} onChange={(event) => setFamily(event.target.value as LgFamily)}>
          <option value="ipv4">IPv4</option>
          <option value="ipv6">IPv6</option>
        </select>
      </label>
      <label>路由
        <input
          value={route}
          onChange={(event) => setRoute(event.target.value)}
          placeholder={family === 'ipv4' ? 'a.b.c.d/nn 或 a.b.c.d' : 'xxxx:xxxx::/nn 或 xxxx:xxxx::'}
        />
      </label>
      <button className="primary" onClick={() => run().catch((err) => onMessage(err.message))}>查询路由详细</button>
      <pre>{result}</pre>
    </div>
  );
}

function AuditList({ audits }: { audits: AuditLog[] }) {
  return (
    <div className="audit">
      <h3>审计记录</h3>
      {audits.length === 0 ? <p className="muted">暂无审计记录。</p> : audits.map((audit) => (
        <div className="audit-row" key={audit.id}>
          <strong>{audit.action} #{audit.applicationId}</strong>
          <span>{formatTime(audit.createdAt)}</span>
        </div>
      ))}
    </div>
  );
}

function RouterSessionPanel({ sessions, onSync }: { sessions: RouterSession[]; onSync: () => void }) {
  return (
    <div className="audit">
      <div className="panel-title">
        <h3>路由器 Session</h3>
        <button onClick={onSync}>同步路由器 session</button>
      </div>
      {sessions.length === 0 ? <p className="muted">尚无同步数据。</p> : sessions.map((session) => (
        <div className="audit-row" key={session.id}>
          <strong>{session.family.toUpperCase()} AS{session.asn}</strong>
          <span>{session.peerV4 || session.peerV6}</span>
          <span>{session.uptime} / {session.state}</span>
        </div>
      ))}
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
