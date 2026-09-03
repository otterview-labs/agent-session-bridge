# Agent Session Bridge

一个面向个人工作流的多会话桥接器：把本机多个 `Codex CLI` 会话统一托管起来，再通过本地 CLI、HTTP API 或飞书机器人来远程控制。

> [!WARNING]
> 本项目可以读取工作区文件、向 Agent 会话发送输入并执行经审批的本机命令。默认只监听 `127.0.0.1`。不要把服务无鉴权暴露到公网；绑定非回环地址时必须设置强 `ASB_API_TOKEN`、明确的 `ASB_ALLOWED_HTTP_HOSTS` 和 `ASB_ALLOWED_WORKSPACE_ROOTS`，并通过受信任的 HTTPS 反向代理或 VPN 访问。

它的重点不是“做一个单独的平台机器人”，而是“稳定管理多条本机 Codex 会话”：

- 会话常驻，不因手机断线而中断
- 多项目并行，每个项目对应独立 Codex 会话
- 支持远程查看状态、发送 prompt、抓取最近输出
- 内置巡检模块，定时观察会话是否仍然健康

## 序曲

这个项目并不是从“我要做一个聊天机器人”开始的，而是从一个更具体的个人需求开始的：

- 希望在手机上远程接续本机的 `Codex CLI` 会话
- 希望同时管理多个项目，而不是只盯着一个终端窗口
- 希望会话常驻在本机，不因为手机断开或终端关闭而丢状态
- 希望后续能接入飞书、Web、HTTP、Tailscale 等不同入口
- 希望有一层“监督”能力，能定时看会话是不是还活着、在输出什么

所以它的第一原则就不是“平台绑定”，而是“多会话管理”。

也正因为这个原因，项目没有沿用飞书相关命名，而是采用更通用的名字 `Agent Session Bridge`：

- `Agent`：这里主要指本机运行的 `Codex CLI`
- `Session`：每个项目或任务对应一条独立会话
- `Bridge`：不同入口都只是桥接层，核心始终是会话管理

这个 README 记录的不是一份抽象设想，而是目前项目已经落地的设计与实现结果。

## 项目背景

这个项目当前解决的是下面这类真实场景：

- 本机同时跑多个 Codex，会话分别对应不同项目目录
- 需要随时从浏览器、飞书或接口查看哪个会话在跑什么
- 需要把一句自然语言 prompt 定向发给某个会话
- 需要在会话卡住、掉线、停掉时能及时发现
- 需要给未来的“监督模型 / 告警策略 / 多入口控制”留好基础设施

因此它的核心不是“聊天消息收发”，而是：

- 会话注册
- 会话持久化
- 会话路由
- 会话状态观察
- 不同入口的统一接入

## 当前能力

当前版本已经实现：

- 多 `Codex CLI` 会话创建、切换、停止、重命名
- 多 Agent 运行时：`codex`、`claude-code`、`gemini`
- 基于 `tmux` 的会话持久化
- 基于 `SQLite` 的会话注册表
- 本地命令行入口
- 通用 HTTP API
- 飞书长连接入口
- 会话监督器 `Supervisor`
- 白名单控制与基础访问限制
- SSE 实时事件流与消息历史持久化
- Workspace 文件树、文件预览、`git status`、`git diff`
- 审批中心：高风险停止会话、终端命令进入审批
- 受控终端：只读命令直跑，危险命令走审批
- Machines 模型：本机自动注册为 `local`，支持按机器 spawn
- 浏览器通知、PWA 安装、基础离线缓存
- 飞书主动通知：审批与失败终端命令可推送到指定群聊
- 浏览器语音输入与语音审批快捷处理
- 统一 `AI Butler`：集中管理机器、Agent 运行时与远程服务
- 可选的外部服务器管理适配：服务器诊断、服务状态、日志和需审批的运维命令（兼容项目需单独安装）

当前已经支持的控制入口：

- 本地 CLI
- HTTP API
- 浏览器 Web UI
- 飞书自建应用机器人（长连接）

### 能力状态

| 能力 | 状态 |
| --- | --- |
| 本地 `tmux` 会话与 Codex 适配 | 可用，仍处于早期版本 |
| Claude Code / Gemini CLI 适配 | 实验性 |
| HTTP API / Web UI / SSE | 可用，面向单一可信操作者 |
| 飞书长连接入口 | 实验性，必须配置白名单 |
| 本地文件预览与受控终端 | 实验性，高权限功能 |
| 远程机器 spawn | 尚未实现 |
| 外部服务器管理适配 | 可选集成，不包含在本仓库中 |

## HAPI 能力对齐计划

为了把项目从“多会话桥接器”进一步升级成“移动优先的本地 Agent 控制面”，仓库现在补充了一份面向 `HAPI` 风格能力的对齐规划。

这份规划的原则是：

