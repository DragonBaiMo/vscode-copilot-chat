<results>
<files>
- i:\CustomBuild\Other\vscode-copilot-chat\src\platform\endpoint\node\autoChatEndpoint.ts:25 — 定义 Auto 伪模型，说明它只是包装真实 endpoint 的壳。
- i:\CustomBuild\Other\vscode-copilot-chat\src\platform\endpoint\node\automodeService.ts:172 — Auto 最终解析核心，决定 selectedModel 并缓存会话结果。
- i:\CustomBuild\Other\vscode-copilot-chat\src\platform\endpoint\node\routerDecisionFetcher.ts:41 — 外部 auto router API 调用点，本地把 prompt 和上下文信号发给分类服务。
- i:\CustomBuild\Other\vscode-copilot-chat\src\extension\prompt\vscode-node\endpointProviderImpl.ts:65 — 主聊天请求从 request.model 进入 endpoint 解析的统一入口。
- i:\CustomBuild\Other\vscode-copilot-chat\src\extension\conversation\vscode-node\languageModelAccess.ts:320 — UI 模型列表生成、Auto 展示和请求前 endpoint 绑定入口。
- i:\CustomBuild\Other\vscode-copilot-chat\src\extension\conversation\vscode-node\chatParticipants.ts:310 — 唯一明确会主动改当前聊天模型的本地命令路径，发生在限流后自动/手动切回 Auto。
- i:\CustomBuild\Other\vscode-copilot-chat\src\platform\endpoint\common\modelAliasRegistry.ts:50 — 目前唯一已注册的隐藏别名映射 copilot-fast -> gpt-4o-mini。
- i:\CustomBuild\Other\vscode-copilot-chat\src\extension\agents\vscode-node\agentTypes.ts:16 — 自定义 agent frontmatter 支持 model 与 handoff.model，是最接近“发一条指令换模型”的现有扩展点。
- i:\CustomBuild\Other\vscode-copilot-chat\src\util\vs\workbench\contrib\chat\common\promptSyntax\promptFileParser.ts:78 — prompt/agent 文件解析器确认支持 model、handoffs.model、disable-model-invocation 等元数据。
- i:\CustomBuild\Other\vscode-copilot-chat\src\platform\configuration\common\configurationService.ts:876 — 设置项中存在 selectedCompletionModel、rateLimitAutoSwitchToAuto 以及多个 agent/subagent 专属 model 配置。
- i:\CustomBuild\Other\vscode-copilot-chat\src\extension\prompt\node\executionSubagentToolCallingLoop.ts:81 — execution subagent 可通过配置强制模型，否则回落到主请求模型。
- i:\CustomBuild\Other\vscode-copilot-chat\src\extension\prompt\node\searchSubagentToolCallingLoop.ts:88 — search subagent 可通过配置或 agentic proxy 模式单独选模型。
</files>

<answer>
结论摘要
主聊天里的 Auto 不是一个真实后端模型，而是本地伪模型 ID auto。UI 里选中 Auto 后，请求不会直接带固定模型名，而是先走 endpoint provider，再由 AutomodeService 根据可用模型列表、实验开关、外部 router 决策、同 provider 粘性、图片能力和会话缓存解析出真实 endpoint。真正“按任务/上下文自动选模型”的关键分类并不在本地代码里，而是在 RouterDecisionFetcher 调用的外部 API；本地代码只负责组装信号、消费 candidate_models、失败时 fallback。

