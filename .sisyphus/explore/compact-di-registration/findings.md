<results>
<files>
- I:\CustomBuild\Other\vscode-copilot-chat\src\extension\extension\vscode-node\extension.ts:35 — node 侧 extension 激活入口，调用共享 baseActivate，并传入 node 专属 registerServices 与 contributions。
- I:\CustomBuild\Other\vscode-copilot-chat\src\extension\extension\vscode\extension.ts:34 — 共享激活主函数 baseActivate，真正创建 InstantiationService 并加载 ContributionCollection。
- I:\CustomBuild\Other\vscode-copilot-chat\src\extension\extension\vscode\extension.ts:96 — createInstantiationService 在这里调用 registerServices(builder, context) 并 seal 成全局 instantiation service。
- I:\CustomBuild\Other\vscode-copilot-chat\src\extension\extension\vscode\services.ts:111 — 跨 runtime 的服务注册入口；适合放不依赖 node-only API 的 compact 服务。
- I:\CustomBuild\Other\vscode-copilot-chat\src\extension\extension\vscode-node\services.ts:158 — node/vscode-node 服务注册入口；适合放依赖 VS Code Node host、文件系统、git、terminal 等的 compact 服务。
- I:\CustomBuild\Other\vscode-copilot-chat\src\extension\extension\vscode-node\contributions.ts:65 — 常驻 node contributions 列表；若 compact 需要作为 feature/contribution 激活，这是入口。
- I:\CustomBuild\Other\vscode-copilot-chat\src\extension\extension\vscode-node\contributions.ts:109 — 仅在 chat 启用后加载的 contributions 列表；聊天相关 compact feature 更接近这里。
- I:\CustomBuild\Other\vscode-copilot-chat\src\extension\conversation\vscode-node\conversationFeature.ts:151 — chat 启用后，在此实例化 vscodeNodeChatContributions。
- I:\CustomBuild\Other\vscode-copilot-chat\src\extension\workspaceRecorder\common\workspaceListenerService.ts:11 — 典型 common 接口声明：createServiceIdentifier 放在 common 层。
- I:\CustomBuild\Other\vscode-copilot-chat\src\extension\workspaceRecorder\vscode-node\workspaceListenerService.ts:12 — 对应 vscode-node 实现类。
- I:\CustomBuild\Other\vscode-copilot-chat\src\extension\extension\vscode-node\services.ts:254 — 对应 common 接口在全局 builder.define 中注册。
- I:\CustomBuild\Other\vscode-copilot-chat\src\extension\agentDebug\common\toolResultRenderer.ts:8 — 另一个 common 接口声明示例，接口只定义能力，不带实现细节。
- I:\CustomBuild\Other\vscode-copilot-chat\src\extension\agentDebug\vscode-node\toolResultContentRenderer.ts:10 — 对应 vscode-node 实现类。
- I:\CustomBuild\Other\vscode-copilot-chat\src\extension\extension\vscode-node\services.ts:266 — 对应 builder.define 注册点。
- I:\CustomBuild\Other\vscode-copilot-chat\src\extension\tools\common\editToolLearningService.ts:31 — common 层声明 createServiceIdentifier 的示例。
- I:\CustomBuild\Other\vscode-copilot-chat\src\extension\tools\common\editToolLearningService.ts:46 — 与接口同文件放实现的示例。
- I:\CustomBuild\Other\vscode-copilot-chat\src\extension\extension\vscode\services.ts:175 — 该服务在共享 services.ts 中注册，说明 runtime-agnostic 服务可直接走共享 builder.define。
- I:\CustomBuild\Other\vscode-copilot-chat\src\extension\chatSessions\common\chatSessionWorkspaceFolderService.ts:11 — chatSessions 子域 common 接口声明示例。
- I:\CustomBuild\Other\vscode-copilot-chat\src\extension\chatSessions\vscode-node\chatSessionWorkspaceFolderServiceImpl.ts:25 — chatSessions 子域 vscode-node 实现示例。
- I:\CustomBuild\Other\vscode-copilot-chat\src\extension\chatSessions\vscode-node\chatSessions.ts:139 — chatSessions 子系统不是走全局 builder.define，而是在 child ServiceCollection 中局部注入服务。
- I:\CustomBuild\Other\vscode-copilot-chat\src\extension\chatSessions\vscode-node\chatSessions.ts:141 — 同一 child ServiceCollection 内注入另一项 common service，证明 chatSessions 有自己局部 DI 约定。
- I:\CustomBuild\Other\vscode-copilot-chat\src\extension\conversation\vscode-node\conversationFeature.ts:229 — /compact 命令入口在 conversation feature，仅负责触发 chat query。
- I:\CustomBuild\Other\vscode-copilot-chat\src\extension\chatSessions\claude\vscode-node\slashCommands\hooksCommand.ts:118 — compact 相关 hook 类型 PreCompact 当前落在 chatSessions/claude 子域。
- I:\CustomBuild\Other\vscode-copilot-chat\src\extension\prompts\node\agent\summarizedConversationHistory.tsx:644 — compact 前置 hook 的执行逻辑在 prompts/node/agent summarizer 内。
- I:\CustomBuild\Other\vscode-copilot-chat\src\extension\prompts\node\agent\summarizedConversationHistory.tsx:651 — 真正执行 PreCompact hook 的位置。
- I:\CustomBuild\Other\vscode-copilot-chat\src\extension\chatSessions\vscode-node\chatHistoryBuilder.ts:468 — chatSessions 渲染层显式识别 /compact slash command。
- I:\CustomBuild\Other\vscode-copilot-chat\src\extension\chatSessions\vscode-node\chatHistoryBuilder.ts:516 — chatSessions 渲染层显式处理 Conversation compacted system entry。
</files>