- **同步能力，不直接复制实现**
- **保留 `tmux + SQLite` 内核**
- **优先补实时事件、审批、文件、终端、PWA 与通知**
- **为未来多机器、多 Agent、语音入口留接口**

详细规划见：

- `docs/hapi-capability-sync.md`

HAPI 仅作为产品能力研究来源。本仓库按独立实现原则开发，不应复制 HAPI 的源码、文案、视觉资源或协议实现；相关项目继续适用其各自许可证。

Workspace 的 Git 状态与 Diff 由进程内的纯 JavaScript 读取器生成，不调用仓库配置的 clean filter、external diff 或 hook。为避免越界读取，只支持元数据位于工作区内部的普通 `.git` 目录；外置 worktree / submodule 指针会安全降级为不可用。

当前 Git 预览聚焦文件内容变化，不承诺复现原生 Git 的重命名检测或仅文件模式（`chmod`）变化；需要权威输出时，可通过受审批的终端命令运行原生 Git。

## 当前产品形态

当前这个项目已经不是单纯的脚手架，而是一个可运行的本地多会话管理器。

目前的产品形态分为四层：

- **会话内核**：基于 `tmux + SQLite`
- **控制接口**：CLI、HTTP API、SSE
- **远程入口**：飞书长连接
- **轻量前端**：浏览器 / PWA 聊天式界面 + `AI Butler` 统一运维面板

其中浏览器界面已经从“管理控制台”收敛成更轻的交互方式：

- 前台是一个聊天主界面
- 中段增加一个 `AI Butler` 指挥区，用来统一查看机器、运行时与远程服务
- 后台通过右侧筛选抽屉选择目标机器 / 会话
- 日常操作尽量走“选目标 → 直接发话”的路径
- 管理命令仍可通过 `/list`、`/tail`、`/stop` 这类命令执行
- 审批、终端、文件、机器等能力也都有等价命令兜底

这套形态更接近“一个面向本机 Codex 的聊天控制台”，而不是一块堆满操作面板的后台。

## 设计取向

项目当前遵循下面这些取向：

- **先本机、后远程**：先把本地会话托管稳，再谈手机和平台入口
- **先会话、后平台**：飞书、Web、HTTP 都只是入口，不是核心本体
- **先文本、后卡片**：尽量让自然语言和简单命令先跑通
- **先观察、后自动化**：先知道会话发生了什么，再决定要不要自动处理
- **先轻量、后扩展**：不引入过重前端框架或复杂平台依赖

## 典型架构

```text
Phone / Feishu / HTTP Client
          ↓
   Agent Session Bridge
    ├─ Command Router
    ├─ Session Service
    ├─ Supervisor Service
    ├─ tmux Manager
    ├─ SQLite Repository
    └─ Channel Adapters
          ↓
   Multiple local Codex CLI sessions
```

## 适合的使用场景

- 手机上查看当前有哪些 Codex 会话
- 为不同项目创建独立 Codex 会话
- 给指定会话发送 prompt
- 检查会话最近输出和运行状态
- 用飞书或 HTTP 做一个轻量远程入口
- 让 Codex 在本机长期挂着，不依赖当前终端窗口

## 运行环境

- `Node.js 22+`
- `tmux`
- 已安装可用的 `Codex CLI`
- macOS / Linux 风格终端环境

如果你要启用飞书入口，还需要：

- 一个飞书自建应用
- 机器人能力
- 长连接事件订阅
- 消息接收与回复相关权限

如果你还想启用“主动通知到飞书群”，再额外配置：

- `ASB_FEISHU_NOTIFY_CHAT_IDS`
  - 逗号分隔的目标群聊 `chat_id`
  - 用于审批请求、审批结果、失败终端命令和 `/notify test`

## 快速开始

### 1. 安装依赖

```bash
cd /path/to/agent-session-bridge
cp .env.example .env
npm install
brew install tmux
```

### 2. 配置 Codex 启动命令

最关键的是 `ASB_CODEX_BIN`。

默认写法：

```bash
ASB_CODEX_BIN="codex --no-alt-screen"
```

如果你的机器上代理环境容易干扰 CLI 或 SDK，可以写成：

```bash
ASB_CODEX_BIN="env -u HTTP_PROXY -u HTTPS_PROXY -u ALL_PROXY -u http_proxy -u https_proxy -u all_proxy /path/to/codex --no-alt-screen"
```

如果你希望统一纳入 `Claude Code` 和 `Gemini CLI`，可以继续配置：

```bash
ASB_CLAUDE_BIN="claude"
ASB_GEMINI_BIN="gemini"
```

如果你维护了兼容的外部服务器管理项目，并希望把它作为可选能力接入 Butler，可以配置：

```bash
ASB_SERVER_MANAGER_PATH="../server-manager"
ASB_SERVER_MANAGER_CONFIG="servers_config.json"
ASB_PYTHON_BIN="python3"
```

