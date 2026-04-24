# Git 同步工具 - 设计文档

## 1. 项目概述

一个跨平台桌面 GUI 程序，用于自动同步 Git 仓库的提交记录到用户自定义的目标分支。核心功能是将源分支的所有提交以新的作者信息重新提交，同时保留原始提交时间，并强制推送到远程目标分支。

### 技术栈

| 组件 | 技术 | 版本 |
|------|------|------|
| GUI 框架 | PyQt6 | 6.6.1 |
| Git 操作 | GitPython | 3.1.40 |
| 定时调度 | APScheduler | 3.10.4 |
| 密码加密 | cryptography (Fernet) | 41.0.7 |
| Python | >= 3.10 | - |

## 2. 系统架构

```
┌─────────────────────────────────────────────────┐
│                    main.py                       │
│                  GitSyncApp                      │
│            (应用编排 / 生命周期管理)               │
├─────────┬──────────┬──────────┬─────────────────┤
│         │          │          │                  │
│  ConfigManager  Logger    GitService   SyncScheduler
│  (配置持久化)  (日志系统)  (同步引擎)    (定时调度)
│         │          │          │                  │
├─────────┴──────────┴──────────┴─────────────────┤
│                   GUI 层                         │
│         MainWindow    ConfigDialog               │
│        (主界面)       (配置对话框)                │
└─────────────────────────────────────────────────┘
```

### 分层职责

| 层 | 文件 | 职责 |
|----|------|------|
| 入口层 | `main.py` | 创建 QApplication，编排各组件，管理应用生命周期 |
| 配置层 | `config_manager.py` | 使用 QSettings 持久化配置，Fernet 加密密码 |
| 业务层 | `git_service.py` | 克隆/拉取仓库、解析分支、回放提交、强制推送 |
| 调度层 | `scheduler.py` | APScheduler 后台定时任务，每日自动同步 |
| 展示层 | `gui/main_window.py`, `gui/config_dialog.py` | PyQt6 界面：状态显示、日志查看、配置表单 |
| 工具层 | `utils/logger.py` | 单例日志器，支持 PyQt 信号实时推送到 UI |

## 3. 模块详细设计

### 3.1 入口层 — `main.py`

**类：`GitSyncApp`**

负责创建和连接所有组件：

```
GitSyncApp.__init__()
  │
  ├─ QApplication(sys.argv)
  ├─ ConfigManager()
  ├─ Logger()          ← 单例
  ├─ GitService(config)
  ├─ SyncScheduler()
  ├─ MainWindow(config)
  │    ├─ init_ui()           ← 构建 UI 布局
  │    ├─ connect_logger()    ← 连接日志信号
  │    └─ update_status()     ← 刷新状态标签
  ├─ scheduler.start()
  ├─ setup_schedule()         ← 如果已配置，注册每日任务
  └─ window.show()
```

**同步回调链路：**

```
用户点击"立即同步" / 定时器触发
  → MainWindow.on_sync_now()
    → GitSyncApp.perform_sync()
      → window.set_syncing(True)          ← 禁用按钮，显示进度条
      → git_service.sync()                ← 执行同步（见 3.3）
      → window.show_sync_result()         ← 显示结果对话框
      → window.set_syncing(False)         ← 恢复按钮
```

**生命周期：**
- `app.aboutToQuit` → `cleanup()` → `scheduler.shutdown()`

---

### 3.2 配置层 — `config_manager.py`

**类：`ConfigManager`**

**存储机制：** 使用 `QSettings("AutoCommit", "GitSync")` 持久化到系统原生存储（macOS: plist, Windows: 注册表, Linux: ini 文件）。

**加密方案：**

```
用户输入密码
  → Fernet.encrypt(明文)
  → base64.b64encode(密文)
  → QSettings 存储
```

**配置项：**

