# Worklog — Compact Injection Upgrade

**Fork**: `DragonBaiMo/vscode-copilot-chat`
**Base upstream**: `microsoft/vscode-copilot-chat` @ `9e668cb12` (Yemohyle/subagent telem #4916)
**Commits**: `014105913`, `085c6a16e`
**日期**: 2026-04-22

---

## 目标

在不重构 `ToolCallingLoop` 主循环、不改全局 prompt 解析行为的前提下，为扩展新增三项互相独立、默认关闭、可单独回滚的能力：

- **A · Compact 提示词分级覆盖**：`.copilot/compact/` 下提供会话 > 工作区 > 用户 > 内置默认的分级覆盖
- **B · Pending-User Gate (Interrupt Gate)**：硬性阻断工具调用、等待用户回答、UserPromptSubmit 自动解除
- **C · 事件触发 Compact**：读取指定触发文件时，与 90% 预算触发并行触发 compact

---

## 新增模块

| 文件 | 说明 |
|------|------|
| `src/extension/compact/common/types.ts` | 三项能力的公共类型与 Service ID |
| `src/extension/compact/common/compactPromptOverrideResolver.ts` | 4 级文件解析 + replace/append 合并 |
| `src/extension/compact/common/pendingUserGateService.ts` | Gate 状态机（idle/armed/waiting/expired）+ 超时 + ack/reset |
| `src/extension/compact/common/eventCompactTriggerService.ts` | 事件匹配 + 冷却防抖 + compact 触发判定 |
| `src/extension/compact/common/test/compactPromptOverrideResolver.spec.ts` | 覆盖解析降级与合并策略 |
| `src/extension/compact/common/test/pendingUserGateService.spec.ts` | 覆盖状态机全路径 |
| `src/extension/compact/common/test/eventCompactTriggerService.spec.ts` | 覆盖 arm/consume/冷却 |

---

## 改动清单

### 平台层 (`src/platform/`)

- **`chat/common/chatHookService.ts`**
  PreCompactHookInput.trigger 扩展：`'auto' | 'manual' | 'event'`；新增 `eventSource?` 字段用于能力 C 回传触发来源。
- **`configuration/common/configurationService.ts`**
  新增 6 个 `ConfigKey`（各能力 enable + 子参数），全部默认关闭。

### 扩展层 (`src/extension/`)

- **`extension/vscode-node/services.ts`**
  注册 `ICompactPromptOverrideResolver` / `IPendingUserGateService` / `IEventCompactTriggerService` 到 DI 容器。
- **`chat/vscode-node/chatHookService.ts`**
  PreCompact hook 调度点透传 `trigger` + `eventSource`；兼容原 `'auto'` 调用方。
- **`prompts/node/agent/summarizedConversationHistory.tsx`**
  `render()` 拼入 compact 覆盖结果（replace 覆盖 SummaryPrompt 常量 / append 追加 Additional instructions）；不修改原 `SummaryPrompt` 默认内容。
- **`prompts/node/agent/agentPrompt.tsx`**
  补充 compact 触发上下文注入点。
- **`prompts/node/panel/toolCalling.tsx`**
  工具调用前 hook 集成 Pending-User Gate：gate 激活时 `permissionDecision='deny'` 硬阻断；工具调用后事件匹配回灌 `appendHookContext`。
- **`prompt/node/defaultIntentRequestHandler.ts`**
  UserPromptSubmit 路径解除 gate。
- **`intents/node/agentIntent.ts`**
  `handleSummarizeCommand`（手动 `/compact`）与 BudgetExceeded 自动路径统一经过三项服务；事件触发作为与 90% 预算并行的第二触发通道；gate 优先于 compact。
- **`intents/node/askAgentIntent.ts` / `editCodeIntent2.ts` / `notebookEditorIntent.ts` / `testIntent/testIntent.tsx`**
  构造函数注入新服务，保持 intent 间行为一致。

### 配置与打包

- **`package.json`** — 新增 6 个配置项（能力开关 + 触发文件列表 + 超时 + 合并策略）。
- **`package.nls.json`** — 对应 i18n 描述。
- **`.vscode/settings.json`** — 开发时默认值。
- **`.esbuild.ts`** — 修复 ESM 路径（`fileURLToPath(import.meta.url)`）与 `tsx .esbuild.ts` 脚本入口。

### 测试基线

- **`src/extension/test/node/services.ts`**
  新增三项服务的 `Null*` 实现并注册到测试 DI，避免无关测试套件因严格 DI 失败。
- **`src/extension/chatSessions/vscode-node/test/copilotCLISDKUpgrade.spec.ts`**
  移除过时的 `sdk/sharp/node_modules/@img/sharp-wasm32/lib/sharp-wasm32.node.wasm` 期望。

### 规划与调研记录

- `.sisyphus/plans/compact-injection-upgrade-plan.md` — 完整实施规划（4 阶段、约 25 任务）。
- `.sisyphus/explore/auto-model-routing/` — Auto 路由行为调研。
- `.sisyphus/explore/compact-di-registration/` — DI 注册路径调研。

---

## 约束与护栏

- 三项能力默认 `false`；关闭时对应路径不执行，零运行时成本
- 不使用 `as any` / `@ts-ignore` / `@ts-expect-error`
- 不使用全局单例 — 全部 `IInstantiationService` 注入
- 不使用 string 路径 — 全部 `URI` 类型
- 不修改 `SummaryPrompt` 常量默认内容
- 文件不存在 / 解析失败 → 降级回退 + warning
- Gate 超时自动 expired；与 compact 冲突时 gate 优先
- 事件触发带冷却防抖

---

## 本地环境修复（非代码层）

开发过程中解决的 Windows 本地构建问题（不入仓）：

- `sqlite3` 原生编译：通过用户级 MSBuild props `C:\Users\Dragon\AppData\Local\Microsoft\MSBuild\v4.0\Microsoft.Cpp.x64.user.props` 注入 F 盘 Windows SDK / UCRT include / lib 路径
- 依赖恢复：`npm ci --ignore-scripts` + 选择性 rebuild
- Dev host 启动：本机无 `code-insiders`，改用 `D:\ProgramCategories\Microsoft VS Code\Code.exe --extensionDevelopmentPath`

---

## 验证状态

- `start-watch-tasks` 编译通过，`dist/extension.js` 已产出
- 三项服务单元测试通过
- 严格 DI 基线修复后，其他套件无级联失败
- 上游 `upstream/main` @ `9e668cb12` 与本地 base 同步，无冲突
