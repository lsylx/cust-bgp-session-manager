import { Client } from 'ssh2';
import { readFileSync } from 'node:fs';
import { isIP } from 'node:net';
import { resolve } from 'node:path';
import { assertRouteLookup } from './validation.js';

export interface RouterExecutionResult {
  executed: boolean;
  output: string;
}

export interface RouterDiscoveredSession {
  asn: string;
  peerV4: string;
  peerV6: string;
  family: 'ipv4' | 'ipv6';
  uptime: string;
  state: string;
}

export interface RouterLookingGlassSession {
  asn: string;
  peerV4: string;
  peerV6: string;
  family: 'ipv4' | 'ipv6';
}

const host = process.env.ROUTER_HOST || '87.76.198.1';
const username = process.env.ROUTER_USERNAME || 'bgpmanager';
const privateKeyPath = process.env.ROUTER_PRIVATE_KEY || resolve(process.cwd(), 'id_ed22519');
const privateKeyPassphrase = process.env.ROUTER_PRIVATE_KEY_PASSPHRASE || '';
const enableRealExecution = process.env.ROUTER_EXECUTE === 'true';
const upstreamV4Peers = (process.env.ROUTER_UPSTREAM_V4 || '154.18.49.2,80.249.134.244').split(',').map((peer) => peer.trim()).filter((peer) => isIP(peer) === 4);
const upstreamV6Peers = (process.env.ROUTER_UPSTREAM_V6 || '2402:4480:2::8E:98,2A13:EDC0:FFFF:D001::1').split(',').map((peer) => peer.trim().toUpperCase()).filter((peer) => isIP(peer) === 6);

export function routerExecutionEnabled(): boolean {
  return enableRealExecution;
}

async function connectShell(command: string): Promise<string> {
  return new Promise((resolveResult, reject) => {
    const conn = new Client();
    let output = '';
    let errorOutput = '';
    const privateKey = readFileSync(privateKeyPath);

    conn.on('ready', () => {
      conn.shell((err, stream) => {
        if (err) {
          conn.end();
          reject(err);
          return;
        }

        stream.on('close', () => {
          conn.end();
          resolveResult((output + errorOutput).trim());
        });
        stream.on('data', (data: Buffer) => { output += data.toString('utf8'); });
        stream.stderr.on('data', (data: Buffer) => { errorOutput += data.toString('utf8'); });

        for (const line of command.split('\n')) {
          stream.write(line.trimEnd() + '\n');
        }
        stream.write('exit\n');
      });
    });

    conn.on('error', (err) => {
      const message = err instanceof Error ? err.message : String(err);
      if (/all configured authentication methods failed/i.test(message) || /auth/i.test(message)) {
        reject(new Error(`SSH authentication failed for ${username}@${host}. Check ROUTER_USERNAME, ROUTER_PRIVATE_KEY, and ROUTER_PRIVATE_KEY_PASSPHRASE.`));
        return;
      }
      reject(err);
    });
    conn.connect({
      host,
      port: 22,
      username,
      privateKey,
      passphrase: privateKeyPassphrase || undefined,
      readyTimeout: 15000,
    });
  });
}

export async function executeRouterCommand(command: string): Promise<RouterExecutionResult> {
  if (!enableRealExecution) {
    return {
      executed: false,
      output: 'Dry-run mode: command was not sent to the router. Set ROUTER_EXECUTE=true to enable real execution.',
    };
  }

  const output = await connectShell(command);
  return { executed: true, output };
}

export async function discoverRouterSessions(): Promise<RouterDiscoveredSession[]> {
  const command = [
    'terminal length 0',
    'show ip bgp summary',
    'show bgp ipv6 unicast summary',
  ].join('\n');
  const output = await connectShell(command);

  const discovered = new Map<string, RouterDiscoveredSession>();
  let pendingPeer = '';
  for (const rawLine of output.split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;

    const parts = line.split(/\s+/);
    const first = parts[0] || '';
    const ipVersion = isIP(first);
    if ((ipVersion === 4 || ipVersion === 6) && parts[1] !== '4') {
      pendingPeer = first;
      continue;
    }

    const peer = pendingPeer || first;
    const stats = pendingPeer ? parts : parts.slice(1);
    const version = stats[0] || '';
    const asn = stats[1] || '';
    const peerVersion = isIP(peer);
    pendingPeer = '';

    if ((peerVersion !== 4 && peerVersion !== 6) || version !== '4' || !/^\d+$/.test(asn) || stats.length < 9) {
      continue;
    }

    const normalizedIp = peerVersion === 6 ? peer.toUpperCase() : peer;
    const key = `${asn}:${normalizedIp}`;
    discovered.set(key, {
      asn,
      peerV4: peerVersion === 4 ? peer : '',
      peerV6: peerVersion === 6 ? normalizedIp : '',
      family: peerVersion === 4 ? 'ipv4' : 'ipv6',
      uptime: stats[7] || '',
      state: stats.slice(8).join(' '),
    });
  }

  return Array.from(discovered.values()).filter((session) => Boolean(session.asn && (session.peerV4 || session.peerV6)));
}

function assertRouterAsn(asn: string): string {
  const value = asn.trim();
  if (!/^\d+$/.test(value)) throw new Error('Selected router session has an invalid AS number.');
  return value;
}

function assertRouterPeer(session: RouterLookingGlassSession, family: 'ipv4' | 'ipv6'): string {
  const peer = family === 'ipv4' ? session.peerV4.trim() : session.peerV6.trim();
  const expectedVersion = family === 'ipv4' ? 4 : 6;
  if (session.family !== family || !peer || isIP(peer) !== expectedVersion) {
    throw new Error(`Selected router session does not have a valid ${family.toUpperCase()} peer.`);
  }
  return family === 'ipv6' ? peer.toUpperCase() : peer;
}

