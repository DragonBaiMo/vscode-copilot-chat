# compact 提示词覆盖 + interrupt gate + 事件触发 compact — 深度实施规划

## TL;DR

> **核心目标**: 为 vscode-copilot-chat 扩展新增三项互相独立、默认关闭的能力：(A) compact 提示词分级覆盖、(B) interrupt gate 打断等待机制、(C) 读取指定文件触发自动 compact。
> **交付物**: 6 个新文件 + 11 个修改文件 + 6 个新配置项 + 完整测试套件
> **预估规模**: Large（4 阶段，约 25 个任务）
> **并行执行**: YES — 阶段 1 内部 3 条能力基建可并行；阶段 2 有串行依赖
> **关键路径**: 阶段 1（基建） → 阶段 2（集成） → 阶段 3（联动） → 阶段 4（验收）

---

## 上下文

### 原始需求

三项独立能力扩展：
1. compact summarization prompt 可被 `.copilot/compact/` 下的分级文件覆盖（会话 > 工作区 > 用户 > 内置默认）
2. interrupt gate：硬性阻断工具调用、等待用户回答、自动恢复
3. 读取指定触发文件自动启动 compact（与 90% 预算触发并行的第二触发通道）

### 代码库关键锚点

| 锚点 | 文件 | 行号 | 说明 |
|------|------|------|------|
| SummaryPrompt 常量 | `src/extension/prompts/node/agent/summarizedConversationHistory.tsx` | L54 | 内置 compact 提示词（JSX 常量） |
| render() 拼入自定义指令 | 同上 | L156 | 读 `this.props.summarizationInstructions` 拼入 "Additional instructions" |
| PreCompact hook 执行 | 同上 | L651 | 当前写死 `trigger: 'auto'` |
| PreCompactHookInput 类型 | `src/platform/chat/common/chatHookService.ts` | L278 | `readonly trigger: 'auto'` |
| 手动 /compact 入口 | `src/extension/intents/node/agentIntent.ts` | L238 | `handleSummarizeCommand` |
| 自动 compact BudgetExceeded | 同上 | L656 | inline/foreground/background 三路 |
| 后台 compact | 同上 | L842 | `_startBackgroundSummarization` |
| 80%/95% 双阈值 | 同上 | L423 | 预渲染 ratio 判定 |
| executePreToolUseHook | `src/extension/chat/vscode-node/chatHookService.ts` | L332 | deny > ask > allow 折叠 |
| 工具调用前 hook 消费 | `src/extension/prompts/node/panel/toolCalling.tsx` | L246 | hookResult 用于 permissionDecision |
| appendHookContext | 同上 | L496 | 工具调用后追加 additionalContext |
| IPreToolUseHookResult | `src/platform/chat/common/chatHookService.ts` | L86 | `permissionDecision?: 'allow' \| 'deny' \| 'ask'` |
| ConfigKey 命名空间 | `src/platform/configuration/common/configurationService.ts` | L568 | 所有设置键定义 |
| IFileSystemService | `src/platform/filesystem/common/fileSystemService.ts` | L11 | 文件读写服务 |
| package.json 配置段 | `package.json` | L3234/L3730/L4014/L4359 | 现有 compact 配置 |

---

## 工作目标

### 核心目标
在不重构 ToolCallingLoop 主循环、不改全局 prompt 解析行为的前提下，新增三项完全独立、默认关闭、可单独回滚的能力。

### 具体交付物
- **能力 A**: `CompactPromptOverrideResolver` 服务 + 4 级文件解析 + replace/append 合并
- **能力 B**: `PendingUserGateService` 状态机服务 + preToolUse hook 集成 + UserPromptSubmit 解除
- **能力 C**: `EventCompactTriggerService` 状态机服务 + read_file 结果匹配 + compact 判定集成
- **跨能力**: PreCompact hook trigger 字段扩展 + compact 时联动注入信息

### 完成定义
- [ ] 三项能力各自独立开关，默认 `false`
- [ ] 关闭任意能力时，对应代码路径完全不执行（零运行时成本）
- [ ] 所有新增类型通过 `npm run typecheck` 零错误
- [ ] 单元测试覆盖率达到新增代码 90%+
- [ ] `start-watch-tasks` watch 输出零编译错误

### 必须包含
- 文件不存在/解析失败时降级回退并记录 warning
- gate 超时后自动 expired → 可再次触发
- compact 触发冷却防抖
- gate 与 compact 冲突时 gate 优先

### 明确排除（护栏）
- 不重构 ToolCallingLoop 主循环
- 不改默认 prompt 体系的全局解析行为（不走 `applyPromptOverrides`）
- 不引入新的跨进程服务或协议层
- 不使用 `as any` / `@ts-ignore` / `@ts-expect-error`
- 不使用全局单例（用 `IInstantiationService` 注入）
- 不使用 string 路径（用 `URI` 类型）
- 不修改已有的 `SummaryPrompt` 常量默认内容

---

## 验证策略

> **零人工干预** — 所有验证由智能体执行。

### 测试决策
- **基础设施存在**: YES（vitest）
- **自动化测试**: 测试后置（每阶段实现完成后立即编写对应测试）
- **框架**: vitest

### 智能体 QA 场景

**场景 1 — compact 提示词覆盖（replace 模式）**
- **前置条件**: 工作区 `.copilot/compact/prompt.md` 存在，内容为 "Custom prompt"
- **执行步骤**: 调用 `CompactPromptOverrideResolver.resolve(sessionId)` → 返回 `{ content: "Custom prompt", mode: "replace", source: "workspace" }`
- **成功指标**: `ConversationHistorySummarizationPrompt.render()` 输出的 SystemMessage 使用自定义内容替换 SummaryPrompt
- **失败指标**: 仍然使用内置 SummaryPrompt
- **证据收集**: 单元测试断言 rendered prompt 内容

**场景 2 — interrupt gate 完整生命周期**
- **前置条件**: 用户创建一条 mode=interrupt 的注入消息
- **执行步骤**: (a) 创建 gate → pending; (b) 模型尝试调用工具 → preToolUse hook → deny; (c) 用户发送回答 → UserPromptSubmit → gate.resolve; (d) 下一次工具调用 → preToolUse → allow
- **成功指标**: gate 状态依次为 pending → asked → resolved；工具调用先 deny 后 allow
- **失败指标**: 工具调用被 deny 后无法恢复
- **证据收集**: 单元测试断言状态迁移 + preToolUse 返回值

**场景 3 — 触发文件自动 compact**
- **前置条件**: `.copilot/compact/trigger.md` 存在；`EventCompactTriggerService` 已启用
- **执行步骤**: (a) AI 调用 read_file 读取 trigger.md → postToolUse hook 匹配 → state=armed; (b) 下一次 buildPrompt compact 判定节点消费 armed → 走 inline compact; (c) compact 完成 → state=cooldown; (d) 冷却期内再次触发 → 忽略
- **成功指标**: compact 执行一次，cooldown 期间不重复触发
- **失败指标**: compact 未触发 / 重复触发
- **证据收集**: 状态机迁移日志 + telemetry 事件

**场景 4 — gate 与 compact 冲突**
- **前置条件**: gate 处于 asked 状态，同时触发文件被读取
- **执行步骤**: EventCompactTriggerService 检测到 gate 活跃 → 延后 compact（state 保持 armed 不消费）
- **成功指标**: compact 不在 gate 活跃时执行
- **失败指标**: compact 与 gate 同时激活
- **证据收集**: 单元测试断言

**场景 5 — 所有能力关闭时的零副作用**
- **前置条件**: 三项配置全为 `false`
- **执行步骤**: 正常对话 + 工具调用 + compact
- **成功指标**: 行为与改动前完全一致，无额外日志、无额外 IO
- **失败指标**: 出现新的文件读取或状态创建
- **证据收集**: 断言服务方法不被调用

---

## 数据流图

### 数据流 1 — compact 提示词覆盖解析链

```
用户触发 /compact 或 BudgetExceeded
        │
        ▼
handleSummarizeCommand()                    (agentIntent.ts:238)
  │ 或 renderWithSummarization()            (agentIntent.ts:656)
        │
        ▼
SummarizedConversationHistoryPropsBuilder.getProps()
        │
        ├── [能力 A 开关 OFF] → props.summarizationInstructions = request.prompt || undefined（原有行为）
        │
        └── [能力 A 开关 ON]
              │
              ▼
        CompactPromptOverrideResolver.resolve(sessionId)    [新服务]
              │
              ├── 尝试读取 会话级文件: workspaceUri/.copilot/compact/session/{sessionId}.md
              │     ├── 成功 → 返回 { content, mode, source: 'session' }
              │     └── 失败/不存在 → 继续
              │
              ├── 尝试读取 工作区级文件: workspaceUri/.copilot/compact/prompt.md
              │     ├── 成功 → 返回 { content, mode, source: 'workspace' }
              │     └── 失败/不存在 → 继续
              │
              ├── 尝试读取 用户级文件: userHomeUri/.copilot/compact/prompt.md
              │     ├── 成功 → 返回 { content, mode, source: 'user' }
              │     └── 失败/不存在 → 继续
              │
              └── 返回 undefined（使用内置 SummaryPrompt）
                    │
                    ▼
    结果传入 props.compactOverride（replace 模式）
    或 拼接到 SummaryPrompt 之后（append 模式）
        │
        ▼
ConversationHistorySummarizationPrompt.render()
        │                                (summarizedConversationHistory.tsx:156)
        ├── [mode=replace + 有 override] → SystemMessage 使用 override 内容替代 SummaryPrompt
        ├── [mode=append + 有 override]  → SystemMessage 先输出 SummaryPrompt，再追加 override
        └── [无 override]                → SystemMessage 使用原始 SummaryPrompt（不变）
```

### 数据流 2 — interrupt gate 完整生命周期

```
注入消息写入（mode=interrupt）
        │
        ▼
PendingUserGateService.createGate(sessionId, injectionMsg)    [新服务]
        │  state: idle → pending
        ▼
模型生成文本（additionalContext 含引导模型提问的指令）
        │
        ▼
模型尝试调用工具（任意工具）
        │
        ▼
executePreToolUseHook()                    (chatHookService.ts:332)
        │
        ├── PendingUserGateService.onToolCallAttempted(sessionId)    [gate 检查]
        │     │
        │     ├── gate 存在 && state ∈ {pending, asked}
        │     │     │
        │     │     ├── state=pending → 迁移到 asked
        │     │     │
        │     │     └── 返回 { deny: true,
        │     │     │           additionalContext: ['请向用户提出你的问题...'] }
        │     │
        │     └── gate 不存在 / state=resolved → 返回 { deny: false }（不干预）
        │
        ▼
hook 结果: deny → 工具调用被阻断
        │
        ▼
模型收到 deny 反馈，停止工具调用，输出文本（向用户提问）
        │  gate state: asked
        ▼
用户在对话框输入回答
        │
        ▼
UserPromptSubmit hook 触发
        │
        ▼
PendingUserGateService.onUserPromptSubmitted(prompt, sessionId)
        │  gate.userAnswer = prompt
        │  state: asked → resolved
        │
        ▼
下一次工具调用
        │
        ▼
PendingUserGateService.onToolCallAttempted(sessionId)
        │  gate state=resolved → 返回 { deny: false, additionalContext: ['用户回答: ...'] }
        │  消费后: 删除 gate（→ idle）
        │
        ▼
工具正常执行
```