1. Auto 在哪里定义、持久化、传递、解析
- 定义：AutoChatEndpoint 把 Auto 定义为伪模型 ID auto，注释明确说明它代表 model picker 中的 Auto，而非真实模型。位置：i:\CustomBuild\Other\vscode-copilot-chat\src\platform\endpoint\node\autoChatEndpoint.ts:25-29。
- UI 暴露：LanguageModelAccess 把 Auto endpoint 组装成 vscode.LanguageModelChatInformation，给它固定 id=auto、name=Auto，并标记 editor 默认模型。位置：i:\CustomBuild\Other\vscode-copilot-chat\src\extension\conversation\vscode-node\languageModelAccess.ts:320-344。
- 传递：ProductionEndpointProvider.getChatEndpoint 读取 request.model；如果 vendor=copilot 且 id=auto，则调用 AutomodeService.resolveAutoModeEndpoint。位置：i:\CustomBuild\Other\vscode-copilot-chat\src\extension\prompt\vscode-node\endpointProviderImpl.ts:72-90。
- 解析：AutomodeService.resolveAutoModeEndpoint 拿到 token.available_models 后，先尝试 router，再 fallback 默认模型选择，再做视觉能力 fallback，最后实例化 AutoChatEndpoint 包装真实 selectedModel。位置：i:\CustomBuild\Other\vscode-copilot-chat\src\platform\endpoint\node\automodeService.ts:172-219。
- 遥测等价概念：对 VS Code LM API，Auto 伪 ID 是 auto；对会话遥测，resolveModelIdForTelemetry 把 copilot/auto 替换成真实 resolvedModel。位置：i:\CustomBuild\Other\vscode-copilot-chat\src\extension\conversation\vscode-node\resolveModelId.ts:1-13。

2. 请求发送前最终模型 ID 在哪里确定，完整调用链是什么
主聊天链路：
1. UI 模型列表由 LanguageModelAccess.provideLanguageModelChatInformation 从 endpointProvider.getAllChatEndpoints 构建，并额外插入 autoEndpoint。位置：i:\CustomBuild\Other\vscode-copilot-chat\src\extension\conversation\vscode-node\languageModelAccess.ts:232-359。
2. 用户在 UI 选中某模型后，VS Code 在 provideLanguageModelChatResponse 回调里把选中的 model 传回扩展。位置：i:\CustomBuild\Other\vscode-copilot-chat\src\extension\conversation\vscode-node\languageModelAccess.ts:375-391。
3. _getEndpointForModel 中，若 model.id===auto，则再次调用 AutomodeService.resolveAutoModeEndpoint；否则按 model.id 或 alias 找 _chatEndpoints 中的真实 endpoint。位置：i:\CustomBuild\Other\vscode-copilot-chat\src\extension\conversation\vscode-node\languageModelAccess.ts:367-373。
4. CopilotLanguageModelWrapper.provideLanguageModelResponse 最终把 endpoint.model 填入真实网络请求和 telemetry。位置：i:\CustomBuild\Other\vscode-copilot-chat\src\extension\conversation\vscode-node\languageModelAccess.ts:504-620，尤其 telemetry 的 model 字段在 547-554 左右。

主聊天非 LM API 内部链路：
1. ChatParticipantRequestHandler 或具体 intent 代码调用 endpointProvider.getChatEndpoint(request)。位置：例如 i:\CustomBuild\Other\vscode-copilot-chat\src\extension\prompt\node\chatParticipantRequestHandler.ts:257-275。
2. ProductionEndpointProvider.getChatEndpoint 判断 request.model 是否为空、是否为 copilot vendor、是否为 auto。位置：i:\CustomBuild\Other\vscode-copilot-chat\src\extension\prompt\vscode-node\endpointProviderImpl.ts:65-94。
3. 若是 auto，AutomodeService.resolveAutoModeEndpoint 在 172-219 行完成最终 selectedModel 确定。
4. 返回的 IChatEndpoint 被 PromptRenderer 和 endpoint.makeChatRequest2 直接使用，真实模型名即 endpoint.model。

