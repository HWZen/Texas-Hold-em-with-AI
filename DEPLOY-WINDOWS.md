# AI 德州扑克：公网 Windows 部署指南

本项目现在同时支持 Electron 桌面端和浏览器版。浏览器版是**单人、本地存档**游戏：每位访问者的设置与存档保存在自己的浏览器；对局逻辑和本地 AI 在浏览器执行。可选的云端 AI 请求只在服务器端读取密钥并转发，密钥不会发送给访问者。

## 架构

```text
Browser ── HTTPS ──> Caddy (443) ──> Node server.js (127.0.0.1:8080)
                                      ├─ serves /src/renderer + /src/game
                                      └─ optional /api/ai proxy
```

Caddy 负责公网 HTTPS；Node 只监听本机回环地址，因此 8080 不暴露在公网。

## 1. 准备服务器

1. 安装 Node.js **20 LTS 或更高版本**，安装 Git（如需要拉取代码）。
2. 将项目复制到例如 `C:\apps\Texas-Hold-em-with-AI`。
3. 在项目目录运行：

```powershell
npm ci --omit=dev
Copy-Item server.config.example.json server.config.json
notepad server.config.json
```

默认配置可直接使用本地 AI。若要启用云端 AI，填写 `aiApiUrl`、`aiApiKey`、`aiModel`；不要把真实密钥放进前端代码、Git 仓库或截图中。生产环境建议将 `server.config.json` 的 NTFS 读取权限限制给服务账号。

## 2. 本机验收

编辑 `server.config.json`，保持以下设置（Caddy 反代时必须是 `127.0.0.1`）：

```json
{ "port": 8080, "host": "127.0.0.1" }
```

启动：

```powershell
npm run web
```

在服务器浏览器打开 `http://127.0.0.1:8080`。首次进入后应能直接开始牌局。按 `Ctrl+C` 可停止测试进程。

> 只有临时、不经 HTTPS 测试时，才将 `host` 改为 `0.0.0.0` 并在 Windows 防火墙开放 TCP 8080；不要将这种配置长期暴露在公网。

## 3. 使用 Caddy 提供公网 HTTPS（推荐）

1. 将域名的 A/AAAA 记录指向这台公网 Windows 机器。确保公网 TCP **80** 和 **443** 都能到达该机器（云安全组、路由器端口映射和 Windows 防火墙均要检查）。
2. 安装 Caddy for Windows，并把 `deploy\Caddyfile` 复制到 Caddy 安装目录；把其中的 `poker.example.com` 改为你的实际域名。
3. 让 Caddy 以 Windows 服务方式运行。Caddy 会自动申请和续期 TLS 证书。
4. 为 Node 游戏服务创建一个开机自启的服务。可使用 NSSM：

```powershell
nssm install RoyalRiverPoker "C:\Program Files\nodejs\node.exe" "C:\apps\Texas-Hold-em-with-AI\server.js"
nssm set RoyalRiverPoker AppDirectory "C:\apps\Texas-Hold-em-with-AI"
nssm set RoyalRiverPoker Start SERVICE_AUTO_START
nssm start RoyalRiverPoker
```

随后通过 `https://你的域名` 访问。Node 进程异常时，NSSM 可自动重启；Caddy 的日志用于排查 TLS 或反向代理问题。

## 4. 更新发布

```powershell
cd C:\apps\Texas-Hold-em-with-AI
git pull
npm ci --omit=dev
nssm restart RoyalRiverPoker
```

更新前备份 `server.config.json`；它被 `.gitignore` 忽略，不会随 Git 更新。

## 安全与运行说明

- 本应用不包含登录、多用户房间、真钱支付或赌博结算功能；请仅按所在地适用法律把它作为娱乐游戏部署。
- 服务器只接受同源的 `/api/ai` 请求，AI 上游地址、模型和密钥由服务器配置固定，客户端提供的 URL/Key 会被忽略，避免开放代理或 SSRF 风险。
- 如果不配置云端 AI，玩家仍能完整使用内置本地 AI。
- 请定期更新 Node.js、Caddy 和系统补丁；不要把 8080 映射到公网。
