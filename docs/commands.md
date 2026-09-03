# Command Design

## 1. 设计目标

命令应满足三个要求：

- 手机上容易输入
- 解析稳定，不依赖自然语言猜测
- 能覆盖多 `Codex` 会话管理的核心动作

## 2. 第一版命令集

### 2.1 会话管理

- `/list`
  - 列出当前所有会话

- `/new <name> <workspace_path>`
  - 新建会话

- `/stop <name>`
  - 停止会话

- `/rename <old_name> <new_name>`
  - 重命名会话

- `/status <name>`
  - 查看单个会话状态

### 2.2 默认会话

- `/use <name>`
  - 将某会话设置为当前默认会话

- `/current`
  - 查看当前默认会话

### 2.3 交互与输出

- `/send <name> <prompt>`
  - 给指定会话发送 prompt

- `/ask <prompt>`
  - 发送到当前默认会话

- `/tail <name>`
  - 获取最近输出

- `/tailf <name>`
  - 预留给后续流式/连续轮询

### 2.4 系统命令

- `/help`
  - 输出帮助

- `/ping`
  - 健康检查

- `/sessions`
  - `/list` 的别名

## 3. 渠道返回格式建议

### 3.1 `/list`

```text
当前会话 4 个

1. web-app
   状态: idle
   目录: /path/to/your/projects/web-app

2. example-service
   状态: busy
   目录: /path/to/your/projects/example-service
```

### 3.2 `/status example-service`

```text
会话: example-service
状态: busy
目录: /path/to/your/projects/example-service
最近活跃: 2026-04-18 16:30
最近输出摘要: 正在检查服务状态与部署配置
```

### 3.3 `/tail example-service`

```text
[example-service 最近输出]
...
npm run check
...
```

## 4. 推荐的解析规则

### 4.1 参数分隔

建议采用：

- 第一个参数是会话名
- 后续剩余部分原样视作 prompt

例如：

```text
/send example-service 请检查这个项目当前的部署状态
```

解析为：

- `name = example-service`
- `prompt = 请检查这个项目当前的部署状态`

### 4.2 路径参数

`/new` 命令里的路径如果包含空格，建议要求用户加引号。

示例：

```text
/new demo "/path/to/your projects/demo"
```

## 5. 第二版可增加的命令

- `/approve <name>`
- `/deny <name>`
- `/restart <name>`
- `/snapshot <name>`
- `/summary <name>`
- `/archive <name>`
- `/worktree <repo> <task_name>`

## 6. HAPI 风格能力扩展

项目已经按“实时控制面”方向补充下面这些命令。它们的目标不是替代 Web UI，而是为飞书、手机和文本入口提供兜底能力。除明确标注“规划中”的项目外，本节命令均已接入当前 `CommandRouter`。

### 6.1 会话消息与历史（规划中）

- `/messages [name]`
  - 规划用于查看会话最近消息历史；当前请使用 HTTP API 或 Web UI

- `/events [name]`
  - 规划用于查看会话最近事件摘要；当前请使用 SSE / HTTP API

### 6.2 审批

- `/approvals`
  - 查看当前待审批请求

- `/approve <id>`
  - 批准某个审批请求

- `/deny <id>`
  - 拒绝某个审批请求

### 6.3 文件与 Git

- `/files <name> [path]`
  - 查看某个会话 workspace 的文件树

- `/cat <name> <path>`
  - 读取某个文件内容

- `/git <name> status`
  - 查看 git 状态

- `/diff <name> [path]`
  - 查看 git diff

### 6.4 终端

- `/terminal <name> <command>`
  - 在会话 workspace 中执行受控命令

- `/terminal-status <id>`
  - 查看终端命令执行状态

- `/terminal-cancel <id>`
  - 取消某个长时间运行的终端命令

### 6.5 机器与远程启动

- `/machines`
  - 查看当前可用机器或 runner

- `/spawn <machine> <name> <workspace_path> [agent_type]`
  - 在指定机器上创建新会话

### 6.6 通知与语音

- `/notify test`
  - 发送一条测试通知

- `/voice status`
  - 规划用于查看语音入口状态，当前尚未接入文本命令路由

- `/voice stop`
  - 规划用于关闭当前语音会话，当前尚未接入文本命令路由

## 7. 卡片交互设计

第二版可以给 `/status` 增加按钮：

- `发送消息`
- `查看输出`
- `设为默认`
- `停止会话`

但第一版仍建议以纯文本命令为主。

如果项目进入 HAPI 风格阶段，建议同时支持：

- `批准`
- `拒绝`
- `查看文件`
- `查看 diff`
- `打开终端`
- `切换机器`

## 8. 命令演进原则

即使后续增加结构化 API 和 Web/PWA，也建议保留命令层，原因是：

- 飞书等文本渠道天然适合命令兜底
- 手机端弱网或 PWA 失效时仍可操作
- 命令更适合作为调试与运维入口

设计原则：

- 常用动作应有结构化 API，也应保留命令等价形式
- 危险动作默认不直接执行，优先进入审批
- 文件和终端能力默认只读或受控，避免把桥接器变成裸露 shell