| 属性 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `repo_url` | str | `""` | Git 仓库 HTTPS 地址 |
| `username` | str | `""` | Git 认证用户名 |
| `password` | str | `""` | Git 认证密码（加密存储） |
| `source_branch` | str | `"main"` | 源分支名 |
| `target_branch` | str | `"my-sync-branch"` | 目标分支名 |
| `user_name` | str | `""` | 提交作者姓名 |
| `user_email` | str | `""` | 提交作者邮箱 |
| `sync_time` | str | `"00:00"` | 每日同步时间 (HH:mm) |
| `last_sync_hash` | str | `""` | 上次同步的最后一个 commit SHA |
| `last_sync_time` | str | `"从未同步"` | 上次同步时间 |

**`is_configured` 判定：** `repo_url`、`username`、`password`、`target_branch`、`user_name`、`user_email` 均非空。

---

### 3.3 业务层 — `git_service.py`

**类：`GitService`**

本地仓库路径：`~/.auto-commit-repo`

#### 3.3.1 同步总流程 (`sync()`)

```
sync()
  │
  ├─ 1. clone_or_pull()              ← 克隆或拉取最新
  ├─ 2. fetch_commits(since_hash)    ← 获取新提交列表
  │
  ├─ 3. 判断同步模式
  │     ├─ last_sync_hash 为空 → 全量同步
  │     └─ 目标分支不存在      → 全量同步
  │     └─ 否则                 → 增量同步
  │
  ├─ 4a. 全量同步路径
  │     ├─ prepare_branch_full_sync()
  │     │    ├─ checkout origin/{source_branch}
  │     │    ├─ 删除旧的目标分支
  │     │    ├─ git checkout --orphan {target_branch}
  │     │    └─ 清空索引和工作区
  │     └─ recommit_full(commits)
  │          └─ 对每个提交:
  │               ├─ git read-tree -u --reset {sha}  ← 用提交的树替换整个工作区
  │               └─ git commit -m {msg} --env {author_env}
  │
  ├─ 4b. 增量同步路径
  │     ├─ prepare_branch_incremental()
  │     │    └─ checkout 已存在的目标分支
  │     └─ recommit_incremental(commits)
  │          └─ 对每个提交:
  │               ├─ git cherry-pick --no-commit {sha}
  │               └─ git commit -m {msg} --env {author_env}
  │
  ├─ 5. push_to_remote()             ← git push --force
  └─ 6. 更新 last_sync_hash / last_sync_time
```

#### 3.3.2 认证 URL 构建 (`_get_auth_url()`)

```
输入: https://gitee.com/user/repo.git
用户名: 0816@qq.com
密码: abc@123

处理步骤:
  1. 去除已有凭据 (rsplit "@", 取右侧)
  2. 识别协议前缀，提取 host+path
  3. URL 编码用户名和密码
  4. 拼接: https://{encoded_user}:{encoded_pass}@{host_path}

输出: https://0816%40qq.com:abc%40123@gitee.com/user/repo.git
```

#### 3.3.3 远程分支自动检测 (`_resolve_remote_branch()`)

```
配置的 source_branch = "main"
  │
  ├─ 检查 origin/main 是否存在
  │     └─ 存在 → 返回 "main"
  │
  ├─ 读取 refs/remotes/origin/HEAD
  │     └─ 解析为 refs/remotes/origin/master
  │     └─ 返回 "master"
  │
  └─ 都失败 → 记录错误日志，列出所有可用远程分支
```

#### 3.3.4 作者信息覆写 (`_build_author_env()`)

对每个提交构建环境变量：

| 环境变量 | 值 |
|----------|-----|
| `GIT_AUTHOR_NAME` | 用户配置的姓名 |
| `GIT_AUTHOR_EMAIL` | 用户配置的邮箱 |
| `GIT_AUTHOR_DATE` | 原始提交时间 |
| `GIT_COMMITTER_NAME` | 用户配置的姓名 |
| `GIT_COMMITTER_EMAIL` | 用户配置的邮箱 |
| `GIT_COMMITTER_DATE` | 原始提交时间 |

---

### 3.4 调度层 — `scheduler.py`

**类：`SyncScheduler`**

