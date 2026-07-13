# 凌岚 B 站直播间自动化

这条链路复用一个本地 Supervisor，同时承担两项能力：

- 通过公开直播间长链和历史接口接收弹幕、醒目留言、礼物与进场事件。
- 在显式开启后，用本机登录凭据把主播实际说出的文字同步发到 B 站弹幕区。

接收链路不需要登录。发送链路需要 B 站账号登录凭据，但凭据只保存在工作区外层的
`.runtime/bilibili-auth.json`，不会写入浏览器设置、日志或 Git。

## 启动监听

在项目根目录执行：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .agents/skills/bilibili-live-automation/scripts/invoke-bilibili-automation.ps1 -Action configure -RoomId 12345678 -SelfUid 123456
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .agents/skills/bilibili-live-automation/scripts/invoke-bilibili-automation.ps1 -Action start
```

将示例数字替换为直播间号和用于发送弹幕的账号 UID。启动应用后，在
`Settings -> Stream` 中选择 B 站并启用直播间监听。

## 配置文字回发鉴权

不要把 Cookie 发到聊天或命令行参数中。请在自己的 PowerShell 终端运行：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .agents/skills/bilibili-live-automation/scripts/invoke-bilibili-automation.ps1 -Action configure-auth
```

在已登录的 `live.bilibili.com` 页面打开开发者工具，从任意 B 站直播请求的 Request
Headers 中复制完整 `Cookie` 值，粘贴到隐藏输入框。Cookie 必须包含 `SESSDATA` 和
`bili_jct`。Supervisor 会动态读取凭据，无需重启。

随后在 `Settings -> Stream` 中开启“主播说话时同步发送文字到 B 站弹幕区”。该开关
默认关闭；关闭即可立即回退到只监听和语音回复。

清除本机凭据：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .agents/skills/bilibili-live-automation/scripts/invoke-bilibili-automation.ps1 -Action clear-auth
```

## 发送保证

- 在真实 TTS 开始时发送一次最终净化文本，覆盖弹幕回复、主动搭话和总控手动播报；不发送流式半成品或压力测试文本。
- 使用原始事件 ID 做幂等键；页面重复消费、TTS 重试不会重复发同一条回复。
- 长回复按 Unicode 字符和标点切段，默认每段最多 20 字符、段间至少 1.6 秒。
- 如果中途失败，重试会从尚未成功的分段继续。
- 鉴权账号 UID 会自动加入自身事件过滤，避免数字人回复自己的弹幕形成循环。

## 健康检查

```powershell
Invoke-RestMethod http://127.0.0.1:8197/health
```

`state: online` 表示接收长链已连接。`outbound.configured: true` 表示本机鉴权文件有效，
首次发送前后 `outbound.authenticated` 会变为 `true`。健康接口不会返回 Cookie 或 CSRF。

运行日志位于：

- `logs/bilibili-supervisor.out.log`
- `logs/bilibili-supervisor.err.log`

## 边界

- 发送使用 B 站网页播放器当前使用的 `/msg/send` 协议，不是开放平台承诺稳定的开发者
  API；B 站升级网页协议后可能需要同步修改发送适配器。
- 不自动执行公开测试弹幕。真实发言会影响直播间，必须由用户明确开启开关并触发回复。
- 推流、OBS 自动重连、Windows 断电恢复和平台内容审核不由本脚本替代。