<answer>
1. extension 主服务注册入口文件路径与关键函数
主入口是 I:\CustomBuild\Other\vscode-copilot-chat\src\extension\extension\vscode-node\extension.ts:35 的 activate。它只做一层转发，真正的 DI 构建在 I:\CustomBuild\Other\vscode-copilot-chat\src\extension\extension\vscode\extension.ts:34 的 baseActivate 内完成：先在 I:\CustomBuild\Other\vscode-copilot-chat\src\extension\extension\vscode\extension.ts:63 调用 createInstantiationService，再在 I:\CustomBuild\Other\vscode-copilot-chat\src\extension\extension\vscode\extension.ts:74 用 ContributionCollection 加载 contributions。createInstantiationService 本体在 I:\CustomBuild\Other\vscode-copilot-chat\src\extension\extension\vscode\extension.ts:96，里面调用 configuration.registerServices(builder, context)，然后 seal 成全局 instantiation service。

真正“服务注册”分两层：
- 共享层：I:\CustomBuild\Other\vscode-copilot-chat\src\extension\extension\vscode\services.ts:111
- node 层：I:\CustomBuild\Other\vscode-copilot-chat\src\extension\extension\vscode-node\services.ts:158
node 层 registerServices 一开始就调用共享层 registerCommonServices(builder, extensionContext)，因此一个新服务应该按 runtime 需求决定放共享层还是 node 层。

2. 最接近本任务的已有模块如何声明 createServiceIdentifier、实现类、以及在哪注册
最接近“common 接口 + vscode-node 实现 + 全局 DI 注册”的范式有两个。

范式 A：workspaceRecorder
- 接口声明：I:\CustomBuild\Other\vscode-copilot-chat\src\extension\workspaceRecorder\common\workspaceListenerService.ts:11
- 实现类：I:\CustomBuild\Other\vscode-copilot-chat\src\extension\workspaceRecorder\vscode-node\workspaceListenerService.ts:12
- 注册点：I:\CustomBuild\Other\vscode-copilot-chat\src\extension\extension\vscode-node\services.ts:254
这条链最适合你要做的“新增 common 下接口，后续接现有 DI/注册模式”。

范式 B：agentDebug
- 接口声明：I:\CustomBuild\Other\vscode-copilot-chat\src\extension\agentDebug\common\toolResultRenderer.ts:8
- 实现类：I:\CustomBuild\Other\vscode-copilot-chat\src\extension\agentDebug\vscode-node\toolResultContentRenderer.ts:10
- 注册点：I:\CustomBuild\Other\vscode-copilot-chat\src\extension\extension\vscode-node\services.ts:266
这条链说明 common 接口可以非常薄，只放 createServiceIdentifier 和 interface，实际实现完全下沉到 vscode-node。

补充范式 C：runtime-agnostic 服务
- 声明：I:\CustomBuild\Other\vscode-copilot-chat\src\extension\tools\common\editToolLearningService.ts:31
- 实现：I:\CustomBuild\Other\vscode-copilot-chat\src\extension\tools\common\editToolLearningService.ts:46
- 注册：I:\CustomBuild\Other\vscode-copilot-chat\src\extension\extension\vscode\services.ts:175
这说明如果 compact 服务本身不依赖 node-only API，可以直接在 common 中放实现，再注册到共享 services.ts。