### 数据流 3 — 事件触发 compact 完整链路

```
.copilot/compact/trigger.md 存在于工作区
        │
        ▼
AI 调用 read_file 工具，target = .copilot/compact/trigger.md
        │
        ▼
toolCalling.tsx:292 appendHookContext()
        │
        ├── postToolUse hook 执行完成后
        │     │
        │     ▼
        │   EventCompactTriggerService.onPostToolUse(sessionId, toolName='read_file', toolInput)
        │     │
        │     ├── [能力 C 开关 OFF] → 不干预
        │     │
        │     ├── [toolName ≠ 'read_file'] → 不干预
        │     │
        │     ├── [toolInput.filePath 不匹配 trigger 文件路径] → 不干预
        │     │
        │     └── [匹配成功]
        │           │
        │           ├── [当前 state=cooldown] → 忽略，记录 debug 日志
        │           │
        │           └── state: idle → armed
        │
        ▼
下一次 buildPrompt()
        │                                (agentIntent.ts:420 附近，compact 判定区域)
        ▼
AgentIntent.buildPrompt 扩展判定
        │
        ├── [原有 80%/95% 预算判定] → 不变
        │
        ├── [EventCompactTriggerService.tryConsume(sessionId, gateActive)]
        │     │
        │     ├── [PendingUserGate 活跃] → 不消费（返回 false），state 保持 armed
        │     │
        │     └── 消费 armed → state=triggered
        │           │
        │           ├── inlineSummarizationEnabled → renderWithInlineSummarization('event-triggered')
        │           └── else → renderWithSummarization('event-triggered')
        │                 │
        │                 ▼
        │           compact 完成
        │                 │
        │                 ▼
        │           EventCompactTriggerService.onCompactCompleted(sessionId)
        │           state: triggered → cooldown
        │           设置冷却计时器（默认 60s）
        │                 │
        │                 ▼
        │           冷却到期 → state: cooldown → idle
        │
        └── [无触发] → 正常渲染
```

---

## 状态机形式化定义

### 状态机 1 — PendingUserGate

```
States: { idle, pending, asked, resolved, expired }

Events:
  CREATE_GATE(sessionId, injectionMsg)
  TOOL_CALL_ATTEMPTED(sessionId)
  USER_PROMPT_SUBMITTED(prompt, sessionId)
  TIMEOUT(sessionId)
  CONSUMED(sessionId)

Transitions:
  idle     + CREATE_GATE           → pending     [action: 创建 gate 记录]
  pending  + TOOL_CALL_ATTEMPTED   → asked       [guard: gate.sessionId 匹配]
                                                  [action: gate.askedAt = now()]
  pending  + USER_PROMPT_SUBMITTED → resolved    [允许：用户可能在 deny 前主动回答]
                                                  [action: gate.userAnswer = prompt]
  asked    + USER_PROMPT_SUBMITTED → resolved    [action: gate.userAnswer = prompt]
  asked    + TOOL_CALL_ATTEMPTED   → asked       [no-op: 保持 deny]
  asked    + TIMEOUT               → expired     [action: logService.warn]
  expired  + CREATE_GATE           → pending     [action: 重置 gate]
  resolved + CONSUMED              → idle        [action: 删除 gate 记录, 返回 userAnswer]
  resolved + TOOL_CALL_ATTEMPTED   → idle        [shortcut: 消费并清理]

Invalid transitions (no-op + debug log):
  idle     + TOOL_CALL_ATTEMPTED   → idle
  idle     + USER_PROMPT_SUBMITTED → idle
  expired  + TOOL_CALL_ATTEMPTED   → expired     [log: gate expired]
  expired  + USER_PROMPT_SUBMITTED → expired     [log: gate expired, too late]
```

### 状态机 2 — EventCompactTrigger

```
States: { idle, armed, triggered, cooldown }

Events:
  TRIGGER_FILE_READ(sessionId)
  COMPACT_CONSUMED(sessionId, gateActive: boolean)
  COMPACT_COMPLETED(sessionId)
  COOLDOWN_EXPIRED(sessionId)

Transitions:
  idle      + TRIGGER_FILE_READ    → armed       [guard: 能力 C 开关 ON]
  armed     + TRIGGER_FILE_READ    → armed       [no-op: 已 armed]
  armed     + COMPACT_CONSUMED     → triggered   [guard: gateActive === false]
  armed     + COMPACT_CONSUMED     → armed       [guard fail: gateActive === true → 不消费]
  triggered + COMPACT_COMPLETED    → cooldown    [action: 启动冷却计时器]
  cooldown  + COOLDOWN_EXPIRED     → idle
  cooldown  + TRIGGER_FILE_READ    → cooldown    [no-op: 冷却中，记录 debug 日志]
  triggered + TRIGGER_FILE_READ    → triggered   [no-op: compact 进行中]

Invalid transitions (no-op):
  idle      + COMPACT_CONSUMED     → idle
  idle      + COMPACT_COMPLETED    → idle
```

---

## 配置设计

### 新增配置项

| 设置键 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `github.copilot.chat.compactPromptOverride.enabled` | `boolean` | `false` | 开关能力 A：允许 `.copilot/compact/` 下文件覆盖 compact 提示词 |
| `github.copilot.chat.compactPromptOverride.mode` | `string` enum `["replace","append"]` | `"replace"` | 合并策略。replace = 整体替换 SummaryPrompt；append = 追加到 SummaryPrompt 之后 |
| `github.copilot.chat.interruptGate.enabled` | `boolean` | `false` | 开关能力 B：允许 interrupt 注入模式阻断工具调用 |
| `github.copilot.chat.interruptGate.timeoutSeconds` | `number` | `300` | 能力 B gate 超时时间（秒） |
| `github.copilot.chat.eventCompactTrigger.enabled` | `boolean` | `false` | 开关能力 C：允许读取触发文件自动启动 compact |
| `github.copilot.chat.eventCompactTrigger.cooldownSeconds` | `number` | `60` | 能力 C 冷却时间（秒），防止频繁触发 |

### 冲突处理

- `compactPromptOverride.enabled=true` 但文件不存在 → 回退内置默认，记录 warning
- `eventCompactTrigger.enabled=true` 且 `interruptGate.enabled=true` → 允许共存，gate 优先（compact 延后）
- `responsesApiContextManagement.enabled=true` → 能力 A/C 的 compact 覆盖不生效（该场景 compact 由 API 侧管理）
- `compactPromptOverride.mode=replace` 时，`request.prompt`（`/compact` 命令的用户输入）仍然追加到 override 内容之后（作为 `summarizationInstructions`）

### ConfigKey 注册位置

在 `src/platform/configuration/common/configurationService.ts` 的 `ConfigKey.Advanced` 命名空间中新增：

```typescript
export const CompactPromptOverrideEnabled = defineSetting<boolean>('chat.compactPromptOverride.enabled', ConfigType.Simple, false);
export const CompactPromptOverrideMode = defineSetting<'replace' | 'append'>('chat.compactPromptOverride.mode', ConfigType.Simple, 'replace');
export const InterruptGateEnabled = defineSetting<boolean>('chat.interruptGate.enabled', ConfigType.Simple, false);
export const InterruptGateTimeoutSeconds = defineSetting<number>('chat.interruptGate.timeoutSeconds', ConfigType.Simple, 300);
export const EventCompactTriggerEnabled = defineSetting<boolean>('chat.eventCompactTrigger.enabled', ConfigType.Simple, false);
export const EventCompactTriggerCooldownSeconds = defineSetting<number>('chat.eventCompactTrigger.cooldownSeconds', ConfigType.Simple, 60);
```

### package.json 注册位置

在 `package.json` 的 `"advanced"` 配置段（约 L3990 处）追加 6 个设置声明，tags 为 `["advanced", "experimental"]`。

### 补充能力 D（可选）— Auto 外观下的真实模型强制绑定

> 本能力不属于 A/B/C 主链路，可独立实现、独立开关、独立回滚。
> 目标是：用户在 UI 上仍然选择 Auto，但允许通过配置文件填写一个真实模型 ID，在本地优先命中该模型。

#### 设计目标

- UI 保持显示 Auto，不新增新的 picker 项。
- 仅当当前请求模型为 Auto 时生效；手动明确选择其他模型时不干预。
- 仅在服务端当前返回的 `available_models` 中包含目标模型时生效。
- 若配置的模型不可用、拼写错误或当前会话不支持，则自动回退原始 Auto 逻辑。
- 不改服务端 router，不依赖关键词触发，不要求用户点击模型切换按钮。

#### 建议新增配置项

| 设置键 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `github.copilot.chat.autoForceModel` | `string` | `""` | 当当前模型为 Auto 时，优先尝试绑定到该真实模型 ID；空字符串表示关闭 |

#### 配置文件填写方式

用户可直接在 VS Code `settings.json` 中填写：

```json
{
  "github.copilot.chat.autoForceModel": "gpt-4o-mini"
}
```

也可以填写其他服务端实际下发过的模型 ID，例如：

```json
{
  "github.copilot.chat.autoForceModel": "claude-sonnet-4"
}
```

#### 接入点

- 首选接入点：`src/platform/endpoint/node/automodeService.ts`
- 具体位置：`resolveAutoModeEndpoint(chatRequest, knownEndpoints)` 在 router/fallback 之前读取配置
- 判定顺序建议如下：
  1. 当前请求是否为 Auto 路径
  2. `autoForceModel` 是否非空
  3. 目标模型是否同时存在于 `token.available_models` 与 `knownEndpoints`
  4. 若存在，则直接选中该 endpoint，并继续包装成 `AutoChatEndpoint`
  5. 若不存在，则记录 debug/warn 并回退原始 Auto 逻辑

#### 运行时语义

- 对用户而言：模型选择器仍显示 Auto。
- 对请求链路而言：真实发出的模型是配置命中的那个 endpoint。
- 对 telemetry 而言：会被解析为真实模型，而不是 `copilot/auto`。

#### 边界与限制

- 该能力只能在服务端当前允许的 `available_models` 集合内“优先固定”某个模型，不能绕过服务端可用性约束。
- 若服务端本轮未返回该模型，本地不能强行调用它。
- 若未来服务端调整模型 ID，本地配置需要同步更新。

