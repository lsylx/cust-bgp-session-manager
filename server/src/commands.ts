import { IPV4_PEER_GROUP, IPV6_PEER_GROUP, LOCAL_ASN, validateSessionInput } from './validation.js';

export type CommandAction = 'open' | 'delete';

export interface SessionTarget {
  asn: string;
  peerV4: string;
  peerV6?: string;
  md5Password: string;
}

export function buildCommand(action: CommandAction, target: SessionTarget): string {
  const { asn, peerV4, peerV6 } = validateSessionInput(target);
  const ipv6Commands = peerV6 ? [
    ` neighbor ${peerV6} remote-as ${asn}`,
    ` neighbor ${peerV6} peer-group ${IPV6_PEER_GROUP}`,
  ] : [];

  if (action === 'open') {
    return [
      'conf t',
      `router bgp ${LOCAL_ASN}`,
      ...ipv6Commands,
      ` neighbor ${peerV4} remote-as ${asn}`,
      ` neighbor ${peerV4} peer-group ${IPV4_PEER_GROUP}`,
      ` neighbor ${peerV4} password ${target.md5Password}`,
      '',
      ' address-family ipv4',
      ` neighbor ${peerV4} activate`,
      'exit',
      ...(peerV6 ? [' address-family ipv6', ` neighbor ${peerV6} activate`, 'exit'] : []),
      '',
      'exit',
    ].join('\n');
  }

  return [
    'conf t',
    `router bgp ${LOCAL_ASN}`,
    ...(peerV6 ? [` no neighbor ${peerV6}`] : []),
    ` no neighbor ${peerV4}`,
    'exit',
  ].join('\n');
}
