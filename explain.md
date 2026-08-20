我目前想要实现一个客户自助BGP session管理的平台，分为用户页面和管理后台。希望实现用户自助启用BGP session和我们建立PEER关系。用户申请后需要核验用户是否拥有该AS号码的所有权，目前先采用人工后台审核的方式实现，开通session也是人工操作。人工审核完成开通后给与用户数据返回和查看的功能。

根目录下nobrand-server-info.user.js是我们目前自己使用的一个油猴脚本方便我们查看paymenter后台的客户相关机器的IP地址等信息，你可以参考。需要核验用户是否有权限，且要客户是登录状态。


bgp session管理板块

这个是BGP session开通的方法，严格注意值判断，千万不要传入空值或者异常值，且执行命令前需要跳出弹窗把你要执行的命令贴出来且询问管理员是否继续。

conf t
router bgp 206069
 neighbor 2A14:7586:6109:1::EB remote-as 204211
 neighbor 2A14:7586:6109:1::EB peer-group EBGP-CUST-FULL-v6
 neighbor 87.76.198.6 remote-as 204211
 neighbor 87.76.198.6 peer-group EBGP-CUST-FULL

 address-family ipv4
 neighbor 87.76.198.6 activate
exit
 address-family ipv6 
 neighbor 2A14:7586:6109:1::EB activate
exit

exit
千万注意，BGP session开通流程不允许用户自助操作，只允许后台管理员操作，且执行命令前需要跳出弹窗把你要执行的命令贴出来且询问管理员是否继续。




这个是BGP Session 删除的方法，严格注意值判断，千万不要传入空值或者异常值，且执行命令前需要跳出弹窗把你要执行的命令贴出来且询问管理员是否继续。

conf t
router bgp 206069
 no neighbor 2A14:7586:6109:1::EB 
 no neighbor 87.76.198.6
exit

千万注意，BGP session删除不允许用户自助操作，只允许后台管理员操作，且执行命令前需要跳出弹窗把你要执行的命令贴出来且询问管理员是否继续。


#looking glass板块

这个是BGP Session v4 全体Peer状态信息

show  bgp ipv4 unicast summary

返回信息如下，注意匹配相关用户的那行，不要给用户其他用户的信息。

BGP router identifier 154.18.49.3, local AS number 206069
BGP table version is 27741341, main routing table version 27741341
Path RPKI states: 1424833 valid, 660655 not found, 840 invalid
1064515 network entries using 263999720 bytes of memory
2086328 path entries using 283740608 bytes of memory
646014/168373 BGP path/bestpath attribute entries using 191220144 bytes of memory
311146 BGP AS-PATH entries using 17254014 bytes of memory
30046 BGP community entries using 4086426 bytes of memory
13368 BGP large community entries using 2024974 bytes of memory
1136 BGP extended community entries using 91864 bytes of memory
1344 BGP route-map cache entries using 96768 bytes of memory
0 BGP filter-list cache entries using 0 bytes of memory
BGP using 762514518 total bytes of memory
BGP activity 1948736/639403 prefixes, 6056448/3493148 paths, scan interval 60 secs
1067463 networks peaked at 06:33:39 Aug 17 2026 UTC (10:05:04.715 ago)

Neighbor        V           AS MsgRcvd MsgSent   TblVer  InQ OutQ Up/Down  State/PfxRcd
10.1.50.2       4       206069       0       0        1    0    0 never    Idle (Admin)
10.1.60.3       4        11421   20209   23221 27741048    0    0 2w0d            2
44.61.19.101    4       151245    8910 1228972 27741048    0    0 4d10h           1
80.249.134.244  4       216211 9365608   39599 27741048    0    0 1w5d      1064478
82.22.26.111    4       203309   27914 4153594 27741048    0    0 2w0d            1
87.76.198.6     4       204211   29282 1240794 27741048    0    0 4d10h           4
87.76.198.11    4       215172   10017 1229347 27741048    0    0 4d10h           3
87.76.198.12    4        11421   10860 1228761 27741048    0    0 4d10h           5
87.76.198.20    4       153376      38  179351 27741048    0    0 00:23:14        1
87.76.198.131   4        40929    9476 1229116 27741048    0    0 4d10h           2
87.76.198.138   4       202396    8374 1228825 27741048    0    0 4d10h           0
154.18.49.2     4          174 3900471   27640 27741048    0    0 2w0d      1021827