function filterSummaryOutput(output: string, peer: string): string {
  const lines = output.split('\n');
  const peerUpper = peer.toUpperCase();
  const header = lines.find((line) => /Neighbor\s+V\s+AS\s+MsgRcvd/i.test(line)) || 'Neighbor        V           AS MsgRcvd MsgSent   TblVer  InQ OutQ Up/Down  State/PfxRcd';
  const matched: string[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] || '';
    const first = line.trim().split(/\s+/)[0] || '';
    if (first.toUpperCase() === peerUpper) {
      matched.push(line.trimEnd());
      const next = lines[index + 1] || '';
      if (/^\s+4\s+\d+\s+/.test(next)) matched.push(next.trimEnd());
    }
  }

  return [header.trimEnd(), matched.join('\n') || `No matching router peer found for ${peer}.`].join('\n');
}

function filterAdvertisedRoutes(output: string, customerAsn: string): string {
  const asPathAsn = new RegExp(`(^|\\s)${customerAsn}(\\s|$)`);
  const lines = output.split('\n');
  const headerIndex = lines.findIndex((line) => /Network\s+Next Hop\s+Metric/i.test(line));
  const header = headerIndex >= 0 ? lines[headerIndex].trimEnd() : 'Network          Next Hop            Metric LocPrf Weight Path';
  const matched = lines
    .filter((line) => /^[A-Z]?[*>sdhriSmbf xactL\s]+\s*(\S+\/\d+|\d+\.\d+\.\d+\.\d+|[0-9A-Fa-f:]+\/\d+)/.test(line.trimStart()))
    .filter((line) => asPathAsn.test(line))
    .map((line) => line.trimEnd());

  return [header, matched.join('\n') || `No advertised routes found for AS${customerAsn} on this upstream peer.`].join('\n');
}

function extractBgpTable(output: string): string {
  const lines = output.split('\n');
  const start = lines.findIndex((line) => /^BGP table version is\s+/i.test(line.trim()));
  if (start < 0) return output.trim();

  const end = lines.findIndex((line, index) => index > start && /^Total number of prefixes\s+/i.test(line.trim()));
  const slice = lines.slice(start, end >= 0 ? end + 1 : lines.length);
  return slice.join('\n').trim();
}

async function getAdvertisedRoutesToUpstreams(family: 'ipv4' | 'ipv6', customerAsn: string): Promise<string> {
  const upstreams = family === 'ipv4' ? upstreamV4Peers : upstreamV6Peers;
  if (!upstreams.length) throw new Error(`No ${family.toUpperCase()} upstream peers configured.`);
  const commandFamily = family === 'ipv4' ? 'ipv4' : 'ipv6';
  const commands = ['terminal length 0', ...upstreams.map((peer) => `show bgp ${commandFamily} unicast neighbor ${peer} advertised-routes`)];
  const output = await connectShell(commands.join('\n'));
  const sections = output.split(/(?=JP-CISCO-[^#]+#show bgp )/g);

  return upstreams.map((peer) => {
    const section = sections.find((part) => part.includes(`neighbor ${peer} advertised-routes`)) || output;
    const upstreamAsn = peer === '154.18.49.2' ? 'AS174' : peer === '80.249.134.244' ? 'AS216211' : peer === '2402:4480:2::8E:98' ? 'AS174' : 'AS216211';
    return [`${upstreamAsn}已发送`, filterAdvertisedRoutes(section, customerAsn)].join('\n');
  }).join('\n\n');
}

export async function getRouterLookingGlassResult(type: string, session: RouterLookingGlassSession): Promise<string> {
  if (type === 'v4-summary') {
    const peer = assertRouterPeer(session, 'ipv4');
    const command = ['terminal length 0', 'show ip bgp summary'].join('\n');
    const output = await connectShell(command);
    return [`show ip bgp summary | include ${peer}`, '', filterSummaryOutput(output, peer)].join('\n');
  }
  if (type === 'v6-summary') {
    const peer = assertRouterPeer(session, 'ipv6');
    const command = ['terminal length 0', 'show bgp ipv6 unicast summary'].join('\n');
    const output = await connectShell(command);
    return [`show bgp ipv6 unicast summary | include ${peer}`, '', filterSummaryOutput(output, peer)].join('\n');
  }
  if (type === 'routes-v4') {
    const peer = assertRouterPeer(session, 'ipv4');
    const command = ['terminal length 0', `show bgp ipv4 unicast neighbor ${peer} routes`].join('\n');
    const output = await connectShell(command);
    return extractBgpTable(output);
  }
  if (type === 'routes-v6') {
    const peer = assertRouterPeer(session, 'ipv6');
    const command = ['terminal length 0', `show bgp ipv6 unicast neighbor ${peer} routes`].join('\n');
    const output = await connectShell(command);
    return extractBgpTable(output);
  }
  if (type === 'adv-v4') {
    const customerAsn = assertRouterAsn(session.asn);
    return await getAdvertisedRoutesToUpstreams('ipv4', customerAsn);
  }
  if (type === 'adv-v6') {
    const customerAsn = assertRouterAsn(session.asn);
    return await getAdvertisedRoutesToUpstreams('ipv6', customerAsn);
  }
  throw new Error('Unsupported Looking Glass query type.');
}

export async function getRouterRouteDetailResult(family: 'ipv4' | 'ipv6', routeInput: string): Promise<string> {
  const route = assertRouteLookup(routeInput, family);
  const commandFamily = family === 'ipv4' ? 'ipv4' : 'ipv6';
  const output = await connectShell(['terminal length 0', `show bgp ${commandFamily} unicast ${route}`].join('\n'));
  return extractBgpTable(output);
}