#### 验证场景

- `autoForceModel` 为空 → 行为与当前 Auto 完全一致。
- `autoForceModel` 命中可用模型 → UI 仍显示 Auto，但请求实际落到指定模型。
- `autoForceModel` 指向不可用模型 → 记录 warning，并回退到原始 Auto router/fallback。
- 手动选择非 Auto 模型 → `autoForceModel` 不生效。

#### 实施建议

- 若后续确认纳入本计划，建议作为“能力 D（可选）”追加到阶段 1 的配置注册、阶段 2 的 `AutomodeService` 集成和阶段 4 的回归测试中。
- 若只需本地自用，也可以先以最小补丁方式实现：仅新增一个配置项 + `AutomodeService` 中的优先分支，不改 UI、不改协议。

---

## 分阶段实施计划

---

### 阶段 1：基建 — 三项能力的核心服务与类型定义

**目标**: 创建三个独立服务的核心实现 + 类型定义 + 配置注册，不接入任何现有链路。

#### 改动文件清单

| 文件路径 | 操作 | 说明 |
|----------|------|------|
| `src/platform/chat/common/chatHookService.ts` | 修改 | PreCompactHookInput.trigger 扩展为 `'auto' \| 'manual' \| 'event'` |
| `src/platform/configuration/common/configurationService.ts` | 修改 | 新增 6 个 ConfigKey |
| `package.json` | 修改 | 新增 6 个设置声明 |
| `package.nls.json` | 修改 | 新增 6 个设置说明文案的本地化键 |
| `src/extension/compact/common/compactPromptOverrideResolver.ts` | **新增** | 能力 A 核心服务 |
| `src/extension/compact/common/pendingUserGateService.ts` | **新增** | 能力 B 核心服务 |
| `src/extension/compact/common/eventCompactTriggerService.ts` | **新增** | 能力 C 核心服务 |
| `src/extension/compact/common/types.ts` | **新增** | 三项能力共享的类型定义 |

#### 关键任务

##### T-1.1: 类型定义（新建 `types.ts`）
- **目标**: 定义三项能力的共享类型 + 服务标识符
- **文件**: `src/extension/compact/common/types.ts`
- **方法**:
  - 定义 `CompactOverrideResult`:
    ```typescript
    interface CompactOverrideResult {
      readonly content: string;
      readonly mode: 'replace' | 'append';
      readonly source: 'session' | 'workspace' | 'user';
    }
    ```
  - 定义 `PendingUserGateState`: `'idle' | 'pending' | 'asked' | 'resolved' | 'expired'`
  - 定义 `PendingUserGate`:
    ```typescript
    interface PendingUserGate {
      readonly sessionId: string;
      state: PendingUserGateState;
      readonly injectionMsg: string;
      userAnswer?: string;
      readonly createdAt: number;
      askedAt?: number;
    }
    ```
  - 定义 `EventCompactTriggerState`: `'idle' | 'armed' | 'triggered' | 'cooldown'`
  - 定义 `GateToolCallResult`:
    ```typescript
    interface GateToolCallResult {
      readonly deny: boolean;
      readonly additionalContext?: string[];
    }
    ```
  - 定义 `ICompactPromptOverrideResolver` 服务接口 + `createServiceIdentifier`
  - 定义 `IPendingUserGateService` 服务接口 + `createServiceIdentifier`
  - 定义 `IEventCompactTriggerService` 服务接口 + `createServiceIdentifier`
- **验证**: `npm run typecheck` 通过
- **完成标准**: 类型文件无 TS 错误，所有接口和类型可被 import

##### T-1.2: PreCompactHookInput.trigger 扩展
- **目标**: 将 trigger 字段从 `'auto'` 扩展为 `'auto' | 'manual' | 'event'`
- **文件**: `src/platform/chat/common/chatHookService.ts`
- **方法**:
  - 找到 L278 处 `readonly trigger: 'auto'`
  - 改为 `readonly trigger: 'auto' | 'manual' | 'event'`
  - 注释说明：`"auto" = 预算触发; "manual" = /compact 命令; "event" = 触发文件读取`
- **风险**: 下游消费方可能做等值判断 — 需 grep 所有 `PreCompactHookInput` / `.trigger` 引用确认
  - 已确认：当前仅 `summarizedConversationHistory.tsx:651` 处构造 `{ trigger: 'auto' }` → 联合类型扩展向后兼容
- **验证**: `npm run typecheck` 通过
- **完成标准**: typecheck 通过，grep 所有引用无类型错误

##### T-1.3: ConfigKey 注册
- **目标**: 在 ConfigKey 命名空间注册 6 个新设置键
- **文件**: `src/platform/configuration/common/configurationService.ts`
- **方法**:
  - 在 `ConfigKey.Advanced` 命名空间末尾（约 L700 之前的 `}` 前），新增 6 个 `defineSetting` 调用
  - 严格遵循已有命名风格（`defineSetting<Type>('chat.xxx.yyy', ConfigType.Simple, defaultValue)`）
- **验证**: `configurationService.getConfig(ConfigKey.Advanced.CompactPromptOverrideEnabled)` 返回 false
- **完成标准**: 6 个键可访问且默认值正确

##### T-1.4: package.json 配置声明
- **目标**: 在 VS Code 设置 UI 中暴露 6 个配置项
- **文件**: `package.json`, `package.nls.json`
- **方法**:
  - 在 `package.json` 的 `"advanced"` 配置段（约 L3990）中，在 `github.copilot.chat.debug.promptOverrideFile` 之前，插入 6 个 JSON 对象
  - 每个配置的结构参照已有的 `backgroundCompaction`：
    ```json
    "github.copilot.chat.compactPromptOverride.enabled": {
      "type": "boolean",
      "default": false,
      "tags": ["advanced", "experimental"],
      "markdownDescription": "%github.copilot.config.compactPromptOverride.enabled%"
    }
    ```
  - 在 `package.nls.json` 中添加对应的 6 个本地化键（英文描述即可，格式参照已有条目）
- **验证**: JSON 语法校验通过
- **完成标准**: VS Code 设置搜索可找到这 6 个配置

##### T-1.5: CompactPromptOverrideResolver 服务
- **目标**: 实现能力 A 的文件读取与分级解析
- **文件**: `src/extension/compact/common/compactPromptOverrideResolver.ts`
- **方法**:
  - 类声明: `class CompactPromptOverrideResolver implements ICompactPromptOverrideResolver`
  - 依赖注入（构造函数参数）:
    - `@IFileSystemService private readonly _fileSystemService: IFileSystemService`
    - `@IConfigurationService private readonly _configurationService: IConfigurationService`
    - `@IWorkspaceService private readonly _workspaceService: IWorkspaceService`
    - `@ILogService private readonly _logService: ILogService`
  - `resolve(sessionId: string): Promise<CompactOverrideResult | undefined>` 方法逻辑：
    1. `if (!this._configurationService.getConfig(ConfigKey.Advanced.CompactPromptOverrideEnabled)) return undefined;`
    2. `const mode = this._configurationService.getConfig(ConfigKey.Advanced.CompactPromptOverrideMode);`
    3. 获取 workspaceUri: `this._workspaceService.getWorkspaceFolders()`，取第一个
    4. 构造 URI 数组（按优先级）:
       - `URI.joinPath(workspaceUri, '.copilot', 'compact', 'session', `${sessionId}.md`)`
       - `URI.joinPath(workspaceUri, '.copilot', 'compact', 'prompt.md')`
       - `URI.joinPath(userHomeUri, '.copilot', 'compact', 'prompt.md')`
    5. 遍历 URI，对每个执行 try-catch 包裹的 `this._fileSystemService.readFile(uri)`
    6. 读取成功: `TextDecoder` 解码为 string
    7. size guard: `if (text.length > 102400) { text = text.slice(0, 102400); this._logService.warn(...); }`
    8. `return { content: text, mode, source }`
    9. `FileNotFound` 错误 → `continue`（静默降级）
    10. 其他错误 → `this._logService.warn(...)` + `continue`
    11. 遍历结束仍无结果 → `return undefined`
  - userHomeUri 获取: 使用 `URI.file(process.env.USERPROFILE || process.env.HOME || '')`（Windows/Linux 兼容）
    - **注意**: 应通过 `IEnvService` 或等效机制获取 home 目录，避免直接 `process.env`
- **验证**: 创建 mock FileSystemService，测试各降级路径
- **完成标准**: 单独可实例化，入参 sessionId 返回正确结果

##### T-1.6: PendingUserGateService 服务
- **目标**: 实现能力 B 的状态机
- **文件**: `src/extension/compact/common/pendingUserGateService.ts`
- **方法**:
  - 类声明: `class PendingUserGateService extends Disposable implements IPendingUserGateService`
  - 依赖注入:
    - `@IConfigurationService private readonly _configurationService: IConfigurationService`
    - `@ILogService private readonly _logService: ILogService`
  - 内部状态: `private readonly _gates = new Map<string, PendingUserGate>();`
  - 方法实现:
    - `createGate(sessionId: string, injectionMsg: string): void`
      - 检查 `ConfigKey.Advanced.InterruptGateEnabled`，false 则 return
      - `this._gates.set(sessionId, { sessionId, state: 'pending', injectionMsg, createdAt: Date.now() })`
    - `getGate(sessionId: string): PendingUserGate | undefined`
      - `return this._gates.get(sessionId)`
    - `isActive(sessionId: string): boolean`
      - `const gate = this._gates.get(sessionId); return gate?.state === 'pending' || gate?.state === 'asked';`
    - `onToolCallAttempted(sessionId: string): GateToolCallResult`
      - 按状态机定义实现（见伪代码 2）
    - `onUserPromptSubmitted(sessionId: string, prompt: string): void`
      - 获取 gate，如果 state 为 pending 或 asked → 设 userAnswer + 状态改 resolved
    - 超时检查: `setInterval` 每 30s 遍历，计算 `Date.now() - gate.askedAt` 是否超过配置的超时秒数
      - 超时 → `gate.state = 'expired'`
      - 通过 `Disposable` 在 dispose 时清理 interval
- **验证**: 单元测试覆盖全部状态迁移路径
- **完成标准**: 状态机迁移正确，所有边界条件覆盖