### 3. 构建项目

```bash
npm run build
```

### 4. 先用本地 CLI 验证

```bash
node dist/cli.js /ping
node dist/cli.js /list
node dist/cli.js /new demo /path/to/your/projects/demo
node dist/cli.js /tail demo
```

### 5. 启动 HTTP 服务

```bash
npm run start:server
```

默认监听：

- `http://127.0.0.1:8787`

如果你本机已有端口占用，可以在 `.env` 里改：

```bash
ASB_HTTP_PORT=8790
```

### 6. 打开浏览器界面

服务启动后，直接访问：

- `http://127.0.0.1:8787/`
- 或 `http://127.0.0.1:8787/ui`

如果你本地实际用了别的端口，比如：

- `http://127.0.0.1:8790/`

当前界面是“聊天主界面 + 机器筛选抽屉”的结构：

- 聊天区尽量简洁，只保留消息流和输入框
- 机器 / 会话选择放在右上角筛选抽屉里
- 当前目标会话一旦选中，日常交互就走聊天输入
- API Token、会话新建、会话切换、巡检等管理能力也收在抽屉里

## 命令总览

### 基础命令

- `/help`
- `/ping`
- `/list`
- `/sessions`

### 会话管理

- `/new <name> <workspace_path>`
- `/use <name>`
- `/current`
- `/status [name]`
- `/inspect [name]`
- `/rename <old_name> <new_name>`
- `/stop <name>`

### 交互命令

- `/send <name> <prompt>`
- `/ask <prompt>`
- `/tail [name]`

### 监督命令

- `/watch`
- `/watch run`

## CLI 使用示例

```bash
node dist/cli.js /new demo /path/to/your/projects/demo
node dist/cli.js /use demo
node dist/cli.js /ask 帮我看看这个项目主要是干啥的
node dist/cli.js /tail
node dist/cli.js /inspect demo
node dist/cli.js /watch run
```

## HTTP API

服务启动后，可通过以下接口访问：

- `GET /health`
- `GET /sessions`
- `GET /sessions/:name`
- `GET /sessions/:name/tail`
- `POST /command`
- `GET /supervisor`
- `POST /supervisor/run`

示例：

```bash
curl http://127.0.0.1:8787/health

curl -X POST http://127.0.0.1:8787/command \
  -H 'Content-Type: application/json' \
  -d '{"command":"/list","actorId":"phone"}'
```

如果配置了 `ASB_API_TOKEN`，调用侧也需要带上鉴权信息。

## Web UI

项目现在自带一个轻量 Web 控制台，适合放在本机浏览器或手机浏览器里使用。

主要能力：

- 聊天主界面
- 右侧筛选抽屉选择目标机器 / 会话
- 当前服务与 `Supervisor` 状态展示
- 新建会话表单
- `/use`、`/inspect`、`/tail`、`/stop`
- 自然语言发送 prompt
- 支持填写 `ASB_API_TOKEN`

界面交互有两个原则：

- 尽量像聊天，而不是像传统后台管理页
- 把“目标筛选”和“管理动作”藏到次级层，不打断主输入流程

这个界面不依赖额外前端框架，直接由内置 HTTP 服务托管静态文件。

## 飞书入口

项目支持飞书**长连接**入口，不需要额外暴露公网回调地址。

在 `.env` 中至少需要配置：

```bash
ASB_FEISHU_ENABLED=true
ASB_FEISHU_APP_ID=cli_xxx
ASB_FEISHU_APP_SECRET=xxx
ASB_FEISHU_ALLOWED_OPEN_IDS=ou_xxx
ASB_FEISHU_ALLOWED_CHAT_IDS=
ASB_FEISHU_GROUP_PREFIX=
ASB_FEISHU_REPLY_IN_THREAD=true
```

飞书开放平台里建议至少打开：

- 机器人能力
- 长连接事件订阅
- 事件 `im.message.receive_v1`
- 消息接收 / 发送 / 回复相关权限

飞书里可以直接发送：

```text
/list
/new demo /path/to/your/projects/demo
/watch
/watch run
/inspect demo
/tail demo
/stop demo
```

官方文档：

- 接收消息：`https://open.feishu.cn/document/uAjLw4CM/ukTMukTMukTM/reference/im-v1/message/events/receive`
- 回复消息：`https://open.feishu.cn/document/server-docs/im-v1/message/reply`
- 获取 `tenant_access_token`：`https://open.feishu.cn/document/server-docs/authentication-management/access-token/tenant_access_token_internal`
- 长连接接收事件：`https://open.feishu.cn/document/server-docs/event-subscription-guide/event-subscription-configure-/request-url-configuration-case`

## 监督模型 / 巡检机制

项目内置 `Supervisor`，会定时巡检所有已注册会话：