这个是BGP Session v6 全体Peer状态信息
show  bgp ipv6 unicast summary
返回信息如下，注意匹配相关用户的那行，不要给用户其他用户的信息。

BGP router identifier 154.18.49.3, local AS number 206069
BGP table version is 15872013, main routing table version 15872013
Path RPKI states: 386697 valid, 90046 not found, 44 invalid
244692 network entries using 66556224 bytes of memory
476787 path entries using 76285920 bytes of memory
241453/64008 BGP path/bestpath attribute entries using 71470088 bytes of memory
311233 BGP AS-PATH entries using 17257384 bytes of memory
30047 BGP community entries using 4088500 bytes of memory
13388 BGP large community entries using 2029660 bytes of memory
1138 BGP extended community entries using 91912 bytes of memory
2620 BGP route-map cache entries using 188640 bytes of memory
0 BGP filter-list cache entries using 0 bytes of memory
BGP using 237968328 total bytes of memory
BGP activity 1949064/639826 prefixes, 6058059/3494878 paths, scan interval 60 secs
244899 networks peaked at 02:31:27 Aug 11 2026 UTC (6d14h ago)

Neighbor        V           AS MsgRcvd MsgSent   TblVer  InQ OutQ Up/Down  State/PfxRcd
2402:4480:2::8E:98
                4          174 3186212   59364 15871727    0    0 2w0d       231932
2402:4480:2:C::2
                4          174       0       0        1    0    0 never    Idle (Admin)
2A13:EDC0:FFFF:D001::1
                4       216211 7474010   77967 15871727    0    0 1w5d       244526
2A14:7586:6109::4
                4       204211  142049 1102565 15871727    0    0 4d10h         210
2A14:7586:6109::6
                4        11421   23573 1090494 15871727    0    0 4d10h          28
2A14:7586:6109::7
                4       207529   24392 1090218 15871727    0    0 4d10h          23
2A14:7586:6109::8
                4       215172   47234 1090990 15871727    0    0 4d10h          33
2A14:7586:6109::15:3376
                4       153376   27245 2101325 15871727    0    0 1w2d            9
2A14:7586:6109:1::8
                4       202396    9484 1090898 15871727    0    0 4d10h           2
2A14:7586:6109:1::1D
                4       202939   10568 1090832 15871727    0    0 4d10h           4
2A14:7586:6109:1::36
                4       216299   10036 1090832 15871727    0    0 4d10h           3
2A14:7586:6109:1::DE
                4       203309       0       0        1    0    0 never    Idle
2A14:7586:6109:1::EA
                4       197817   12221 1090894 15871727    0    0 4d10h           7
2A14:7586:6109:1::EB
                4        40929   12758 1090898 15871727    0    0 4d10h           8

这个可以查看收到来自Peer v4的路由
show bgp ipv4 unicast neighbor 87.76.198.20  routes 

v6同理

这个可以查看发给我们上游的v4路由。
show bgp ipv4 unicast neighbor 154.18.49.2   adv          这个是as174
show bgp ipv4 unicast neighbor 80.249.134.244   adv          这个是as216211

这个可以查看发给我们上游的v6路由。
show bgp ipv6 unicast neighbor 2402:4480:2::8E:98   adv          这个是as174
show bgp ipv6 unicast neighbor 2A13:EDC0:FFFF:D001::1  adv          这个是as216211