3. 若新增 src/extension/compact/common/*.ts，推荐的注册文件和修改点
如果你坚持新建顶层 src/extension/compact/common，最小修改面是：
- 在 common 文件内声明 export const I... = createServiceIdentifier<...>('I...')
- 若实现依赖 VS Code Node host、文件系统、git、workspace、terminal 等，放到 src/extension/compact/vscode-node/*.ts，然后在 I:\CustomBuild\Other\vscode-copilot-chat\src\extension\extension\vscode-node\services.ts:158 的 registerServices 中追加 builder.define(ICompactXService, new SyncDescriptor(CompactXServiceImpl))
- 若实现跨 web/node 都可用，直接在 I:\CustomBuild\Other\vscode-copilot-chat\src\extension\extension\vscode\services.ts:111 追加 builder.define(...)

这样被现有 instantiation/service collection 获取的链路是：
common identifier -> builder.define in services.ts -> baseActivate/createInstantiationService seal -> 任意通过 instantiationService.createInstance(...) 创建的类可用构造函数装饰器注入。
依据见：I:\CustomBuild\Other\vscode-copilot-chat\src\extension\extension\vscode\extension.ts:96。

如果后续 compact 还需要 feature/contribution 级激活，而不是仅做可注入服务：
- 常驻加载：改 I:\CustomBuild\Other\vscode-copilot-chat\src\extension\extension\vscode-node\contributions.ts:65 的 vscodeNodeContributions
- 仅 chat 激活后加载：改 I:\CustomBuild\Other\vscode-copilot-chat\src\extension\extension\vscode-node\contributions.ts:109 的 vscodeNodeChatContributions
后者更接近当前 compact 的语义边界，因为它由 I:\CustomBuild\Other\vscode-copilot-chat\src\extension\conversation\vscode-node\conversationFeature.ts:151 在 chat activation 时装载。

4. 如果当前不存在 src/extension/compact/ 目录，是否有更符合约定的替代目录
当前不存在 src/extension/compact 目录，且仓库没有独立 compact feature 根目录。现有 compact 语义分布在三处：
- 命令入口在 I:\CustomBuild\Other\vscode-copilot-chat\src\extension\conversation\vscode-node\conversationFeature.ts:229
- 会话/渲染/PreCompact hook 类型主要在 chatSessions 子域：I:\CustomBuild\Other\vscode-copilot-chat\src\extension\chatSessions\claude\vscode-node\slashCommands\hooksCommand.ts:118、I:\CustomBuild\Other\vscode-copilot-chat\src\extension\chatSessions\vscode-node\chatHistoryBuilder.ts:468、I:\CustomBuild\Other\vscode-copilot-chat\src\extension\chatSessions\vscode-node\chatHistoryBuilder.ts:516
- summarization orchestration 在 I:\CustomBuild\Other\vscode-copilot-chat\src\extension\prompts\node\agent\summarizedConversationHistory.tsx:644 和 :651

因此更符合现有约定的替代目录取决于服务边界：
- 如果这 3 个服务是“聊天压缩/会话压缩”的子域服务，优先放 src/extension/chatSessions/common，再配对 src/extension/chatSessions/vscode-node 或 node；这是仓库里最成熟的 common + child ServiceCollection 模式。
- 如果这 3 个服务是“通用 compact pipeline”，将来会被 conversation、prompts、chatSessions 多处共用，新增顶层 src/extension/compact/common + node/vscode-node 也说得通，但这是新 feature 根，不是仓库现成约定。

从当前代码分布看，若阶段 1 目标主要服务 /compact 和 PreCompact，chatSessions 目录比全新 compact 顶层目录更贴近现状。

5. 可直接实施的最小修改面
仅从注册面看，最小修改面有两条路线。

路线 A：全局 extension DI
- 新增 3 个接口文件到 src/extension/compact/common 或 src/extension/chatSessions/common
- 新增实现到对应 runtime 目录
- 只改一个注册文件：
  - 跨 runtime -> I:\CustomBuild\Other\vscode-copilot-chat\src\extension\extension\vscode\services.ts:111
  - node-only -> I:\CustomBuild\Other\vscode-copilot-chat\src\extension\extension\vscode-node\services.ts:158
这条路线最符合 extension 级服务的现有 builder.define 模式。

路线 B：仅 chatSessions 子系统局部注入
- 保持接口在 src/extension/chatSessions/common
- 实现在 src/extension/chatSessions/vscode-node
- 改 I:\CustomBuild\Other\vscode-copilot-chat\src\extension\chatSessions\vscode-node\chatSessions.ts:128-145、156-182、233-250 这些 ServiceCollection 构造位置，把新服务 descriptor 加进去
这条路线更局部，但修改点比全局注册更多，因为 chatSessions.ts 里有多组 child ServiceCollection。

就“最小修改面”而言，如果 3 个服务后续会被多个 compact 相关类共用，全局 builder.define 更省改动；如果只在 claude/copilot chat session 子系统内部使用，chatSessions.ts 的局部注入更贴近子域边界，但不是最少改动。
</answer>

<confidence>
high — 关键 DI 链路、contribution 链路、compact 现有分布、以及 common->impl->register 的对照样例都已通过源码与精确行号交叉验证。
</confidence>
</results>