##### T-1.7: EventCompactTriggerService 服务
- **目标**: 实现能力 C 的状态机
- **文件**: `src/extension/compact/common/eventCompactTriggerService.ts`
- **方法**:
  - 类声明: `class EventCompactTriggerService extends Disposable implements IEventCompactTriggerService`
  - 依赖注入:
    - `@IConfigurationService private readonly _configurationService: IConfigurationService`
    - `@ILogService private readonly _logService: ILogService`
    - `@IWorkspaceService private readonly _workspaceService: IWorkspaceService`
  - 内部状态: `private readonly _states = new Map<string, EventCompactTriggerState>();`
  - 冷却计时器: `private readonly _cooldownTimers = new Map<string, ReturnType<typeof setTimeout>>();`
  - 方法实现:
    - `onPostToolUse(sessionId: string | undefined, toolName: string, toolInput: unknown): void`
      - `if (!sessionId) return;`
      - `if (!this._configurationService.getConfig(ConfigKey.Advanced.EventCompactTriggerEnabled)) return;`
      - `if (toolName !== 'read_file') return;`（read_file 是标准工具名，参照 `ToolName` 枚举）
      - 从 `toolInput` 中提取文件路径（`(toolInput as { filePath?: string })?.filePath`）
      - 与工作区的 `.copilot/compact/trigger.md` URI 做比较（使用 URI.isEqual 或路径后缀匹配）
      - 当前 state: idle → armed; cooldown → 忽略（log debug）; armed → 忽略
    - `tryConsume(sessionId: string, gateActive: boolean): boolean`
      - `const state = this._states.get(sessionId); if (state !== 'armed') return false;`
      - `if (gateActive) { this._logService.debug('...gate active, deferring...'); return false; }`
      - `this._states.set(sessionId, 'triggered'); return true;`
    - `onCompactCompleted(sessionId: string): void`
      - `this._states.set(sessionId, 'cooldown');`
      - 启动冷却计时器:
        ```typescript
        const cooldownMs = this._configurationService.getConfig(ConfigKey.Advanced.EventCompactTriggerCooldownSeconds) * 1000;
        const timer = setTimeout(() => { this._states.set(sessionId, 'idle'); this._cooldownTimers.delete(sessionId); }, cooldownMs);
        this._cooldownTimers.set(sessionId, timer);
        ```
    - `dispose()`: 清理所有 cooldown timers
- **验证**: 单元测试覆盖全部状态迁移
- **完成标准**: 状态机迁移正确

#### 顺序依赖

```
第一波（可并行）: T-1.1, T-1.2, T-1.3, T-1.4
第二波（可并行，依赖第一波的 T-1.1 + T-1.3）: T-1.5, T-1.6, T-1.7
```

#### 风险与回滚
- **风险**: PreCompactHookInput.trigger 更改可能影响已有 hook 脚本中的 `trigger === 'auto'` 判断
  - **缓解**: 这是联合类型新增成员，已有 `'auto'` 值不变；用户脚本做 `===` 判断仍然正确
- **回滚**: 删除新增文件 + 还原 4 个修改文件的 diff 即可

#### 验收标准
- [ ] `npm run typecheck` 零错误
- [ ] 新增 4 个文件可被 import 且 `createServiceIdentifier` 正确
- [ ] 6 个 ConfigKey 可通过 `configurationService.getConfig()` 读取
- [ ] 6 个 package.json 设置声明 JSON 校验通过

---

### 阶段 2：集成 — 将三项服务接入现有链路

**目标**: 将阶段 1 的独立服务分别接入 compact 链路、preToolUse hook 链路、postToolUse hook 链路。

#### 改动文件清单

| 文件路径 | 操作 | 说明 |
|----------|------|------|
| `src/extension/prompts/node/agent/summarizedConversationHistory.tsx` | 修改 | 能力 A 集成：render() 支持 replace/append 模式 |
| `src/extension/intents/node/agentIntent.ts` | 修改 | 能力 A + C 集成：handleSummarizeCommand + buildPrompt compact 判定 |
| `src/extension/chat/vscode-node/chatHookService.ts` | 修改 | 能力 B 集成：preToolUse 注入 gate deny 逻辑 |
| `src/extension/prompts/node/panel/toolCalling.tsx` | 修改 | 能力 C 集成：postToolUse 触发文件检测 |
| `src/extension/compact/node/compactIntegration.ts` | **新增** | 三项能力的服务注册与 contribution 入口 |

#### 关键任务

##### T-2.1: 服务注册（新建 `compactIntegration.ts`）
- **目标**: 将三个服务注册到 IInstantiationService，使其可通过 DI 获取
- **文件**: `src/extension/compact/node/compactIntegration.ts`
- **方法**:
  - 导出 `registerCompactServices(serviceCollection: ServiceCollection)` 函数
  - 内部执行:
    ```typescript
    serviceCollection.set(ICompactPromptOverrideResolver, CompactPromptOverrideResolver);
    serviceCollection.set(IPendingUserGateService, PendingUserGateService);
    serviceCollection.set(IEventCompactTriggerService, EventCompactTriggerService);
    ```
  - 在 extension 的 contribution 注册处（需定位 extension 激活入口文件，通常在 `src/extension/extension/` 下）引入并调用此函数
  - **定位方法**: grep `serviceCollection.set` 或 `registerSingleton` 找到已有服务注册的集中位置
- **验证**: 三个服务可通过 `instantiationService.createInstance()` 或 `@IXxxService` 获取
- **完成标准**: DI 注入可用

##### T-2.2: 能力 A 集成 — render() 支持 replace/append
- **目标**: 让 `ConversationHistorySummarizationPrompt.render()` 根据 override 结果决定是替换还是追加 SummaryPrompt
- **文件**: `src/extension/prompts/node/agent/summarizedConversationHistory.tsx`
- **方法**:
  - **步骤 1**: 在 `SummarizedAgentHistoryProps` 接口（或 `ConversationHistorySummarizationPromptProps`）中新增可选字段：
    ```typescript
    readonly compactOverride?: { readonly content: string; readonly mode: 'replace' | 'append' };
    ```
  - **步骤 2**: 在 `ConversationHistorySummarizationPrompt.render()` 方法中（L160 左右），修改 SystemMessage 内部的 JSX 构建：
    - 原始代码:
      ```tsx
      <SystemMessage priority={this.props.priority}>
        {SummaryPrompt}
        {this.props.summarizationInstructions && <>...</>}
      </SystemMessage>
      ```
    - 修改为:
      ```tsx
      <SystemMessage priority={this.props.priority}>
        {this.props.compactOverride?.mode === 'replace'
          ? <Raw>{this.props.compactOverride.content}</Raw>
          : <>
              {SummaryPrompt}
              {this.props.compactOverride?.content && <>
                <br /><br />
                ## Custom compact instructions:<br />
                <Raw>{this.props.compactOverride.content}</Raw>
              </>}
            </>
        }
        {this.props.summarizationInstructions && <>
          <br /><br />
          ## Additional instructions from the user:<br />
          {this.props.summarizationInstructions}
        </>}
      </SystemMessage>
      ```
  - **注意**: 使用 `<Raw>` 包裹 override 内容，避免 JSX 转义问题。确认 `Raw` 已从 `@vscode/prompt-tsx` 导入（L8 已有）
- **验证**: 给 `compactOverride` 不同值时 render 输出符合预期
- **完成标准**: replace 模式替换 SummaryPrompt，append 模式追加

##### T-2.3: 能力 A 集成 — handleSummarizeCommand 调用 resolver
- **目标**: 手动 `/compact` 时调用 `CompactPromptOverrideResolver.resolve()` 并传入 props
- **文件**: `src/extension/intents/node/agentIntent.ts`
- **方法**:
  - **步骤 1**: 在文件头部添加 import:
    ```typescript
    import { ICompactPromptOverrideResolver } from '../../compact/common/types';
    ```
  - **步骤 2**: 在 `handleSummarizeCommand()` 函数体内（L285 左右，`propsBuilder.getProps()` 调用之后），插入：
    ```typescript
    const compactOverride = await this._compactPromptOverrideResolver.resolve(conversation.sessionId);
    ```
  - **步骤 3**: 将 `compactOverride` 传入 renderer 的 props（L296 左右）：
    ```typescript
    // 原:
    summarizationInstructions: request.prompt || undefined,
    // 新:
    summarizationInstructions: request.prompt || undefined,
    compactOverride: compactOverride ? { content: compactOverride.content, mode: compactOverride.mode } : undefined,
    ```
  - **步骤 4**: AgentIntent 类构造函数需新增 `@ICompactPromptOverrideResolver` 依赖
  - **步骤 5**: 如果 AgentIntent 使用工厂模式创建，确保工厂函数也传递该服务
- **验证**: `/compact` 命令执行时 resolver 被调用
- **完成标准**: override 传入渲染器

##### T-2.4: 能力 A 集成 — 自动 compact 路径
- **目标**: 自动 compact（BudgetExceeded、后台、inline）也调用 resolver
- **文件**: `src/extension/intents/node/agentIntent.ts`
- **方法**:
  - 在 `buildPrompt()` 方法中，定义一个局部辅助函数（或提前获取 override）:
    ```typescript
    const getCompactOverride = async () => this._compactPromptOverrideResolver.resolve(promptContext.conversation?.sessionId ?? '');
    ```
  - 在 `renderWithSummarization()` 辅助函数内（L635 左右），在创建 renderer 之前：
    ```typescript
    const override = await getCompactOverride();
    ```
    并将 `override` 传入 renderer props（与 T-2.3 相同模式）
  - 在 `renderWithInlineSummarization()` 辅助函数内同理
  - 在 `_startBackgroundSummarization()` 函数内（L860 左右），在 `bgRenderer` 创建时将 override 传入 props
    - **注意**: 后台 compact 在独立线程中运行，需在创建 bgRenderer 前 await resolve，不可延迟
- **验证**: 自动 compact 的三条路径（foreground / inline / background）都能携带 override
- **完成标准**: 全部 compact 路径统一

##### T-2.5: 能力 B 集成 — preToolUse gate deny
- **目标**: 在 preToolUse hook 执行链中注入 PendingUserGateService 的检查
- **文件**: `src/extension/chat/vscode-node/chatHookService.ts`
- **方法**:
  - **步骤 1**: 构造函数新增依赖:
    ```typescript
    @IPendingUserGateService private readonly _pendingUserGateService: IPendingUserGateService,
    ```
  - **步骤 2**: 在 `executePreToolUseHook()` 函数体内（L332），在 `const results = await this.executeHook(...)` 调用 **之前**，插入 gate 检查逻辑：
    ```typescript
    // interrupt gate 硬约束（最高优先级，跳过所有 hook 执行）
    if (sessionId && this._pendingUserGateService.isActive(sessionId)) {
      const gateResult = this._pendingUserGateService.onToolCallAttempted(sessionId);
      if (gateResult.deny) {
        return {
          permissionDecision: 'deny',
          permissionDecisionReason: 'Interrupt gate: waiting for user response',
          additionalContext: gateResult.additionalContext,
        };
      }
    }
    ```
  - **步骤 3**: 对于 gate 刚 resolved 的情况（gateResult.deny === false 但有 additionalContext），收集到一个 `earlyAdditionalContext` 变量，在后续 hook 结果折叠时合入 `allAdditionalContext`
  - **关键约束**: gate 不活跃时的检查路径是 `Map.get(sessionId)` → undefined → `isActive` 返回 false → 不执行任何额外逻辑。零成本。
