# 凌岚 B 站直播间守护

这条链路使用公开直播间的匿名弹幕长链，不需要登录 B 站账号，
也不需要直播开放平台审核。它负责读取弹幕、醒目留言、付费礼物和大航海事件，
经过现有的评论安全筛选后，交给凌岚生成语音回应。

## 首次启动

在 PowerShell 中进入项目目录，执行：

```powershell
.\Start-Linglan-Bilibili.bat -RoomId 12345678
```

`.bat` 入口会仅对本次启动使用 `ExecutionPolicy Bypass`，不会修改系统级
PowerShell 执行策略。

把 `12345678` 换成直播间 URL 末尾的数字。脚本会把它保存到
`config/bilibili-room.txt`，以后可直接运行：

```powershell
.\Start-Linglan-Bilibili.bat
```

打开凌岚页面后，在 `Settings -> Stream` 中选择 `B站直播`，然后勾选
`启用 B 站直播间监听`。

## 健康检查

```powershell
Invoke-RestMethod http://127.0.0.1:8197/health
```

`state` 为 `online` 表示长链已连接。运行日志位于：

- `logs/bilibili-supervisor.out.log`
- `logs/bilibili-supervisor.err.log`

内层守护会在网络断开后指数退避重连；外层 PowerShell 守护会在 Node
进程意外退出后 5 秒重启。

## 边界

- 匿名连接只读；凌岚通过直播音频回应，不会用 B 站账号自动发弹幕。
- 这不是开放平台承诺稳定的开发者接口；B 站升级网页协议后可能需要同步修改。
- 推流、OBS 自动重连、Windows 断电恢复和平台内容审核不由本脚本代替。