3. 本地是否存在按任务类型、agent 模式、prompt 意图、工具需求、上下文窗口、能力标签、可用性/配额、A/B、fallback 等因素决定模型的逻辑
有，但分层很明显：
- 任务/显式调用方选择：很多代码直接指定 copilot-base 或 copilot-fast，而不是 Auto。例子：terminal fix、summarizer、searchKeywordsIntent、title、feedbackGenerator 等调用 endpointProvider.getChatEndpoint('copilot-fast' 或 'copilot-base')。这不是基于用户文本动态判断，而是调用方硬编码任务类型。证据：grep 命中大量 getChatEndpoint('copilot-fast'/'copilot-base')，如 i:\CustomBuild\Other\vscode-copilot-chat\src\extension\conversation\vscode-node\terminalFixGenerator.ts:161。
- 当前 UI 选中模型：主聊天请求优先使用 request.model。位置：i:\CustomBuild\Other\vscode-copilot-chat\src\extension\prompt\vscode-node\endpointProviderImpl.ts:72-94。
- Agent/subagent 专属配置：execution/search/ask/explore/implement agent 均有单独 model 配置。位置：i:\CustomBuild\Other\vscode-copilot-chat\src\platform\configuration\common\configurationService.ts:649-655,994-1002；消费点见 executionSubagentToolCallingLoop.ts:81-95、searchSubagentToolCallingLoop.ts:88-106、askAgentProvider.ts:130-148、exploreAgentProvider.ts:136-140、planAgentProvider.ts:202-239。
- 工具需求：Execution subagent 明确检查 supportsToolCalls，若配置模型不支持工具调用则回退到主请求模型。位置：i:\CustomBuild\Other\vscode-copilot-chat\src\extension\prompt\node\executionSubagentToolCallingLoop.ts:81-90。
- 上下文能力/视觉能力：Auto 解析里，如果请求含图片且所选模型不支持 vision，会切到第一个 supportsVision 的可用模型。位置：i:\CustomBuild\Other\vscode-copilot-chat\src\platform\endpoint\node\automodeService.ts:353-365。
- 可用性列表：Auto token 接口返回 available_models，本地默认和 fallback 都只会从该列表里选。位置：i:\CustomBuild\Other\vscode-copilot-chat\src\platform\endpoint\node\automodeService.ts:176-219。
- A/B 实验与实验配置：是否启用 auto router 由 ConfigKey.TeamInternal.UseAutoModeRouting 控制；默认模型可受 chat.defaultLanguageModel 实验变量影响；auto token 请求里的 model_hints 也来自实验变量 copilotchat.autoModelHint 或 copilotchat.autoModelHint.editor。位置：i:\CustomBuild\Other\vscode-copilot-chat\src\platform\endpoint\node\automodeService.ts:58-66,320-323；i:\CustomBuild\Other\vscode-copilot-chat\src\extension\conversation\vscode-node\languageModelAccess.ts:243-251。
- Prompt 意图/上下文信号：RouterDecisionFetcher 发送的 contextSignals 只有 session_id、reference_count、prompt_char_count、previous_model、turn_number；prompt 全文也发送给外部 router。位置：i:\CustomBuild\Other\vscode-copilot-chat\src\platform\endpoint\node\automodeService.ts:274-286；i:\CustomBuild\Other\vscode-copilot-chat\src\platform\endpoint\node\routerDecisionFetcher.ts:41-68。
- 配额/限流 fallback：ChatParticipants 在 premium 配额耗尽时可切到 base model，在模型限流时可提示或自动切回 Auto。位置：i:\CustomBuild\Other\vscode-copilot-chat\src\extension\conversation\vscode-node\chatParticipants.ts:277-315。
- 会话 sticky/provider 粘性：Auto router 若已有 entry.endpoint，则优先保持同 provider；prompt 未变时也会跳过 router。位置：i:\CustomBuild\Other\vscode-copilot-chat\src\platform\endpoint\node\automodeService.ts:181-189,267-297。
- 会话压缩后的重新路由：agentIntent 在后台 compact/summarize 后会 invalidateRouterCache，迫使下一轮 Auto 重算模型。位置：i:\CustomBuild\Other\vscode-copilot-chat\src\extension\intents\node\agentIntent.ts:928-934。
- 随机分配：本地代码没有发现随机数、shuffle 或 weighted random 用于主聊天 Auto 选模。默认 fallback 只是按 available_models 顺序取第一个可匹配 endpoint，属于顺序优先，不是随机。证据：i:\CustomBuild\Other\vscode-copilot-chat\src\platform\endpoint\node\automodeService.ts:307-338。