- **验证**: gate 活跃时工具调用被 deny；gate 不活跃时行为不变
- **完成标准**: deny + additionalContext 正确返回

##### T-2.6: 能力 B 集成 — UserPromptSubmit 解除 gate
- **目标**: 用户提交下一条消息时自动解除 gate
- **文件**: `src/extension/chat/vscode-node/chatHookService.ts`（或消息提交处理入口）
- **方法**:
  - **首先定位**: grep `UserPromptSubmit` 找到 hook 执行入口
    - 已知 `UserPromptSubmitHookInput` 定义在 `chatHookService.ts:103`
    - 实际执行位置需 grep `'UserPromptSubmit'` 字符串找到 `executeHook('UserPromptSubmit', ...)` 调用点
  - **在该调用点之前**（确保 gate 解除优先于 hook 脚本执行），插入：
    ```typescript
    if (sessionId) {
      this._pendingUserGateService.onUserPromptSubmitted(sessionId, input.prompt);
    }
    ```
  - **备选方案**: 如果 UserPromptSubmit 的执行分散在多处，可以在 `PendingUserGateService` 中自己监听一个事件（但优先选择最简单的单点注入）
- **验证**: 用户发消息后 gate 变为 resolved
- **完成标准**: gate 自动解除，下一次工具调用恢复

##### T-2.7: 能力 C 集成 — postToolUse 触发文件检测
- **目标**: 在 postToolUse 后检测是否读取了触发文件
- **文件**: `src/extension/prompts/node/panel/toolCalling.tsx`
- **方法**:
  - **步骤 1**: 在文件头部添加 import:
    ```typescript
    import { IEventCompactTriggerService } from '../../../compact/common/types';
    ```
  - **步骤 2**: `appendHookContext()` 函数签名新增参数:
    ```typescript
    async function appendHookContext(
      ..., // 原有参数
      eventCompactTriggerService: IEventCompactTriggerService,
    ): Promise<void> {
    ```
  - **步骤 3**: 在 `appendHookContext()` 函数末尾（L540 后，所有现有 hook context 追加完成后），插入：
    ```typescript
    // 事件触发 compact 检测
    if (promptContext.conversation?.sessionId) {
      eventCompactTriggerService.onPostToolUse(
        promptContext.conversation.sessionId,
        props.toolCall.name,
        inputObj,
      );
    }
    ```
  - **步骤 4**: 调用处（L292 `appendHookContext(...)` 调用）相应传入 `eventCompactTriggerService` 参数
    - 需确定 toolCalling.tsx 的 `ChatToolCalls` 组件如何获取该服务 — 通过 props 或通过 `useContext` / `instantiationService` 获取
    - 推荐: 在 `ChatToolCalls` 组件的 render 调用链中，通过 `this.instantiationService.invokeFunction()` 获取服务实例
- **验证**: 读取触发文件后 EventCompactTriggerService.state 变为 armed
- **完成标准**: 检测逻辑正确触发

##### T-2.8: 能力 C 集成 — buildPrompt compact 判定
- **目标**: 在 buildPrompt 的 compact 判定区域消费 armed 状态
- **文件**: `src/extension/intents/node/agentIntent.ts`
- **方法**:
  - **步骤 1**: AgentIntent 类构造函数新增依赖:
    ```typescript
    @IEventCompactTriggerService private readonly _eventCompactTriggerService: IEventCompactTriggerService,
    @IPendingUserGateService private readonly _pendingUserGateService: IPendingUserGateService,
    ```
  - **步骤 2**: 在 `buildPrompt()` 方法中，后台 compact 双阈值判定之后（L480 左右）、proactive inline summarization 判定之前，插入事件触发检查:
    ```typescript
    // 事件触发 compact（第二触发通道，与预算触发并行）
    let eventTriggeredCompact = false;
    if (sessionId && this._eventCompactTriggerService.tryConsume(
      sessionId,
      this._pendingUserGateService.isActive(sessionId),
    )) {
      eventTriggeredCompact = true;
    }
    ```
  - **步骤 3**: 在 `try` 块的正常渲染完成后（`result = await renderer.render(progress, token)` 之后），检查 `eventTriggeredCompact`:
    ```typescript
    if (eventTriggeredCompact && !summaryAppliedThisIteration) {
      const override = await getCompactOverride();
      if (inlineSummarizationEnabled) {
        result = await renderWithInlineSummarization('event-triggered compact', {
          ...props,
          compactOverride: override ? { content: override.content, mode: override.mode } : undefined,
          compactTrigger: 'event',
        });
      } else {
        result = await renderWithSummarization('event-triggered compact', {
          ...props,
          compactOverride: override ? { content: override.content, mode: override.mode } : undefined,
          compactTrigger: 'event',
        });
      }
      this._eventCompactTriggerService.onCompactCompleted(sessionId!);
    }
    ```
  - **注意**: 需确保事件触发 compact 不与同一轮的预算触发 compact 重复执行。通过 `summaryAppliedThisIteration` flag 防护。
- **验证**: armed 状态被消费时触发 compact，cooldown 期间不重复
- **完成标准**: 事件触发 compact 正常工作

#### 顺序依赖

```
T-2.1（服务注册）── 最先执行

能力 A 链路（串行）: T-2.2 → T-2.3 → T-2.4
能力 B 链路（串行）: T-2.5 → T-2.6
能力 C 链路（串行）: T-2.7 → T-2.8

三条能力链路之间可并行
例外: T-2.8 依赖 T-2.5（需要 PendingUserGateService 已集成来判断 gate 是否活跃）
```

#### 风险与回滚
- **风险**: `chatHookService.ts` 修改影响所有工具调用
  - **缓解**: gate 不活跃时是 O(1) Map.get → undefined → 立即返回，无 IO 无 await
- **风险**: `appendHookContext` 签名变更影响调用点
  - **缓解**: 只有一个调用点（L292），且可以通过可选参数/默认值保持兼容
- **风险**: AgentIntent 构造函数参数增多导致实例化处破坏
  - **缓解**: grep 所有 `new AgentIntent` / `createInstance(AgentIntent` 调用，确保更新
- **回滚**: 还原修改文件 diff + 删除新增文件 + 移除服务注册

#### 验收标准
- [ ] `start-watch-tasks` 零编译错误
- [ ] 手动 `/compact` 执行时 resolver 被调用（可通过日志确认）
- [ ] gate 活跃时工具调用被 deny（通过 logService 日志确认）
- [ ] 读取触发文件后 state 变为 armed（通过 logService 日志确认）

---

### 阶段 3：联动 — compact 联动注入信息 + PreCompact hook trigger 贯通

**目标**: 手动和自动 compact 都携带当前未消费注入信息；PreCompact hook 的 trigger 字段在所有路径上正确标记。

#### 改动文件清单

| 文件路径 | 操作 | 说明 |
|----------|------|------|
| `src/extension/prompts/node/agent/summarizedConversationHistory.tsx` | 修改 | PreCompact hook trigger 值贯通 + compactTrigger 新 prop |
| `src/extension/intents/node/agentIntent.ts` | 修改 | compact 时携带注入信息 + trigger 值传递 |
| `src/extension/compact/common/types.ts` | 修改 | 新增 CompactTriggerSource 类型别名 |

#### 关键任务

##### T-3.1: PreCompact hook trigger 贯通
- **目标**: 所有 compact 路径的 PreCompact hook 调用传递正确的 trigger 值
- **文件**: `src/extension/prompts/node/agent/summarizedConversationHistory.tsx`
- **方法**:
  - **步骤 1**: 在 `SummarizedAgentHistoryProps` 接口中新增:
    ```typescript
    readonly compactTrigger?: 'auto' | 'manual' | 'event';
    ```
  - **步骤 2**: 在 `executePreCompactHook()` 中（L651 左右），修改写死的 `trigger: 'auto'`:
    ```typescript
    // 原:
    trigger: 'auto',
    // 新:
    trigger: this.props.compactTrigger ?? 'auto',
    ```
  - **步骤 3**: 在所有调用 renderer 的位置传入 `compactTrigger`:
    - `handleSummarizeCommand` → `compactTrigger: 'manual'`
    - `renderWithSummarization`（BudgetExceeded 触发） → `compactTrigger: 'auto'`
    - `renderWithInlineSummarization`（BudgetExceeded 触发） → `compactTrigger: 'auto'`
    - `_startBackgroundSummarization` → `compactTrigger: 'auto'`
    - 事件触发 compact → `compactTrigger: 'event'`（已在 T-2.8 中传入）
- **验证**: 在 PreCompact hook 脚本中打印 `input.trigger`，分别触发三种 compact 方式确认值
- **完成标准**: 三种触发来源各自传递正确的 trigger 值

##### T-3.2: compact 时联动注入信息
- **目标**: compact 执行时将当前未消费的注入信息作为 additionalContext 传入 summarization prompt
- **文件**: `src/extension/intents/node/agentIntent.ts`
- **方法**:
  - **分析当前注入信息来源**: 注入信息通过 hook 系统的 `additionalContext` 机制传递。在 compact 时，需要收集当前会话中通过 SessionStart / SubagentStart / UserPromptSubmit hook 累积的 additionalContext
  - **实现方式**: 在 `renderWithSummarization()` 和 `renderWithInlineSummarization()` 辅助函数中，调用 renderer 之前:
    1. 收集当前会话的未消费注入信息（具体收集机制取决于注入信息的存储方式 — 需 grep `additionalContext` 在 agentIntent 上下文中的累积方式）
    2. 如果有注入信息，将其拼接到 `summarizationInstructions` 中:
      ```typescript
      let summarizationInstructions = props.summarizationInstructions ?? '';
      if (pendingInjections.length > 0) {
        summarizationInstructions += '\n\n## Pending injected context (not yet consumed by the agent):\n' +
          pendingInjections.join('\n---\n');
      }
      ```
    3. 对注入信息做 size guard: >4KB 截断
  - 在 `handleSummarizeCommand` 中同理:
    - 在 `request.prompt` 之后追加注入信息
  - **关键**: 需定位注入信息的具体存储位置。候选：
    - `promptContext` 中的某个字段
    - hook 系统的累积 context
    - 需通过 grep `additionalContext` 在 `agentIntent.ts` 和 `agentPrompt.tsx` 中的使用确认
- **验证**: 执行 compact 后，summary 输出包含未消费注入信息
- **完成标准**: compact summary 中可见注入内容

#### 顺序依赖
- T-3.1 和 T-3.2 可并行

#### 风险与回滚
- **风险**: 注入信息过大导致 compact prompt 超限
  - **缓解**: 4KB 截断 guard
