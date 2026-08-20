export interface CustomerSession {
  asn: string;
  peerV4: string;
  peerV6: string;
}

const v4SummaryRows = [
  '10.1.50.2       4       206069       0       0        1    0    0 never    Idle (Admin)',
  '10.1.60.3       4        11421   20209   23221 27741048    0    0 2w0d            2',
  '87.76.198.6     4       204211   29282 1240794 27741048    0    0 4d10h           4',
  '87.76.198.20    4       153376      38  179351 27741048    0    0 00:23:14        1',
  '154.18.49.2     4          174 3900471   27640 27741048    0    0 2w0d      1021827',
];

const v6SummaryRows = [
  '2402:4480:2::8E:98\n                4          174 3186212   59364 15871727    0    0 2w0d       231932',
  '2A13:EDC0:FFFF:D001::1\n                4       216211 7474010   77967 15871727    0    0 1w5d       244526',
  '2A14:7586:6109::4\n                4       204211  142049 1102565 15871727    0    0 4d10h         210',
  '2A14:7586:6109:1::EB\n                4        40929   12758 1090898 15871727    0    0 4d10h           8',
];

function findRow(rows: string[], session: CustomerSession, family: 'v4' | 'v6'): string {
  const needle = family === 'v4' ? session.peerV4 : session.peerV6.toUpperCase();
  const asn = session.asn;
  const row = rows.find((line) => line.toUpperCase().includes(needle.toUpperCase()) || line.includes(` ${asn} `));
  return row || 'No matching customer peer found.';
}

export function getLookingGlassResult(type: string, session: CustomerSession): string {
  if (type === 'v4-summary') {
    return ['Neighbor        V           AS MsgRcvd MsgSent   TblVer  InQ OutQ Up/Down  State/PfxRcd', findRow(v4SummaryRows, session, 'v4')].join('\n');
  }
  if (type === 'v6-summary') {
    return ['Neighbor        V           AS MsgRcvd MsgSent   TblVer  InQ OutQ Up/Down  State/PfxRcd', findRow(v6SummaryRows, session, 'v6')].join('\n');
  }
  if (type === 'routes-v4') {
    return [
      'BGP table version is 15939229, local router ID is 154.18.49.3',
      'Status codes: s suppressed, d damped, h history, * valid, > best, i - internal, ',
      '              r RIB-failure, S Stale, m multipath, b backup-path, f RT-Filter, ',
      '              x best-external, a additional-path, c RIB-compressed, ',
      '              t secondary path, L long-lived-stale,',
      'Origin codes: i - IGP, e - EGP, ? - incomplete',
      'RPKI validation codes: V valid, I invalid, N Not found',
      '',
      '     Network          Next Hop            Metric LocPrf Weight Path',
      `V*>   203.0.113.0/24`,
      `                      ${session.peerV4}`,
      `                                                     260      0 ${session.asn} i`,
      '',
      'Total number of prefixes 1 ',
    ].join('\n');
  }
  if (type === 'routes-v6') {
    return [
      'BGP table version is 15939229, local router ID is 154.18.49.3',
      'Status codes: s suppressed, d damped, h history, * valid, > best, i - internal, ',
      '              r RIB-failure, S Stale, m multipath, b backup-path, f RT-Filter, ',
      '              x best-external, a additional-path, c RIB-compressed, ',
      '              t secondary path, L long-lived-stale,',
      'Origin codes: i - IGP, e - EGP, ? - incomplete',
      'RPKI validation codes: V valid, I invalid, N Not found',
      '',
      '     Network          Next Hop            Metric LocPrf Weight Path',
      `V*>   2001:db8:204:${session.asn.slice(-3)}::/48`,
      `                      ${session.peerV6}`,
      `                                                     260      0 ${session.asn} i`,
      '',
      'Total number of prefixes 1 ',
    ].join('\n');
  }
  if (type === 'route-detail-v4') {
    return [
      'BGP table version is 15939229, local router ID is 154.18.49.3',
      'Status codes: s suppressed, d damped, h history, * valid, > best, i - internal, ',
      '              r RIB-failure, S Stale, m multipath, b backup-path, f RT-Filter, ',
      '              x best-external, a additional-path, c RIB-compressed, ',
      '              t secondary path, L long-lived-stale,',
      'Origin codes: i - IGP, e - EGP, ? - incomplete',
      'RPKI validation codes: V valid, I invalid, N Not found',
      '',
      '     Network          Next Hop            Metric LocPrf Weight Path',
      `V*>   ${session.peerV4}`,
      '',
      'Total number of prefixes 1 ',
    ].join('\n');
  }
  if (type === 'route-detail-v6') {
    return [
      'BGP table version is 15939229, local router ID is 154.18.49.3',
      'Status codes: s suppressed, d damped, h history, * valid, > best, i - internal, ',
      '              r RIB-failure, S Stale, m multipath, b backup-path, f RT-Filter, ',
      '              x best-external, a additional-path, c RIB-compressed, ',
      '              t secondary path, L long-lived-stale,',
      'Origin codes: i - IGP, e - EGP, ? - incomplete',
      'RPKI validation codes: V valid, I invalid, N Not found',
      '',
      '     Network          Next Hop            Metric LocPrf Weight Path',
      `V*>   ${session.peerV6}`,
      '',
      'Total number of prefixes 1 ',
    ].join('\n');
  }
  if (type === 'adv-v4') {
    return `show bgp ipv4 unicast neighbor 154.18.49.2 adv\nshow bgp ipv4 unicast neighbor 80.249.134.244 adv\n\nFiltered announced routes for AS ${session.asn}: 203.0.113.0/24`;
  }
  return `show bgp ipv6 unicast neighbor 2402:4480:2::8E:98 adv\nshow bgp ipv6 unicast neighbor 2A13:EDC0:FFFF:D001::1 adv\n\nFiltered announced routes for AS ${session.asn}: 2001:db8:204:${session.asn.slice(-3)}::/48`;
}
