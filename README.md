# BGP Session 管理平台

客户提交 BGP session 申请，后台管理员人工核验 AS 所有权后，才能预览并确认开通或删除命令。用户端不能自助开通或删除 session。

## 本地运行

```bash
npm install
npm run dev
```

- 前端: http://127.0.0.1:5173/
- 后端: http://127.0.0.1:8787

## 安全执行策略

默认是 dry-run 模式。管理员点击开通/删除前，页面会弹出完整命令并要求输入 `CONFIRM`。后端还会再次验证状态、参数和确认文本。

真实路由器执行只有在显式设置环境变量时才会开启:

```bash
ROUTER_EXECUTE=true npm run dev:server
```

默认连接配置见 `.env.example`:

- `ROUTER_HOST=87.76.198.1`
- `ROUTER_USERNAME=bgpmanager`
- `ROUTER_PRIVATE_KEY=./id_ed22519`

私钥文件已加入 `.gitignore`，不要提交到仓库。

## 验证命令

```bash
npm run typecheck
npm run build
```