- **风险**: 注入信息收集机制不明确
  - **缓解**: T-3.2 实施前先做代码考古（grep `additionalContext` 累积路径），确认机制后再编码
- **回滚**: 还原涉及文件的 diff

#### 验收标准
- [ ] PreCompact hook 脚本收到的 trigger 值与触发来源一致
- [ ] compact summary 中包含未消费注入信息（通过日志/测试确认）
- [ ] `npm run typecheck` 零错误

---

### 阶段 4：测试与验收 — 全量测试 + 回归验证

**目标**: 编写完整测试套件，覆盖所有场景；回归验证现有行为不受影响。

#### 改动文件清单

| 文件路径 | 操作 | 说明 |
|----------|------|------|
| `src/extension/compact/test/compactPromptOverrideResolver.spec.ts` | **新增** | 能力 A 单元测试 |
| `src/extension/compact/test/pendingUserGateService.spec.ts` | **新增** | 能力 B 单元测试 |
| `src/extension/compact/test/eventCompactTriggerService.spec.ts` | **新增** | 能力 C 单元测试 |
| `src/extension/compact/test/integration.spec.ts` | **新增** | 集成测试 |

#### 关键测试用例

##### 能力 A — CompactPromptOverrideResolver

| # | 测试名称 | 输入 | 预期输出 | 场景 |
|---|----------|------|----------|------|
| 1 | 开关关闭时返回 undefined | config=false | undefined | 零副作用 |
| 2 | 会话级文件优先 | 会话+工作区文件都存在 | source='session' | 优先级 |
| 3 | 工作区级降级 | 会话级不存在，工作区存在 | source='workspace' | 降级链 |
| 4 | 用户级降级 | 会话+工作区不存在，用户级存在 | source='user' | 降级链 |
| 5 | 全部不存在 | 无文件 | undefined | 兜底 |
| 6 | 文件过大截断 | >100KB 文件 | content 被截断 + warn | 安全边界 |
| 7 | 文件读取异常 | 权限错误 | undefined + warn | 错误处理 |
| 8 | replace 模式 | mode=replace, 工作区文件 | mode='replace' | 配置正确性 |
| 9 | append 模式 | mode=append, 工作区文件 | mode='append' | 配置正确性 |
| 10 | 空文件内容 | 文件存在但为空 | undefined（跳过空文件） | 边界 |

##### 能力 B — PendingUserGateService

| # | 测试名称 | 输入 | 预期输出 | 场景 |
|---|----------|------|----------|------|
| 1 | 创建 gate | createGate(sid, msg) | state=pending | 正常创建 |
| 2 | 工具调用 deny | pending + onToolCallAttempted | deny=true, state=asked | 核心 |
| 3 | 重复 deny | asked + onToolCallAttempted | deny=true（保持 asked） | 幂等 |
| 4 | 用户回答解除 | asked + onUserPromptSubmitted | state=resolved | 核心 |
| 5 | 解除后通过 | resolved + onToolCallAttempted | deny=false + ctx | 恢复 |
| 6 | 超时 expired | asked + 超时 | state=expired | 边界 |
| 7 | 无 gate 时透传 | 无 gate + onToolCallAttempted | deny=false, ctx=[] | 零干预 |
| 8 | 开关关闭时 | config=false + createGate | gate 不创建 | 零副作用 |
| 9 | pending 时用户直接回答 | pending + onUserPromptSubmitted | state=resolved | 快速回答 |
| 10 | 多 session 独立 | sid1 + sid2 各自 gate | 互不影响 | 隔离性 |
| 11 | expired 后重建 | expired + createGate | state=pending | 重置 |

##### 能力 C — EventCompactTriggerService

| # | 测试名称 | 输入 | 预期输出 | 场景 |
|---|----------|------|----------|------|
| 1 | 触发文件匹配 | read_file + trigger.md | state=armed | 正常触发 |
| 2 | 非触发文件忽略 | read_file + other.md | state=idle | 过滤 |
| 3 | 非 read_file 忽略 | run_terminal + trigger.md | state=idle | 过滤 |
| 4 | 消费 armed | tryConsume(sid, false) | true, state=triggered | 正常消费 |
| 5 | gate 活跃时延后 | tryConsume(sid, true) | false, state=armed | gate 优先 |
| 6 | cooldown 忽略 | cooldown + TRIGGER_FILE_READ | state=cooldown | 防抖 |
| 7 | cooldown 到期 | cooldown + wait | state=idle | 正常恢复 |
| 8 | 开关关闭时 | config=false + onPostToolUse | state 不变 | 零副作用 |
| 9 | 多 session 独立 | sid1 armed, sid2 idle | 互不影响 | 隔离性 |
| 10 | triggered 时再次读取 | triggered + onPostToolUse | state=triggered | 无重复 |

##### 集成测试

| # | 测试名称 | 场景描述 |
|---|----------|----------|
| 1 | override + 手动 /compact | override 文件存在 → render 使用自定义 prompt |
| 2 | gate 完整生命周期 | pending → deny → 用户回答 → resolved → 恢复 |
| 3 | 事件触发完整链路 | read trigger → armed → consume → compact → cooldown |
| 4 | gate 与 compact 冲突 | gate asked + armed → compact 延后 |
| 5 | 三项能力全关闭 | 无任何额外行为（回归） |
| 6 | compact 联动注入 | compact summary 含未消费注入信息 |
| 7 | PreCompact trigger 值 | 三种触发方式的 trigger 值正确 |

#### 回归测试

| # | 测试点 | 验证内容 |
|---|--------|----------|
| 1 | 现有 /compact 命令 | 无 override 时行为不变 |
| 2 | 现有 BudgetExceeded compact | 无事件触发时行为不变 |
| 3 | 现有 preToolUse hook | 无 gate 时 deny/ask/allow 折叠逻辑不变 |
| 4 | 现有后台 compact | 80%/95% 阈值行为不变 |
| 5 | 现有 inline compact | proactive inline 逻辑不变 |

#### 测试实现要点

- **Mock 策略**: 使用 vitest 的 `vi.fn()` 和 `mock<T>()` 创建 mock 服务
  - `IFileSystemService`: mock `readFile` 返回指定内容或抛出 `FileNotFound`
  - `IConfigurationService`: mock `getConfig` 根据 ConfigKey 返回预设值
  - `IWorkspaceService`: mock `getWorkspaceFolders` 返回固定 URI
  - `ILogService`: 使用 spy 验证 warn/debug 是否被调用
- **时间控制**: 对超时和冷却计时器使用 vitest 的 `vi.useFakeTimers()` + `vi.advanceTimersByTime()`
- **文件组织**: 每个 spec 文件放在 `src/extension/compact/test/` 下，与实现代码同级

#### 顺序依赖
- 三个独立 spec 文件可并行编写
- integration.spec.ts 依赖三个独立 spec 完成（共享 mock 基础设施）

#### 验收标准
- [ ] `npm run test:unit` 所有新增测试通过
- [ ] `npm run test:unit` 所有已有测试通过（回归）
- [ ] `start-watch-tasks` 零编译错误
- [ ] 三项能力各自开关关闭时对应测试验证零副作用

---

## 核心逻辑伪代码

### 伪代码 1 — CompactPromptOverrideResolver.resolve()

```
位置: src/extension/compact/common/compactPromptOverrideResolver.ts

async resolve(sessionId: string): Promise<CompactOverrideResult | undefined> {
  IF NOT configService.getConfig(CompactPromptOverrideEnabled):
    RETURN undefined

  mode = configService.getConfig(CompactPromptOverrideMode)  // 'replace' | 'append'

  workspaceFolders = workspaceService.getWorkspaceFolders()
  workspaceUri = workspaceFolders[0]?.uri
  IF NOT workspaceUri:
    RETURN undefined

  candidates = [
    { uri: URI.joinPath(workspaceUri, '.copilot/compact/session', sessionId + '.md'), source: 'session' },
    { uri: URI.joinPath(workspaceUri, '.copilot/compact/prompt.md'), source: 'workspace' },
    { uri: URI.joinPath(userHomeUri, '.copilot/compact/prompt.md'), source: 'user' },
  ]

  FOR EACH { uri, source } IN candidates:
    TRY:
      bytes = await fileSystemService.readFile(uri)
      text = new TextDecoder().decode(bytes)

      IF text.trim().length === 0:
        CONTINUE  // 跳过空文件

      IF text.length > 102400:
        text = text.slice(0, 102400)
        logService.warn('[CompactOverride] File truncated: ' + uri.toString())

      RETURN { content: text, mode, source }
    CATCH error:
      IF error is FileNotFound:
        CONTINUE  // 静默降级
      ELSE:
        logService.warn('[CompactOverride] Error reading file: ' + uri.toString(), error)
        CONTINUE

  RETURN undefined
}
```

### 伪代码 2 — PendingUserGateService.onToolCallAttempted()

```
位置: src/extension/compact/common/pendingUserGateService.ts

onToolCallAttempted(sessionId: string): GateToolCallResult {
  gate = this._gates.get(sessionId)
  IF gate is undefined:
    RETURN { deny: false }

  SWITCH gate.state:
    CASE 'pending':
      gate.state = 'asked'
      gate.askedAt = Date.now()
      logService.debug('[InterruptGate] pending → asked for session ' + sessionId)
      RETURN {
        deny: true,
        additionalContext: [
          '⚠️ INTERRUPT: There is a pending question for the user. '
          + 'You MUST ask the user a clear question now. Do NOT call any tools.\n'
          + 'Original context: ' + gate.injectionMsg
        ]
      }

    CASE 'asked':
      RETURN {
        deny: true,
        additionalContext: ['⚠️ Still waiting for user response. Do NOT call any tools.']
      }

    CASE 'resolved':
      answer = gate.userAnswer
      this._gates.delete(sessionId)  // 消费并清理
      logService.debug('[InterruptGate] resolved → consumed for session ' + sessionId)
      RETURN {
        deny: false,
        additionalContext: answer
          ? ['User response to your previous question: ' + answer]
          : undefined
      }

    CASE 'expired':
      logService.debug('[InterruptGate] gate expired for session ' + sessionId)
      RETURN { deny: false }

    DEFAULT:
      RETURN { deny: false }
}
```

### 伪代码 3 — executePreToolUseHook 中的 gate 注入