基于 APScheduler 的 `BackgroundScheduler`，使用 `CronTrigger` 实现每日定时同步。

```
schedule_daily("09:30", callback)
  │
  ├─ 移除已有任务
  ├─ 解析 "09:30" → hour=9, minute=30
  ├─ 添加 CronTrigger 任务
  │    trigger = CronTrigger(hour=9, minute=30)
  └─ 记录 next_run_time

属性:
  - next_run_time → "2026-04-24 09:30:00" (字符串)
  - is_running → 调度器是否运行中
  - has_schedule → 是否有已注册的任务
```

---

### 3.5 展示层

#### 3.5.1 主窗口 — `gui/main_window.py`

**类：`MainWindow(QMainWindow)`**

**UI 布局：**

```
┌──────────────────────────────────────────┐
│              Git 同步工具                  │
├──────────────────────────────────────────┤
│ ▼ 状态信息                                │
│   上次同步:  2026-04-23 18:00:00          │
│   下次同步:  2026-04-24 00:00:00          │
├──────────────────────────────────────────┤
│  [  立即同步  ]    [  配置  ]              │
├──────────────────────────────────────────┤
│  ▓▓▓▓▓▓▓▓▓▓░░░░░░░░  (进度条)            │
├──────────────────────────────────────────┤
│ ▼ 日志                                    │
│ [2026-04-23 18:00:00] [INFO] 开始同步...   │
│ [2026-04-23 18:00:01] [INFO] 正在克隆...   │
│ [2026-04-23 18:00:05] [SUCCESS] 仓库克隆... │
│                                           │
│                              [清空日志]    │
└──────────────────────────────────────────┘
```

**日志颜色映射：**

| 级别 | 颜色 | 色值 |
|------|------|------|
| INFO | 深灰 | `#333` |
| WARNING | 橙色 | `#FFA500` |
| ERROR | 红色 | `#DC143C` |
| SUCCESS | 绿色 | `#228B22` |

**交互流程：**

```
点击"配置" → ConfigDialog 打开 → 保存后回调 on_config_saved()
点击"立即同步" → 检查 is_configured → 调用 _sync_callback
同步中 → 按钮禁用，显示无限进度条
同步完成 → 弹出结果对话框，更新状态标签
```

#### 3.5.2 配置对话框 — `gui/config_dialog.py`

**类：`ConfigDialog(QDialog)`**

**表单字段：**

| 字段 | 控件 | 必填 | 验证 |
|------|------|------|------|
| 仓库 URL | QLineEdit | 是 | - |
| 用户名 | QLineEdit | 是 | - |
| 密码 | QLineEdit (密码模式) | 是 | - |
| 源分支 | QLineEdit | 否 | 默认 "main" |
| 目标分支 | QLineEdit | 是 | - |
| 您的姓名 | QLineEdit | 是 | - |
| 您的邮箱 | QLineEdit | 是 | 正则校验 |
| 每日同步时间 | QTimeEdit | 否 | 默认 00:00 |

**保存流程：**
1. 验证所有必填字段非空
2. 校验邮箱格式
3. 写入 ConfigManager（密码加密存储）
4. 调用 `config.sync()` 刷盘
5. 触发 `on_config_saved` 回调

---

### 3.6 工具层 — `utils/logger.py`

**单例模式：** 继承 `QObject`，通过 `__new__` 确保全局唯一实例。

```
Logger (Singleton, QObject)
  │
  ├─ log_added: pyqtSignal(LogEntry)    ← UI 绑定此信号
  ├─ _logs: List[LogEntry]              ← 内部存储
  │
  ├─ info(msg) / warning(msg) / error(msg) / success(msg)
  │     └─ log(level, msg)
  │          ├─ 创建 LogEntry(level, msg, timestamp)
  │          ├─ _logs.append(entry)
  │          ├─ log_added.emit(entry)   ← 推送到 UI
  │          └─ print(entry)            ← 控制台输出
  │
  ├─ get_logs() → List[LogEntry]
  └─ clear()    → 清空 _logs
```

