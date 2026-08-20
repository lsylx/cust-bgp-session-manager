// ==UserScript==
// @name         NoBrand Cloud 服务器详情
// @namespace    https://cloud.nbdnet.com/
// @version      1.2.0
// @description  在后台服务编辑页显示 PVEController 后端的服务器详细信息、实时负载与流量用量
// @match        https://cloud.nbdnet.com/admin/services/services/*/edit*
// @match        https://cloud.nbdnet.com/admin/*
// @run-at       document-idle
// @grant        GM_xmlhttpRequest
// @connect      api.nbdnet.com
// ==/UserScript==

(function () {
  'use strict';

  const PANEL_ID = 'nb-server-info-panel';
  const RV_PANEL_ID = 'nb-remaining-value-panel'; // 剩余价值脚本的面板,用来排版对齐
  const API_BASE = 'https://api.nbdnet.com';
  const API_KEY = '2Xqsn5muHbh07v_OTcn6uvU81I6QRkOMhlm1kCj98fk';
  const REFRESH_MS = 60 * 1000; // 自动刷新间隔(metrics 会实打实查一次 PVE,别太频繁)

  const EGRESS_LABELS = {
    CHINA_MOBILE: '移动',
    CHINA_UNICOM: '联通',
    CHINA_TELECOM: '电信',
  };

  // ---------- API ----------

  function api(path) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: 'GET',
        url: API_BASE + path,
        headers: { 'X-API-Key': API_KEY },
        timeout: 20000,
        onload: (res) => {
          try {
            const body = JSON.parse(res.responseText);
            if (body.status === 200) resolve(body.data);
            else reject(new Error(body.message || 'API status ' + body.status));
          } catch (e) { reject(e); }
        },
        onerror: () => reject(new Error('network error')),
        ontimeout: () => reject(new Error('timeout')),
      });
    });
  }

  // ---------- 数据状态 ----------

  // { serviceId, serverId, server, traffic, metrics, ip, error, loading, fetchedAt }
  let state = null;

  function serviceIdFromUrl() {
    const m = location.pathname.match(/\/admin\/services\/services\/(\d+)\/edit/);
    return m ? m[1] : null;
  }

  // Properties 表里读 pvecontroller_server_id(表格懒加载,读不到返回 null)
  function serverIdFromProps() {
    for (const tr of document.querySelectorAll('tr.fi-ta-row')) {
      const keyCell = tr.querySelector('td.fi-ta-cell-key');
      const valCell = tr.querySelector('td.fi-ta-cell-value');
      if (!keyCell || !valCell) continue;
      if (keyCell.textContent.trim() !== 'pvecontroller_server_id') continue;
      const hid = valCell.querySelector('input[x-ref="serverState"]');
      const vis = valCell.querySelector('input[type="text"]');
      const v = ((hid && hid.value) || (vis && vis.value) || '').trim();
      return /^\d+$/.test(v) ? v : null;
    }
    return null;
  }

  async function loadServer(serviceId) {
    const st = { serviceId, loading: true, fetchedAt: state && state.fetchedAt };
    if (state && state.serviceId === serviceId) Object.assign(st, { server: state.server, traffic: state.traffic, metrics: state.metrics, ip: state.ip, serverId: state.serverId });
    state = st;
    try {
      // 优先 Properties 里的精确 server_id,否则按 nbnet-{服务ID} 命名规律反查
      let serverId = serverIdFromProps();
      let server = null;
      if (serverId) {
        server = await api('/servers/' + serverId);
      } else {
        const list = await api('/servers');
        server = (list || []).find((s) => s.name === 'nbnet-' + serviceId) || null;
        if (server) serverId = String(server.id);
      }
      if (state !== st) return; // 期间换页了,丢弃结果
      if (!server) {
        st.error = '未找到对应服务器(nbnet-' + serviceId + ')';
      } else {
        st.server = server;
        st.serverId = serverId;
        st.error = null;
        const [traffic, metrics, ip, tcLimits] = await Promise.all([
          api('/servers/' + serverId + '/traffic').catch(() => null),
          api('/servers/' + serverId + '/metrics').catch(() => null),
          server.ipId ? api('/ipv4s/' + server.ipId).catch(() => null) : null,
          // 未配置限速时接口返回 "No tc limit configured",视为空列表而非错误
          api('/servers/' + serverId + '/tc-limit')
            .catch((e) => (/no tc limit/i.test(e && e.message || '') ? [] : null)),
        ]);
        if (state !== st) return;
        st.traffic = traffic;
        st.metrics = metrics;
        st.ip = ip;
        st.tcLimits = tcLimits;
      }
    } catch (e) {
      if (state === st) st.error = e.message || String(e);
    }
    st.loading = false;
    st.fetchedAt = Date.now();
  }

  // ---------- 格式化 ----------

  function esc(s) {
    return String(s).replace(/[&<>"']/g, (c) => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
  }

  function row(k, v, style) {
    return `<div style="display:flex;justify-content:space-between;gap:16px">
      <span style="color:#a1a1aa;white-space:nowrap">${k}</span>
      <span class="nb-si-copy" title="点击复制" style="text-align:right;cursor:pointer;${style || ''}">${v}</span>
    </div>`;
  }

  function fmtBytes(n) {
    if (!isFinite(n)) return '?';
    const gib = n / 1073741824;
    if (gib >= 1) return gib.toFixed(2) + ' GiB';
    return (n / 1048576).toFixed(1) + ' MiB';
  }

  function fmtDate(iso) {
    if (!iso) return '—';
    return String(iso).replace('T', ' ').slice(0, 16);
  }

  function fmtUptime(sec) {
    if (!isFinite(sec)) return '—';
    const d = Math.floor(sec / 86400);
    const h = Math.floor((sec % 86400) / 3600);
    const m = Math.floor((sec % 3600) / 60);
    return d > 0 ? `${d} 天 ${h} 时` : h > 0 ? `${h} 时 ${m} 分` : `${m} 分`;
  }

  function pctStyle(pct) {
    return pct >= 90 ? 'color:#f87171;font-weight:700' : pct >= 70 ? 'color:#fbbf24' : '';
  }

  // ---------- 复制 ----------

  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).catch(() => fallbackCopy(text));
    }
    return Promise.resolve(fallbackCopy(text));
  }

  function fallbackCopy(text) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;left:-9999px;top:0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }

  // 面板 innerHTML 每秒重建,提示要挂在 body 上才不会被冲掉
  function showCopiedTip(x, y) {
    const tip = document.createElement('div');
    tip.textContent = '已复制';
    tip.style.cssText = [
      'position:fixed', `left:${x}px`, `top:${y - 28}px`, 'z-index:99999',
      'padding:2px 8px', 'border-radius:6px', 'background:#22c55e', 'color:#fff',
      'font:11px/1.6 ui-sans-serif,system-ui,sans-serif', 'pointer-events:none',
      'transition:opacity .3s', 'box-shadow:0 2px 8px rgba(0,0,0,.3)',
    ].join(';');
    document.body.appendChild(tip);
    setTimeout(() => { tip.style.opacity = '0'; }, 600);
    setTimeout(() => tip.remove(), 950);
  }

  // ---------- 面板 ----------

  function buildPanel() {
    const panel = document.createElement('div');
    panel.id = PANEL_ID;
    panel.style.cssText = [
      'position:fixed', 'right:16px', 'top:72px', 'z-index:99998',
      'min-width:260px', 'max-width:340px', 'padding:12px 14px', 'border-radius:10px',
      'background:rgba(24,24,27,.92)', 'color:#fafafa',
      'font:12px/1.6 ui-sans-serif,system-ui,sans-serif',
      'box-shadow:0 4px 16px rgba(0,0,0,.35)', 'backdrop-filter:blur(4px)',
    ].join(';');
    panel.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">
        <strong style="font-size:13px">服务器信息</strong>
        <button id="nb-si-refresh" type="button"
          style="background:#3f3f46;color:#fafafa;border:none;border-radius:6px;font-size:11px;padding:2px 8px;cursor:pointer">刷新</button>
      </div>
      <div id="nb-si-body"><span style="color:#a1a1aa">加载中…</span></div>
    `;
    panel.querySelector('#nb-si-refresh').addEventListener('click', () => {
      const sid = serviceIdFromUrl();
      if (sid) loadServer(sid);
    });
    // 事件委托:行内容每秒重建,监听器挂在面板上才能一直生效
    panel.addEventListener('click', (e) => {
      const v = e.target.closest('.nb-si-copy');
      if (!v || !panel.contains(v)) return;
      const text = v.textContent.trim();
      if (!text) return;
      copyText(text).then(() => showCopiedTip(e.clientX, e.clientY));
    });
    document.body.appendChild(panel);
    return panel;
  }

  function render() {
    const serviceId = serviceIdFromUrl();
    if (!serviceId) {
      const stale = document.getElementById(PANEL_ID);
      if (stale) stale.remove();
      state = null;
      return;
    }

    let panel = document.getElementById(PANEL_ID);
    if (!panel) panel = buildPanel();

    // 排版:如果剩余价值面板在,就贴在它下方,否则贴顶
    const rv = document.getElementById(RV_PANEL_ID);
    panel.style.top = rv ? Math.round(rv.getBoundingClientRect().bottom + 8) + 'px' : '72px';

    // 换页 / 到刷新时间 → 重新拉取
    if (!state || state.serviceId !== serviceId) {
      loadServer(serviceId);
    } else if (!state.loading && state.fetchedAt && Date.now() - state.fetchedAt > REFRESH_MS) {
      loadServer(serviceId);
    }

    const body = panel.querySelector('#nb-si-body');
    if (!state || (state.loading && !state.server)) {
      body.innerHTML = '<span style="color:#a1a1aa">加载中…</span>';
      return;
    }
    if (state.error) {
      body.innerHTML = `<span style="color:#f87171">${esc(state.error)}</span>`;
      return;
    }

    const s = state.server;
    const t = state.traffic;
    const m = state.metrics;
    const ip = state.ip;

    const running = (m && m.status ? m.status : s.status) === 'running';
    const statusText = esc(m && m.status ? m.status : s.status || '?') +
      (m && isFinite(m.uptimeSeconds) && running ? `,已运行 ${fmtUptime(m.uptimeSeconds)}` : '');

    let html =
      row('状态', statusText, running ? 'color:#4ade80;font-weight:700' : 'color:#f87171;font-weight:700') +
      row('名称', `${esc(s.name)}(#${esc(state.serverId)})`) +
      row('配置', `${s.cpu} 核 / ${(s.memory / 1024) % 1 ? (s.memory / 1024).toFixed(1) : s.memory / 1024} GB / ${s.disk} GB 盘`) +
      row('节点', `${m && m.nodeName ? esc(m.nodeName) + ' ' : ''}(node ${esc(s.nodeId)}, dc ${esc(s.dcId)})`) +
      row('VMID', esc(s.vmId));

    if (ip) {
      html += row('内网 IP', `${esc(ip.ipAddress)}/${esc(ip.netmask)}${ip.isNatIp ? '(NAT)' : ''}`);
      if (ip.isNatIp && ip.externalIpAddress) {
        html += row('外部地址', `${esc(ip.externalIpAddress)}:${esc(ip.remotePort ?? '?')}`);
        if (ip.portRangeStart != null) {
          html += row('端口段', `${esc(ip.portRangeStart)}-${esc(ip.portRangeEnd)}`);
        }
      }
      for (const eg of ip.additionalEgressIps || []) {
        html += row('出口(' + esc(EGRESS_LABELS[eg.type] || eg.type) + ')', esc(eg.ipAddress));
      }
    }

    if (Array.isArray(state.tcLimits)) {
      const active = state.tcLimits.filter((l) => l.enabled);
      if (!active.length) {
        html += row('带宽限速', '未配置', 'color:#a1a1aa');
      } else {
        for (const l of active) {
          const label = active.length > 1 || l.netIndex ? `带宽限速(net${l.netIndex})` : '带宽限速';
          html += row(label, `↑${esc(l.uploadMbps)} / ↓${esc(l.downloadMbps)} Mbps`);
        }
      }
    } else if (state.tcLimits === null && state.fetchedAt) {
      html += row('带宽限速', '获取失败', 'color:#a1a1aa');
    }

    if (m && m.cpu && running) {
      const cpuPct = m.cpu.usagePercent ?? 0;
      html += row('CPU 占用', `${cpuPct.toFixed(1)}%(${m.cpu.cores} 核)`, pctStyle(cpuPct));
      if (m.memory && m.memory.totalBytes) {
        const memPct = m.memory.usagePercent ?? 0;
        html += row('内存占用', `${fmtBytes(m.memory.usedBytes)} / ${fmtBytes(m.memory.totalBytes)}(${memPct.toFixed(1)}%)`, pctStyle(memPct));
      }
    }

    if (t) {
      const used = (t.uploadBytes || 0) + (t.downloadBytes || 0);
      if (s.bandwidthLimitGb) {
        const pct = used / (s.bandwidthLimitGb * 1073741824) * 100;
        html += row('流量', `${fmtBytes(used)} / ${s.bandwidthLimitGb} GB(${pct.toFixed(1)}%)`, pctStyle(pct));
      } else {
        html += row('流量', fmtBytes(used) + '(无上限)');
      }
      html += row('上/下行', `↑${fmtBytes(t.uploadBytes || 0)} ↓${fmtBytes(t.downloadBytes || 0)}`);
      html += row('流量重置', fmtDate(t.periodEndTime || s.trafficResetTime));
    } else {
      html += row('流量', '获取失败', 'color:#a1a1aa');
    }

    html += row('创建于', fmtDate(s.createdTime));
    if (state.loading) {
      html += `<div style="color:#a1a1aa;margin-top:4px">刷新中…</div>`;
    }

    body.innerHTML = html;
  }

  setInterval(render, 1000);
  document.addEventListener('livewire:navigated', () => {
    state = null; // 换页重新拉取
    setTimeout(render, 300);
  });
  render();
})();