```
位置: src/extension/chat/vscode-node/chatHookService.ts
函数: executePreToolUseHook()
插入点: L332 的 this.executeHook() 调用之前

  // ── interrupt gate 硬约束（最高优先级） ──────────────────
  let earlyAdditionalContext: string[] = [];
  if (sessionId && this._pendingUserGateService.isActive(sessionId)) {
    const gateResult = this._pendingUserGateService.onToolCallAttempted(sessionId);
    if (gateResult.deny) {
      // 直接返回 deny，跳过所有 hook 脚本执行
      return {
        permissionDecision: 'deny',
        permissionDecisionReason: 'Interrupt gate: waiting for user response',
        additionalContext: gateResult.additionalContext,
      };
    }
    // gate 刚 resolved — 不 deny，但携带用户回答作为 context
    if (gateResult.additionalContext?.length) {
      earlyAdditionalContext = gateResult.additionalContext;
    }
  }
  // ── gate 检查结束，继续原有 hook 流程 ──────────────────

  // ...原有 this.executeHook('PreToolUse', ...) 代码不变...

  // 在折叠结果时，将 earlyAdditionalContext 合入 allAdditionalContext:
  allAdditionalContext.unshift(...earlyAdditionalContext);
```

### 伪代码 4 — buildPrompt 中的事件触发 compact 判定

```
位置: src/extension/intents/node/agentIntent.ts
函数: buildPrompt()
插入点: L480 左右（后台 compact 双阈值判定之后、proactive inline 之前）

  // ── 事件触发 compact（第二触发通道） ──────────────────
  let eventTriggeredCompact = false;
  const sessionId = promptContext.conversation?.sessionId;
  if (sessionId && this._configurationService.getConfig(ConfigKey.Advanced.EventCompactTriggerEnabled)) {
    const gateActive = this._pendingUserGateService?.isActive(sessionId) ?? false;
    if (this._eventCompactTriggerService.tryConsume(sessionId, gateActive)) {
      this.logService.debug('[Agent] event-triggered compact armed and consumed');
      eventTriggeredCompact = true;
    }
  }

  // ... (正常渲染 try/catch 块) ...

  // 在正常渲染完成后、返回结果前:
  if (eventTriggeredCompact && !summaryAppliedThisIteration) {
    const override = await this._compactPromptOverrideResolver.resolve(sessionId!);
    const compactProps = {
      ...props,
      compactOverride: override ? { content: override.content, mode: override.mode } : undefined,
      compactTrigger: 'event' as const,
    };
    if (inlineSummarizationEnabled) {
      result = await renderWithInlineSummarization('event-triggered compact', compactProps);
    } else {
      result = await renderWithSummarization('event-triggered compact', compactProps);
    }
    this._eventCompactTriggerService.onCompactCompleted(sessionId!);
    summaryAppliedThisIteration = true;
  }
```

### 伪代码 5 — postToolUse 中的触发文件检测

```
位置: src/extension/prompts/node/panel/toolCalling.tsx
函数: appendHookContext()
插入点: 函数末尾（L540 后）

  // ── 事件触发 compact：检测是否读取了触发文件 ──
  if (promptContext.conversation?.sessionId && eventCompactTriggerService) {
    eventCompactTriggerService.onPostToolUse(
      promptContext.conversation.sessionId,
      props.toolCall.name,
      inputObj,
    );
  }
```

### 伪代码 6 — ConversationHistorySummarizationPrompt.render() 中的 replace/append

```
位置: src/extension/prompts/node/agent/summarizedConversationHistory.tsx
函数: ConversationHistorySummarizationPrompt.render()
修改点: L160 左右的 SystemMessage 内部

原:
  <SystemMessage priority={this.props.priority}>
    {SummaryPrompt}
    {this.props.summarizationInstructions && <>
      <br /><br />
      ## Additional instructions from the user:<br />
      {this.props.summarizationInstructions}
    </>}
  </SystemMessage>

改为:
  <SystemMessage priority={this.props.priority}>
    {this.props.compactOverride?.mode === 'replace'
      ? <Raw>{this.props.compactOverride.content}</Raw>
      : <>
          {SummaryPrompt}
          {this.props.compactOverride?.content && <>
            <br /><br />
            ## Custom compact instructions:<br />
            <Raw>{this.props.compactOverride.content}</Raw>
          </>}
        </>
    }
    {this.props.summarizationInstructions && <>
      <br /><br />
      ## Additional instructions from the user:<br />
      {this.props.summarizationInstructions}
    </>}
  </SystemMessage>
```

---

## 里程碑依赖图

```
阶段 1: 基建
  ┌─ T-1.1 类型定义 ────────────────────────────┐
  │  T-1.2 PreCompactHookInput 扩展              │  第一波（全部可并行）
  │  T-1.3 ConfigKey 注册                        │
  │  T-1.4 package.json 配置                     │
  └──────────────────────────────────────────────┘
  ┌─ T-1.5 CompactPromptOverrideResolver ────────┐
  │  T-1.6 PendingUserGateService                │  第二波（可并行，依赖第一波）
  │  T-1.7 EventCompactTriggerService            │
  └──────────────────────────────────────────────┘
         │
         ▼
阶段 2: 集成
  ┌─ T-2.1 服务注册 ─────────────────────────────┐  最先
  └──────────────────────────────────────────────┘
  ┌─ T-2.2 → T-2.3 → T-2.4 ── 能力 A 链路 ─────┐
  │  T-2.5 → T-2.6          ── 能力 B 链路       │  三条可并行
  │  T-2.7 → T-2.8          ── 能力 C 链路       │  但 T-2.8 依赖 T-2.5
  └──────────────────────────────────────────────┘
         │
         ▼
阶段 3: 联动
  ┌─ T-3.1 PreCompact trigger 贯通 ─────────────┐
  │  T-3.2 compact 联动注入信息                   │  可并行
  └──────────────────────────────────────────────┘
         │
         ▼
阶段 4: 测试与验收
  ┌─ A/B/C 独立 spec 文件 ──────────────────────┐  可并行
  └──────────────────────────────────────────────┘
  ┌─ integration.spec.ts ───────────────────────┐  串行依赖
  └──────────────────────────────────────────────┘
  ┌─ 回归验证（运行全量 test:unit） ────────────┐  最后
  └──────────────────────────────────────────────┘
```

**排序理由**：
1. **阶段 1 先行**: 类型和服务是所有集成的基础。无循环依赖，可最大并行化。
2. **阶段 2 依赖阶段 1**: 集成代码需 import 阶段 1 的服务和类型。DI 注册必须先于使用。
3. **阶段 3 依赖阶段 2**: 联动逻辑（trigger 贯通、注入信息联动）需要集成点就位后才有意义。
4. **阶段 4 最后**: 完整测试需要所有实现就位。但每阶段完成后应立即 `npm run typecheck` 确认无编译错误。

---

## 高精度模式说明

本规划已覆盖所有需求条目（A/B/C + 跨能力）、全部架构约束、交互设计流程、代码锚点定位和测试场景。

若需启用高精度审查循环，请反复调用 `momus` 子智能体审查本计划文件。规则只有一条：传入给 Momus 的只需文件路径字符串：

```
.sisyphus/plans/compact-injection-upgrade-plan.md
```

不加解释、不加包装。Momus 会审查是否有遗漏或不可执行的部分。如有反馈则修复后再次提交，直到通过。
# vscode-copilot-chat：compact 与注入机制低入侵升级实施计划

## TL;DR

> 核心目标: 在不重写核心循环的前提下，新增三项能力：compact 专属可覆盖提示词、注入命中后的硬打断栅栏、读取指定文件触发语义 compact。
> 交付物: 可配置的三组开关、两套状态机、最小改动插桩点、自动化测试最小集、分阶段回滚策略。
> 预估规模: Medium
> 并行执行: YES - 2 波次（配置与状态容器并行；主链接入串行）
> 关键路径: 配置与状态契约 -> interrupt gate 硬栅栏 -> compact 覆盖与事件触发 -> 回归与灰度

---

## 上下文

### 原始需求
围绕 compact 与注入机制升级三项能力：
1. compact 提示词可被用户目录 .copilot 下文件分级覆盖，且不影响普通对话 system prompt。
2. 命中注入规则时 AI 必须打断并等待用户回答；未回答前禁止继续工具调用。
3. 当 AI 读取到指定触发文件时，自动触发类似 90% 阈值的 compact，且触发依据为语义事件而非纯 token。

### 访谈摘要
关键讨论:
- 低入侵优先: 优先复用现有 PreCompact、PreToolUse、AgentIntent compact 分支，不改主架构。
- 可回滚优先: 每一能力独立开关，失败可单点禁用。
- 硬约束优先: interrupt gate 必须系统态阻断，而不是依赖模型自律。

研究发现:
- 现有 compact 链路已具备 foreground/inline/background 分支及阈值逻辑，可复用接入事件触发。
- PreToolUse 已有 deny/ask/allow 聚合与 additionalContext 通道，但缺少“等待用户回答”的会话状态。
- PreCompact 已存在 hook 入口，可作为 compact 前统一挂点。

---

## 工作目标

### 核心目标
构建“可配置、可观测、可回滚”的三能力增量方案，确保默认行为不变，启用后满足硬打断与自动 compact 触发。

### 具体交付物
- 新增 compact 专属覆盖解析层与优先级决策。
- 新增 interrupt gate 会话状态容器与工具调用前硬阻断。
- 新增事件触发 compact 状态机与触发器（读取指定文件 -> 语义 compact）。
- 新增对应 settings、遥测字段、最小测试集与灰度开关。

### 完成定义
- 开关默认关闭时，现有行为完全不变。
- 打开 interrupt gate 后，命中规则且未回答时工具调用为 0 次。
- 打开事件触发 compact 后，读取命中文件会在同轮或下一轮进入 compact 分支。
- compact 覆盖仅影响 compact summarization prompt，不污染普通对话 system prompt。

### 必须包含
- 三能力独立开关。
- 会话级状态机（interrupt gate + event compact）。
- 可观测证据（日志/遥测/测试）。

### 明确排除（护栏）
- 不重构 ToolCallingLoop 主循环。
- 不改默认 prompt 体系的全局解析行为。
- 不引入新的协议层或跨进程服务。

---

## 数据流与状态机

### 1) interrupt gate 状态机

状态定义:
- pending: 注入规则命中，尚未向用户发起澄清问题。
- asked: 已向用户发问，等待用户回答。
- resolved: 收到可接受回答，允许恢复工具调用。
- expired: 超时或上下文失效，需要重新评估。

建议存储域:
- 会话级，按 sessionId 挂载在 chat 会话内存态（避免污染全局）。
- 最小字段: gateId, state, reason, question, askedAt, resolvedAt, expiresAt, lastUserTurnId。

触发与迁移:
- 无状态 -> pending: PreToolUse 结果为 ask 且命中 interruptGate.enabled。
- pending -> asked: 系统向用户发出中断问题并写入当前轮次。
- asked -> resolved: 用户消息命中回答判定器（基础规则+可扩展策略）。
- asked -> expired: 超过等待时限或会话切换。
- expired -> pending: 后续再次命中注入规则。
- resolved -> 无状态: 完成一次工具调用后自动清理，或在 N 轮后清理。

硬约束点:
- 工具调用前检查 gate 状态：state in {pending, asked, expired} 时一律 deny（系统层阻断）。
- 仅 state=resolved 时放行。