**信号传递链路：**

```
GitService / Scheduler 调用 logger.info()
  → Logger 单例 emit log_added 信号
  → MainWindow.add_log(entry) 槽函数
  → QTextEdit 追加带颜色的日志文本
```

## 4. 数据流

### 4.1 首次同步（全量）

```
远程仓库                    本地 (~/.auto-commit-repo)              远程目标分支
┌──────────┐               ┌──────────────────┐                  ┌──────────┐
│ origin   │               │                  │                  │          │
│ main     │─── clone ────→│ 本地克隆          │                  │  不存在   │
│          │               │                  │                  │          │
│ C1→C2→C3 │─── fetch ────→│ origin/main      │                  │          │
│          │               │     C1→C2→C3     │                  │          │
│          │               │                  │                  │          │
│          │               │ checkout --orphan │                  │          │
│          │               │ target_branch    │                  │          │
│          │               │                  │                  │          │
│          │               │ read-tree C1     │                  │          │
│          │               │ commit (new author)│                  │          │
│          │               │  → C1'           │                  │          │
│          │               │ read-tree C2     │                  │          │
│          │               │ commit (new author)│                  │          │
│          │               │  → C1'→C2'       │                  │          │
│          │               │ read-tree C3     │                  │          │
│          │               │ commit (new author)│                  │          │
│          │               │  → C1'→C2'→C3'   │── force push ──→│ C1'→C2'→C3'│
└──────────┘               └──────────────────┘                  └──────────┘
```

### 4.2 后续同步（增量）

```
远程仓库                    本地                              远程目标分支
┌──────────┐               ┌──────────────────┐              ┌──────────┐
│ origin   │               │                  │              │          │
│ main     │─── fetch ────→│ origin/main      │              │ C1'→C2'→C3'│
│ C1→C2→C3 │               │     C1→C2→C3→C4  │              │          │
│     →C4  │               │                  │              │          │
│          │               │ checkout target  │              │          │
│          │               │   C1'→C2'→C3'    │              │          │
│          │               │                  │              │          │
│          │               │ cherry-pick C4   │              │          │
│          │               │ commit (new author)│              │          │
│          │               │  → C1'→C2'→C3'→C4'│── push ────→│ C1'→C2'→C3'→C4'│
└──────────┘               └──────────────────┘              └──────────┘
```

### 4.3 配置数据流

```
ConfigDialog.save_config()
  │
  ├─ config.repo_url = "https://gitee.com/..."
  ├─ config.username = "user"
  ├─ config.password = "pass"     → Fernet 加密 → QSettings
  ├─ config.source_branch = "main"
  ├─ config.target_branch = "my-branch"
  ├─ config.user_name = "张三"
  ├─ config.user_email = "z@test.com"
  ├─ config.sync_time = "09:30"
  │
  └─ config.sync()               → QSettings.sync() 写入磁盘
```

## 5. 错误处理

| 场景 | 处理方式 |
|------|----------|
| Git 认证失败 | 捕获 `GitCommandError`，记录错误日志，返回 `False` |
| 远程分支不存在 | 自动检测默认分支；若仍失败则列出可用分支 |
| cherry-pick 冲突 | 执行 `cherry-pick --abort`，跳过该提交，继续处理后续 |
| 密码解密失败 | `_decrypt` 捕获所有异常，返回空字符串 |
| 用户未配置就同步 | 弹出警告对话框，自动打开配置界面 |
| 定时任务注册失败 | 记录错误日志，不影响手动同步 |
| 目标分支被切换 | 自动降级为全量同步，重新创建孤立分支 |

## 6. 安全设计

| 项目 | 方案 |
|------|------|
| 密码存储 | Fernet 对称加密，密钥存储在 QSettings |
| 网络传输 | HTTPS（强制将 http 升级为 https） |
| URL 凭据 | 用户名密码经 `urllib.parse.quote` 编码，防止特殊字符注入 |
| 目标分支隔离 | 使用独立分支，不修改源分支 |