- 检查对应的 `tmux window` 是否仍存在
- 抓取最近输出
- 推断当前观察状态
- 产出统一的 inspection 结果

当前会给出这些基础状态：

- `ready`
- `active`
- `trust_prompt`
- `missing_window`
- `unknown`

这套机制适合作为后续“监督模型”的底层观测输入。
如果以后要接入更强的模型分析，只需要把这些 inspection 结果继续送给上层模型做摘要、预警或自动处理即可。

## 关键配置项

常用配置见 `.env.example`：

| 配置项 | 说明 |
| --- | --- |
| `ASB_CODEX_BIN` | Codex 启动命令，可写完整命令串 |
| `ASB_ALLOWED_WORKSPACE_ROOTS` | 限制允许创建会话的工作目录根路径 |
| `ASB_HTTP_HOST` | HTTP 服务监听地址 |
| `ASB_HTTP_PORT` | HTTP 服务端口 |
| `ASB_ALLOWED_HTTP_HOSTS` | 非回环监听允许接受的 Host 名称列表 |
| `ASB_API_TOKEN` | HTTP API 鉴权令牌；非回环监听时至少 32 字符 |
| `ASB_AUTO_CONFIRM_WORKSPACE_TRUST` | 是否自动确认 Agent 的目录信任提示，默认关闭 |
| `ASB_SUPERVISOR_ENABLED` | 是否启用监督巡检 |
| `ASB_SUPERVISOR_INTERVAL_MS` | 巡检间隔 |
| `ASB_SUPERVISOR_TAIL_LINES` | 巡检抓取输出行数 |
| `ASB_FEISHU_ENABLED` | 是否启用飞书入口 |
| `ASB_FEISHU_ALLOWED_OPEN_IDS` | 允许控制的用户白名单 |
| `ASB_FEISHU_ALLOWED_CHAT_IDS` | 允许控制的群聊白名单 |
| `ASB_FEISHU_GROUP_PREFIX` | 群聊命令前缀 |
| `ASB_FEISHU_REPLY_IN_THREAD` | 是否在线程里回复 |

## 安全建议

- 不要把 `.env` 提交到仓库
- 保持默认的 `ASB_HTTP_HOST=127.0.0.1`；不要直接监听公网地址
- 绑定非回环地址时，程序会强制要求至少 32 字符的 `ASB_API_TOKEN`、`ASB_ALLOWED_HTTP_HOSTS` 和 `ASB_ALLOWED_WORKSPACE_ROOTS`
- 可使用 `openssl rand -hex 32` 生成随机 API Token
- 启用飞书入口时必须至少配置一项 `open_id` 或 `chat_id` 白名单，否则程序拒绝启动
- `ASB_AUTO_CONFIRM_WORKSPACE_TRUST` 默认关闭；只对你完全信任的目录开启
- 审批机制用于单一可信操作者避免误操作，不是多租户身份隔离；`actorId` 只是审计标签
- 终端、工作区预览和外部服务器管理都属于高权限功能，建议仅通过受信任的 HTTPS 反向代理或 VPN 使用
- 漏洞报告方式和支持范围见 [`SECURITY.md`](SECURITY.md)

## 项目结构

```text
agent-session-bridge/
  docs/
  src/
    app/
    channels/
    config/
    domain/
    infra/
    services/
    utils/
  data/
  package.json
  tsconfig.json
```

## 文档

- 架构说明：`docs/architecture.md`
- 命令设计：`docs/commands.md`
- 规划路线：`docs/roadmap.md`
- HAPI 能力对齐：`docs/hapi-capability-sync.md`
- 安全策略：`SECURITY.md`
- 贡献指南：`CONTRIBUTING.md`
- 支持说明：`SUPPORT.md`
- 版本记录：`CHANGELOG.md`

## 当前定位

这个项目目前更适合作为：

- 个人远程控制本机 Codex 的桥接层
- 手机控制多个本地开发会话的最小系统
- 后续扩展到 Telegram、Web、快捷指令等入口的核心内核
- 向 HAPI 风格本地优先控制面演进的稳定基础

它不是一个“大而全”的机器人平台，而是一套更轻、更稳、更适合个人工作流的多会话控制底座。

## 当前进度小结

截至目前，这个项目已经完成了下面这些关键节点：

- 完成独立项目初始化与 GitHub 仓库建立
- 完成 `tmux + SQLite + Node.js + TypeScript` 基础骨架
- 完成本地 CLI 与 HTTP API
- 完成 `Supervisor` 巡检服务
- 完成飞书长连接入口
- 完成浏览器 Web UI
- Web UI 已从控制台形态收敛到聊天主界面形态

也就是说，它已经具备“可用的本地多会话管理器”能力，而不再只是一个概念文档项目。

## 许可证

本项目采用 [Apache License 2.0](LICENSE) 开源。