### 2) 事件触发 compact 状态机

状态定义:
- idle: 未监听到触发事件。
- armed: 监听到触发事件，待执行 compact。
- cooldown: 已触发 compact，冷却期内不重复触发。

建议存储域:
- 会话级，按 sessionId 挂载，字段: state, armedByFile, armedAt, compactedAt, cooldownUntil。

触发与迁移:
- idle -> armed: 用户请求 AI 读取文件且路径命中触发规则（精确/通配）。
- armed -> cooldown: 进入 compact 执行分支（inline/foreground，优先非阻塞策略）。
- cooldown -> idle: 冷却到期或显式重置。
- 任意 -> idle: 会话结束或功能关闭。

冲突规则:
- 若 interrupt gate 处于 asked，则优先处理 gate，compact 进入延迟队列。
- 若 background compaction 正在进行且事件触发到达，优先复用已有 in-progress 结果，避免双 compact。

### 3) 端到端数据流（最小入侵版）

1. 进入工具调用前：PreToolUse 聚合结果。
2. 写入/更新 interrupt gate 状态。
3. gate 未 resolved -> 立即阻断工具调用并输出中断问题。
4. 用户回答后状态转 resolved。
5. 读取文件工具返回时解析目标路径；命中规则则将 event compact 置为 armed。
6. 在 AgentIntent 的现有 compact 判定节点读取 armed 状态，触发 compact（语义触发），完成后置 cooldown。

---

## 配置设计草案

命名原则:
- 归入 github.copilot.chat.advanced.* 或 github.copilot.chat.*，保持现有风格。
- 默认关闭，灰度可控。

### 新增 settings

1. github.copilot.chat.advanced.compact.promptOverride.enabled
- 类型: boolean
- 默认值: false
- 说明: 启用 compact 专属提示词覆盖解析。

2. github.copilot.chat.advanced.compact.promptOverride.paths
- 类型: object
- 默认值:
  - user: .copilot/prompts/compact.user.md
  - workspace: .copilot/prompts/compact.workspace.md
  - profile: .copilot/prompts/compact.profile.md
- 说明: 分级覆盖文件路径。

3. github.copilot.chat.advanced.compact.promptOverride.mergeMode
- 类型: string (replace | append)
- 默认值: append
- 说明: 覆盖文件如何与内置 SummaryPrompt 合并。

4. github.copilot.chat.advanced.interruptGate.enabled
- 类型: boolean
- 默认值: false
- 说明: 启用 ask 命中后的硬打断状态机。

5. github.copilot.chat.advanced.interruptGate.timeoutMs
- 类型: number
- 默认值: 180000
- 说明: asked 状态超时阈值。

6. github.copilot.chat.advanced.interruptGate.requireUserAck
- 类型: boolean
- 默认值: true
- 说明: 是否必须检测到明确用户回答才可恢复工具调用。

7. github.copilot.chat.advanced.compact.eventTrigger.enabled
- 类型: boolean
- 默认值: false
- 说明: 启用读取文件触发 compact。

8. github.copilot.chat.advanced.compact.eventTrigger.files
- 类型: array(string)
- 默认值: []
- 说明: 触发文件列表，支持 glob。

9. github.copilot.chat.advanced.compact.eventTrigger.cooldownMs
- 类型: number
- 默认值: 120000
- 说明: 事件触发 compact 冷却时间。

10. github.copilot.chat.advanced.compact.eventTrigger.strategy
- 类型: string (inlinePreferred | foregroundOnly)
- 默认值: inlinePreferred
- 说明: 触发后优先采用哪条 compact 分支。

### 覆盖优先级与冲突处理

覆盖优先级（高 -> 低）:
- 用户目录 profile 文件
- 工作区文件
- 用户目录 user 文件
- 内置 SummaryPrompt

冲突处理:
- 文件不可读/解析失败: 记录告警并回退到下一级。
- mergeMode=replace 但内容为空: 视为无效，回退下一级。
- 事件触发与预算触发同时命中: 只执行一次 compact，优先使用已在途结果。
- interrupt gate 与 compact 同时命中: gate 优先，compact 延后。

---

## 分阶段实施计划

## Phase 1: 契约与开关基础层

目标:
- 建立三能力的配置、状态容器、日志与遥测骨架，不改业务行为。

改动边界:
- 配置声明与读取层。
- 会话态容器（interrupt gate + event compact）。
- 仅接入空实现与观测，不改变调用结果。

关键任务:
- 定义 settings 键与默认值。
- 定义状态结构和序列化策略（仅内存态，必要时可扩展 transcript）。
- 增加基础遥测事件：gate_state_changed、compact_event_armed、compact_override_resolved。

风险:
- 新配置命名与现有 advanced 组冲突。
- 状态初始化时机不一致导致脏状态。

回滚:
- 关闭三个主开关即可行为归零。
- 保留代码但不生效，不需要删改核心链路。

验收标准:
- 所有新配置可读取且默认关闭。
- 打开日志后可观测状态迁移，但功能行为与现状一致。

## Phase 2: interrupt gate 硬打断闭环

目标:
- 实现 ask 命中后的系统级阻断：未回答前不允许继续工具调用。

改动边界:
- PreToolUse 结果消费层与工具调用前检查点。
- 聊天轮次内用户回答识别与状态迁移。
- 不改工具本身，不改 hook 协议。

关键任务:
- 在 executePreToolUseHook 结果后写入 gate 状态。
- 在 tool 调用实际入口增加 gate guard（state!=resolved 即 deny）。
- 增加 asked 状态下的统一提示模板与超时处理。

风险:
- 误判用户回答导致过阻断或漏放行。
- 与已有 deny/ask 语义叠加后产生重复提示。

回滚:
- 关闭 interruptGate.enabled，逻辑退回现有 deny/ask/allow。
- 若仅回答识别有问题，可单独关闭 requireUserAck，退化为一次性 ask。

验收标准:
- 命中 ask 后，直到用户回答前工具调用次数为 0。
- 用户回答后下一次工具调用恢复。
- 超时后状态进入 expired，系统给出可恢复提示。

## Phase 3: compact 提示词分级覆盖

目标:
- 仅对 compact summarization prompt 引入分级覆盖，不影响普通对话 system prompt。

改动边界:
- compact prompt 组装层（SummaryPrompt 注入点）。
- 覆盖文件读取与 merge 决策层。
- 不修改全局 prompt override 行为。

关键任务:
- 解析三层覆盖路径与优先级。
- 支持 append/replace 两种 mergeMode。
- 增加“来源追踪”字段用于排障（最终来源层级）。

风险:
- 覆盖内容质量差导致摘要退化。
- replace 模式可能丢失关键安全/结构约束。

回滚:
- 关闭 compact.promptOverride.enabled。
- 或强制 mergeMode=append 作为安全降级。

验收标准:
- 不同层级文件生效优先级符合设计。
- 普通对话 prompt 不受影响。
- 覆盖异常时自动回退内置提示词。

## Phase 4: 事件触发 compact（语义触发）

目标:
- 用户让 AI 读取指定文件时触发 compact（非 token-only），并具备冷却与去重。

改动边界:
- 读取文件结果后的事件识别。
- AgentIntent compact 判定节点的语义触发接入。
- 状态机 idle/armed/cooldown。

关键任务:
- 识别“用户驱动读取文件”事件并匹配触发列表。
- 命中后置 armed，在已有 compact 判定节点消费。
- 加入 cooldown 与与 background compaction 去重逻辑。

风险:
- 触发过频导致上下文抖动。
- 与预算触发并发造成重复 compact。

回滚:
- 关闭 compact.eventTrigger.enabled。
- 将 cooldownMs 拉长作为温和降载。

验收标准:
- 命中触发文件后可在可预期轮次看到 compact 执行信号。
- 冷却期内不会重复触发。
- 与 budget compact 并发时只执行一次 compact。

---

## 测试规划（最小测试集）

### 单元测试

1. interrupt gate 状态机
- 场景: pending -> asked -> resolved
- 场景: asked 超时 -> expired
- 场景: resolved 后清理

2. compact 覆盖优先级解析
- 场景: 三层文件同时存在，取最高优先级。
- 场景: 高优先级无效内容，自动回退次级。
- 场景: append 与 replace 合并策略。

3. 事件触发状态机
- 场景: idle -> armed -> cooldown -> idle
- 场景: cooldown 内重复事件忽略

### 集成测试

1. PreToolUse ask + gate guard
- 给出 ask 结果，验证工具不执行；用户回答后恢复。

2. compact 覆盖仅作用于 summarization
- /compact 或预算触发时生效；普通请求不生效。

3. 读取触发文件 -> compact
- 模拟 read_file 命中配置列表，验证 compact 分支触发且仅一次。

### 回归测试

1. 关闭全部开关
- 与当前主干行为一致（工具调用、compact 触发、普通 prompt）。

2. 背景 compact 与事件 compact 并发
- 无重复 compact、无异常状态残留。

3. hook deny 既有行为
- deny 仍优先于 ask，且错误提示不回退。

---

## 里程碑与依赖顺序

M1: 配置与状态契约落地
- 先做原因: 后续两条主能力都依赖统一状态与开关，先定契约可避免返工。

M2: interrupt gate 硬阻断
- 先于事件 compact 原因: 该能力是“安全闸门”，可先建立系统硬约束，降低后续并发触发风险。

M3: compact 覆盖能力
- 在 gate 后原因: 覆盖能力影响输出质量，不影响执行安全，可独立灰度。

M4: 事件触发 compact
- 最后原因: 需要复用前两步的状态管理与冲突仲裁，且回归面最大。

M5: 全链路回归与灰度
- 按开关分批灰度: 先覆盖能力，再 gate，再事件触发，最后全开组合。

依赖图:
- M1 -> M2
- M1 -> M3
- M2 + M3 -> M4
- M2 + M3 + M4 -> M5

---

## 成功标准

- 三项能力均具备独立开关与独立回滚路径。
- interrupt gate 在未回答前实现系统级工具调用阻断。
- compact 覆盖仅作用于 compact 流程，不影响普通 system prompt。
- 事件触发 compact 按 idle/armed/cooldown 状态机稳定运行。
- 最小测试集通过，且关闭开关时零行为回归。

---

## 建议实现锚点（执行者参考）

- compact prompt 与 PreCompact: src/extension/prompts/node/agent/summarizedConversationHistory.tsx
- compact 触发主链: src/extension/intents/node/agentIntent.ts
- hook 聚合与权限决策: src/extension/chat/vscode-node/chatHookService.ts
- hook 契约类型: src/platform/chat/common/chatHookService.ts
- 工具调用入口与 hook context: src/extension/prompts/node/panel/toolCalling.tsx
- 配置入口与现有 debug override 参照: package.json
