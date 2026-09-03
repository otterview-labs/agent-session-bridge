# Roadmap

## Phase 0：环境验证

目标：

- 确认本机 `codex` 可正常启动
- 安装 `tmux`
- 打通第一种消息渠道的最小消息收发

交付物：

- 本机可手工创建 `tmux + codex` 会话
- 渠道适配器能收到并回复 `/ping`

验收标准：

- 能通过第一种消息渠道拿到一条固定回复
- 能手工在终端中创建至少两条 `Codex` 会话

## Phase 1：本地多会话控制器

目标：

- 不接任何消息渠道，先做本地会话控制核心

功能：

- 创建会话
- 列出会话
- 发送 prompt
- 抓取输出
- 停止会话

交付物：

- 一个本地控制模块
- 一个 SQLite 会话表

验收标准：

- 可同时管理 3 条以上 `Codex` 会话
- 可根据名字定位并抓取指定窗口输出

## Phase 2：第一渠道接入

目标：

- 把第一种外部消息映射到本地控制器

功能：

- `/ping`
- `/list`
- `/new`
- `/send`
- `/tail`
- `/stop`

交付物：

- 渠道消息适配层
- 命令路由层

验收标准：

- 手机端可以创建会话
- 手机端可以向指定会话发送 prompt
- 手机端可以查看最近输出

## Phase 3：权限与可用性

目标：

- 让这个工具可以长期稳定自用

功能：

- 白名单鉴权
- 路径前缀限制
- 危险操作确认
- 日志落盘
- 错误恢复

交付物：

- 配置化安全策略
- 健康检查与日志模块

验收标准：

- 未授权用户无法控制
- 危险命令不会被误触发
- 服务重启后会话记录仍在

## Phase 4：体验增强

目标：

- 提升手机操作体验

功能：

- 默认会话
- 会话摘要
- 渠道卡片按钮
- 输出自动截断与格式化
- 忙碌状态提示

交付物：

- 更友好的消息模版
- 更少命令输入成本

验收标准：

- 常用操作能在 1 到 2 条消息内完成
- 输出内容清晰，不刷屏

## Phase 5：高级能力

目标：

- 在不破坏简单性的前提下，增加高级协作能力

可选功能：

- `git worktree` 自动创建
- 审批消息闭环
- 多用户隔离
- Web 状态页
- 任务摘要推送

这部分不是第一阶段重点，必须在 Phase 1 到 Phase 3 稳定后再考虑。

## Phase 6：实时事件流与消息持久化

目标：

- 把当前轮询式桥接器升级为实时控制面

功能：

- `SessionEventBus`
- `ConversationService`
- `session_messages`
- `session_events`
- `SSE /events`
- Web 自动刷新

交付物：

- 服务内事件总线
- 消息持久化
- 实时消息与状态同步

验收标准：

- 发送 prompt 后 Web 可自动看到回执和最近输出
- Supervisor 巡检可实时刷新到前端
- 刷新页面后仍能看到最近消息历史

## Phase 7：文件与 Git 工作区

目标：

- 在远端直接观察 session 对应的工作区变化

功能：

- 文件树浏览
- 文件预览
- `git status`
- `git diff`
- 文件搜索

交付物：

- `WorkspaceService`
- 文件与 Git API
- Web `Files` / `Changes` 面板

验收标准：

- 手机能查看 workspace 文件树
- 手机能查看当前 git 修改摘要
- 无法读取 workspace 之外的路径

## Phase 8：审批中心与通知

目标：

- 离开电脑时也能处理卡点和危险动作

功能：

- 审批请求队列
- 批准/拒绝动作
- 浏览器通知
- 飞书通知闭环

交付物：

- `ApprovalService`
- `approval_requests`
- Web 审批面板
- 飞书审批消息模板

验收标准：

- 高风险动作进入待审批状态
- Web 和飞书都能批准或拒绝
- 审批结果会被记录到消息历史和事件流

## Phase 9：受控终端

目标：

- 在保证安全的前提下提供远程终端能力

功能：

- 受限命令执行
- 命令输出流
- 超时、取消、摘要
- 危险命令审批

交付物：

- `TerminalService`
- `terminal_commands`
- Web Terminal 面板

验收标准：

- 可在指定 workspace 执行安全命令
- 危险命令必须先审批
- 输出可流式查看并记录摘要

## Phase 10：机器模型与远程 Spawn

目标：

- 从单机桥接器升级为多机器控制面

功能：

- 机器注册
- 机器心跳
- 机器标签
- 指定机器 spawn 会话

交付物：

- `MachineService`
- `machines`
- `/spawn`
- Machines 面板

验收标准：

- 系统可展示在线机器
- 能在指定机器上创建新会话
- 机器离线后不可继续 spawn

## Phase 11：PWA 与移动端体验

目标：

- 提升手机端常驻与弱网可用性

功能：

- PWA 安装
- app shell cache
- 最近消息缓存
- 离线提示
- 恢复联网后的自动同步

交付物：

- `manifest.webmanifest`
- `service-worker.js`
- PWA 文档与配置

验收标准：

- 可添加到手机桌面
- 弱网或断网时能查看最近状态
- 恢复联网后自动刷新

## Phase 12：语音与多 Agent 扩展

目标：

- 对齐更完整的移动控制体验，并为多 Agent 预留能力

功能：

- 语音输入
- 语音审批
- 播报提醒
- `AgentAdapter`
- 多 `agent_type`

交付物：

- `VoiceBridgeService`
- Web Speech API 接入
- `AgentAdapter` 抽象
- `TmuxCodexAdapter`

验收标准：

- 可以用语音发 prompt
- 可以用语音处理待审批请求
- 新会话支持记录 `agent_type`

## 关联文档

详细能力清单与表结构、模块、API 草案见：

- `docs/hapi-capability-sync.md`
