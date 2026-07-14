# 凌岚直播平台网关

当前运行链路已从项目内的 B 站专用 Supervisor 切换为两层可组合架构：

- `ordinaryroad-gateway`：只负责 OrdinaryRoad B 站客户端、长连接事件解析和弹幕发送。
- `live-platform-gateway.mjs`：负责项目统一的 SSE、健康检查、幂等、分段、限速和审计协议。

前端仍使用原有 `/api/bilibili/events`、`/api/bilibili/send` 和 `/api/bilibili/health`，端口仍为 `8197`，因此现有页面配置无需迁移。后续接入斗鱼等平台时，只需增加协议驱动，不需要复制整套 Supervisor。

直播总控的“配置”页把 OrdinaryRoad 和 Social Stream Ninja 显示为两个独立连接器。两者同时接管 B 站时，SSN 负责入站消息，OrdinaryRoad 保持健康检查与文字回写；OrdinaryRoad 收到的重复入站事件不会进入主播队列。

## Cookie 无缝沿用

原有 Cookie 继续保存在工作区外层的 `.runtime/bilibili-auth.json`。新网关只接收这个文件的路径，并在发送前动态读取；Cookie 不会写入命令行、浏览器配置、日志或 Git。

已有 Cookie 不需要重新输入。需要更新时仍使用原命令：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .agents/skills/bilibili-live-automation/scripts/invoke-bilibili-automation.ps1 -Action configure-auth
```

Cookie 必须包含 `SESSDATA` 和 `bili_jct`。清除凭据：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .agents/skills/bilibili-live-automation/scripts/invoke-bilibili-automation.ps1 -Action clear-auth
```

## 构建与启动

首次构建 Java 适配器：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File ./Build-OrdinaryRoad-Gateway.ps1
```

正常运维继续使用原自动化命令：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .agents/skills/bilibili-live-automation/scripts/invoke-bilibili-automation.ps1 -Action configure -RoomId 12345678 -SelfUid 123456
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .agents/skills/bilibili-live-automation/scripts/invoke-bilibili-automation.ps1 -Action start
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .agents/skills/bilibili-live-automation/scripts/invoke-bilibili-automation.ps1 -Action status
```

`Run-Bilibili-Supervisor.ps1` 被保留为兼容入口，但它现在委托给 `Run-Live-Platform-Gateway.ps1`。旧的 `scripts/bilibili-room-supervisor.mjs` 暂时保留，作为人工回滚参考，不再由启动器运行。

## 健康检查

```powershell
Invoke-RestMethod http://127.0.0.1:8197/health
```

关键字段：

- `state: online`：OrdinaryRoad 直播间长连接已建立。
- `bridgeEngine: ordinaryroad-live-chat-client`：已由新适配器接管。
- `outbound.configured: true`：凭据文件结构可用。
- `outbound.authenticated: true`：B 站已验证当前登录态。

健康接口不会返回 Cookie 或 CSRF。新日志位于：

- `logs/live-platform-gateway.out.log`
- `logs/live-platform-gateway.err.log`

## 发送保证

- 只在真实 TTS 开始时发送一次最终净化文本，不发送流式半成品或压力测试文本。
- 使用原始事件 ID 作为幂等键，页面重连和 TTS 重试不会重复发送同一回复。
- 长回复按 Unicode 字符和标点切段，默认每段最多 20 个字符，分段限速发送。
- 中途失败后仅重试尚未成功的分段。
- 鉴权账号 UID 自动加入自身事件过滤，避免数字人回复自己的弹幕形成循环。

## 审计与边界

统一审计链仍位于 `logs/linglan-audit-trail.jsonl`，发送请求、幂等键、结果与失败原因都进入同一个关联事件；Cookie、Token 和密钥只记录为 `[REDACTED]`。

B 站发送协议不是官方稳定开放 API，平台升级后可能需要更新 OrdinaryRoad 版本或适配器。系统不会自动发送公开测试弹幕；真实发言只会由用户启用文字同步并触发主播回复。推流、OBS 重连、Windows 断电恢复和平台内容审核不属于此网关职责。