4. 是否存在基于用户输入文本特定关键词切换模型的逻辑
对主聊天模型切换，未发现。
已排查的实现点：
- Auto 路由核心：AutomodeService 和 RouterDecisionFetcher，没有本地关键词表或 prompt.includes('xxx') 改模型逻辑；只是把整段 prompt 发给外部 router。位置：i:\CustomBuild\Other\vscode-copilot-chat\src\platform\endpoint\node\automodeService.ts:251-301；i:\CustomBuild\Other\vscode-copilot-chat\src\platform\endpoint\node\routerDecisionFetcher.ts:41-68。
- 主聊天入口：ProductionEndpointProvider 只看 request.model/vendor/id，不看文本内容。位置：i:\CustomBuild\Other\vscode-copilot-chat\src\extension\prompt\vscode-node\endpointProviderImpl.ts:65-94。
- 聊天参与者和 intent handler：检索了 request.prompt、request.model、changeModel、switchToAutoModel、prompt includes model 等；命中只有限流自动切换和一些非模型逻辑。
- 确认的误报：notebookEditCodePrompt 有关键词检测，但这是笔记本编辑 prompt 分类，不切模型。位置：i:\CustomBuild\Other\vscode-copilot-chat\src\extension\prompts\node\panel\notebookEditCodePrompt.tsx:109。
因此可以排除“输入一句包含某关键词就强制切到某模型”的本地实现。若存在此能力，也只能是外部 auto router 服务在服务端按 prompt 语义做分类，而不是本地关键词规则。

5. UI 模型下拉与后台实际请求模型的对应关系，是否有 Auto 之外的隐藏映射
- 对应关系主路径：UI 展示项来自 LanguageModelAccess 生成的 LanguageModelChatInformation；后台发送前再通过 _getEndpointForModel 映射回 endpoint。位置：i:\CustomBuild\Other\vscode-copilot-chat\src\extension\conversation\vscode-node\languageModelAccess.ts:320-389。
- Auto 特殊映射：UI id 是 auto，但后台 endpoint.model 会被解析成真实模型，例如 gpt-4o-mini、claude-sonnet 等可用模型之一。位置：i:\CustomBuild\Other\vscode-copilot-chat\src\platform\endpoint\node\automodeService.ts:193-219。
- 别名映射：ModelAliasRegistry 支持 UI/内部 alias -> 真实 modelId，目前仓库里只注册了 copilot-fast -> gpt-4o-mini。位置：i:\CustomBuild\Other\vscode-copilot-chat\src\platform\endpoint\common\modelAliasRegistry.ts:1-50。
- family/ID 双匹配：ProductionEndpointProvider 和 langModelServer 都允许按 family 或 id 找模型。位置：i:\CustomBuild\Other\vscode-copilot-chat\src\extension\prompt\vscode-node\endpointProviderImpl.ts:72-94；i:\CustomBuild\Other\vscode-copilot-chat\src\extension\agents\node\langModelServer.ts:303-330。
- 额外兼容映射：agent/claude server 对 claude-haiku-4、claude-sonnet-4、claude-opus-4 做局部版本名映射到 4.5 或部分匹配，这是 agent server 私有兼容逻辑，不是主聊天模型 picker 的常规映射。位置：i:\CustomBuild\Other\vscode-copilot-chat\src\extension\agents\node\langModelServer.ts:303-330。

6. 若用户想通过发一条指令就换到指定模型，不点按钮，库里是否已有命令、slash command、prompt metadata、participant 变量、设置项或内部 API 可以做到
对“主聊天面板当前会话模型”来说，没有发现现成的自然语言命令或 slash command 能直接从文本切换模型。
有的能力分别是：
- 内部命令：workbench.action.chat.changeModel 可以编程方式切换当前聊天模型，但仓库内仅用于限流后自动切换 base/auto，没有对用户暴露成 slash command。证据：i:\CustomBuild\Other\vscode-copilot-chat\src\extension\conversation\vscode-node\chatParticipants.ts:287-315。
- 设置项：ask/explore/implement/execution/search subagent 有独立 model 设置，可持久化指定其后续调用模型，但这不是“在聊天里发一句话即时切换当前主会话模型”。位置：configurationService.ts:649-655,994-1002。
- Prompt/agent metadata：.agent.md frontmatter 支持 model，handoff 也支持 model，可在 custom agent 或 handoff 中固定模型。位置：agentTypes.ts:16-111；promptFileParser.ts:78-125,220-308。
- 工具参数：很多内部工具支持 options.model，调用时可指定用于该工具自身的模型。证据：findTextInFilesTool.ts:56、newNotebookTool.ts:56、applyPatchTool.ts:623。这个能力作用于工具调用，不等于切换聊天 UI 当前模型。
因此，若目标是“不点 UI，仅靠一条普通用户消息立即把当前主聊天请求改成某个指定 copilot 模型”，本地代码里没有现成公开入口。

7. 如果没有这个能力，最接近的可扩展接入点
最接近的扩展点有三类：
- 主聊天入口拦截点：ProductionEndpointProvider.getChatEndpoint。这里已经集中处理 request.model、auto、BYOK vendor，可在这里增加“识别特定 slash command/participant 变量/metadata 后覆盖 request.model”的逻辑。位置：i:\CustomBuild\Other\vscode-copilot-chat\src\extension\prompt\vscode-node\endpointProviderImpl.ts:65-94。
- 聊天命令/参与者入口：ChatParticipants 与 ChatParticipantRequestHandler。这里已经能在运行时调用 workbench.action.chat.changeModel 并重写 request.model，可扩展成显式 slash command，如 /model gpt-4o-mini。位置：i:\CustomBuild\Other\vscode-copilot-chat\src\extension\conversation\vscode-node\chatParticipants.ts:210-315；i:\CustomBuild\Other\vscode-copilot-chat\src\extension\prompt\node\chatParticipantRequestHandler.ts:257-275。
- 自定义 agent / prompt frontmatter：agentTypes + PromptFileParser 已支持 model 字段，适合做“进入某 agent 即绑定指定模型”的方案，而不是修改主聊天 picker。位置：i:\CustomBuild\Other\vscode-copilot-chat\src\extension\agents\vscode-node\agentTypes.ts:16-111；i:\CustomBuild\Other\vscode-copilot-chat\src\util\vs\workbench\contrib\chat\common\promptSyntax\promptFileParser.ts:64-125,220-308。

关键调用链
- UI/配置到主聊天真实模型：LanguageModelAccess.provideLanguageModelChatInformation -> 用户选中 model.id -> LanguageModelAccess._provideLanguageModelChatResponse -> _getEndpointForModel -> ProductionEndpointProvider.getChatEndpoint -> 若 auto 则 AutomodeService.resolveAutoModeEndpoint -> IChatEndpoint.makeChatRequest2。
- 主聊天 intent 到真实模型：具体 intent/handler -> IEndpointProvider.getChatEndpoint(request) -> ProductionEndpointProvider.getChatEndpoint -> Auto 时进 AutomodeService，否则按 request.model 或 family 解析 -> PromptRenderer / endpoint.makeChatRequest2。
- Auto 子链：resolveAutoModeEndpoint -> tokenBank.getToken(RequestType.AutoModels) -> 可选 RouterDecisionFetcher.getRouterDecision(RequestType.ModelRouter) -> _selectDefaultModel -> _applyVisionFallback -> create AutoChatEndpoint(selectedModel,...).

对三类判断的证据结论
- 按任务选模型：有，但主要是调用方硬编码 copilot-base/copilot-fast，和子 agent 配置项，不是从普通用户文本实时推断。证据强。
- 随机分配：未见本地随机策略。Auto fallback 依赖 available_models 顺序和 router 返回 candidate_models 顺序。证据中高。
- 按关键词触发模型：本地主聊天未见。存在关键词逻辑的命中属于 notebook prompt 分类或 CLI 标签，不影响主聊天模型路由。证据中高。

不确定点与剩余盲区
- 最终“为什么 router 觉得该 prompt 需要 reasoning”不在本地仓库，而在外部 router API。RouterDecisionFetcher 只展示入参/出参格式，看不到分类模型或规则实现。
- available_models 的排序来源来自 AutoModels 服务端返回，本地只消费顺序，无法从仓库判断服务端是否按容量、价格、配额或实时负载排序。
- VS Code 核心 UI 对当前聊天模型的持久化细节不在本仓库，仓库侧主要通过 LanguageModelChatProvider 接口接入和 workbench.action.chat.changeModel 命令交互。
</answer>

<confidence>
high — Auto 解析、本地 endpoint 决策、UI 映射、agent/subagent 设置和限流切模路径都有直接代码证据；唯一主要盲区是外部 router/API 服务端内部分类策略与 available_models 排序来源。
</confidence>
</results>
