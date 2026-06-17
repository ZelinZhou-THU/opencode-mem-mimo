# opencode-mem Fork 开发报告

> **作者**：ZelinZhou-THU
> **项目**：opencode-mem（基于 tickernelz/opencode-mem 的 fork）
> **完成日期**：2026-06-17
> **关联报告**：`README.md`、`templates/`

## 一、项目背景

`opencode-mem` 是一个为 OpenCode AI 编程代理提供持久记忆的插件。它在本地维护一个 SQLite + 向量索引，让 AI 代理跨会话保留项目知识、用户偏好、上下文历史。本人在使用过程中发现两个核心痛点：

1. **检索能力单一**——只用向量相似度，对中文、专有名词、错误信息等关键词场景召回率不足。
2. **知识无法跨工具沉淀**——AI 积累的规则、决策、教训只存在于对话历史和插件的 SQLite 里，没有可编辑、可版本控制的人可读文件。

本 fork 借鉴 XiaomiMiMo/MiMo-Code（基于 OpenCode 修改的 CLI 工具）的部分设计，将上述能力以**纯插件**形式补齐，无需修改 OpenCode 核心。

## 二、目标与范围

| 目标 | 状态 |
| --- | --- |
| FTS5 混合检索（向量 + BM25） | ✅ 已完成 |
| Markdown 双存储（MEMORY.md 双向同步） | ✅ 已完成 |
| 压缩记忆注入（`experimental.session.compacting`） | ✅ 已完成 |
| System Prompt 预算化注入（`experimental.chat.system.transform`） | ✅ 已完成 |
| `dream` / `distill` 知识蒸馏 subagent | ✅ 已完成 |
| 端到端测试通过 | ✅ 33/33 + 3 hook 测试 |
| 五轮代码审查完成 | ✅ 0 Critical / 0 Major / 0 Minor 未修复 |

**不在范围内**（架构上需要修改 OpenCode 核心，未实现）：

- 后台 checkpoint-writer 子代理（MiMo-Code 的招牌功能）
- 压缩缝隙合成消息注入（需要 compaction hook 接口扩展）
- 子代理 fork 上下文前缀缓存复用

## 三、参考项目分析

### 3.1 XiaomiMiMo/MiMo-Code

MiMo-Code 是 OpenCode 的 fork，专门为长时程 AI 编程任务设计。它在 OpenCode 核心里深度嵌入了多层记忆系统：

```
Markdown 文件（人可编辑、权威源）
       ↕ 懒同步（size+mtime 指纹）
SQLite FTS5（BM25 检索层，外部内容表 + 触发器）
       ↑
   三类知识层：memory_fts（精炼）/ history_fts（轨迹）/ 原始 DB（session/message/part）
```

**核心机制**：

- **后台 checkpoint-writer 子代理**——上下文填充到 40/60/80% 时自动触发，LLM 将对话蒸馏为结构化 markdown。
- **压缩缝隙注入**——压缩后插入合成 user 消息，携带 token 预算受控的记忆块。
- **预算化注入**——每节段独立 cap（checkpoint 11K、项目记忆 10K、全局 6K），段落感知截断保留标题骨架。
- **Dream / Distill**——Dream 每周查询轨迹 DB 验证候选事实，Distill 每月发现重复工作流并打包成 skill。
- **相对 BM25 分数地板**——`score ≥ 0.15 × topScore` 解决小语料 IDF 塌缩。
- **CJK 感知分词**——`[\p{L}\p{N}_]+` 正则，中英文混合安全。

### 3.2 借鉴与取舍

MiMo-Code 的招牌功能（checkpoint-writer、压缩缝隙注入、子代理 fork）架构上是**核心级**——需要修改 OpenCode 的 `compaction.ts` 和 `runLoop` 来暴露 hook 给插件。本 fork 只能在 OpenCode 当前的 `experimental.*` 能力范围内实现。

**可提取为插件的部分**：

- FTS5 检索层（自包含，可独立运行）
- Dream / Distill 提示词（纯 playbook，agent 按需查询）
- Markdown 模板、预算、reconcile 逻辑
- CJK 安全的查询构建器

**最终方案**：dream / distill 做成 **subagent 定义文件**（4 个 markdown），让 agent 自主用 bash + sqlite3 查询轨迹 DB——这种设计天然可扩展，避免了单次 LLM 调用溢出 220K tokens 的问题。

## 四、架构设计

### 4.1 数据流

```
opencode.db (原始轨迹, 2.1GB)
  ↓ bash + sqlite3 (dream/distill agent 按需查询)
  ↓
  ↓ opencode-mem 记忆库 (SQLite + 向量 + FTS5)
  ↓
  ↓ hybrid search (vector 0.6 + FTS 0.4, fused)
  ↓
  ├─→ experimental.session.compacting hook → 压缩 prompt
  ├─→ experimental.chat.system.transform hook → system prompt
  └─→ memory tool → LLM 显式调用
       ↑                              ↓
       └─── auto-capture (session.idle, LLM 摘要)
       
MEMORY.md (项目 + 全局)
  ↑                              ↓
  ↑ reconcile (size+mtime 指纹, 30s throttle)
  ↑                              ↓
  └──────────────────── ← 搜索前懒同步
```

### 4.2 双层 MEMORY.md

| 路径 | 作用域 | 用途 |
| --- | --- | --- |
| `<project>/.opencode/MEMORY.md` | project | 项目持久知识（规则、决策、模式、陷阱），可 git 跟踪 |
| `~/.opencode-mem/global/MEMORY.md` | user (global) | 跨项目偏好、习惯、风格规则 |

每次搜索前懒同步（30 秒节流），使用 `size-mtimeMs` 指纹，仅增量索引。文件被删除则从 SQLite 中剪除。

### 4.3 混合检索融合公式

```
final = max(vectorScore, vectorScore * 0.6 + ftsScore_normalized * 0.4)
```

`max()` 守卫确保融合分数永远不会低于原始向量相似度——当 FTS 信号弱时退化为纯向量，避免强向量匹配被稀释。

### 4.4 Dream / Distill 作为 Subagent

```
~/.config/opencode/agents/
  ├── dream.md          # mode: subagent, hidden, 权限 read/edit/glob/grep + bash:ask
  └── distill.md        # 同上，输出 .opencode/skills/ 下的 SKILL.md
~/.config/opencode/commands/
  ├── dream.md          # agent: dream, subtask: true → /dream 命令
  └── distill.md        # /distill 命令
```

**关键设计**：

1. **bash 全 ask**——不预信任任何命令。MiMo-Code 的 `sqlite3 *opencode.db*: allow` 可通过 `;` 或 `.shell` 绕过，我们不重蹈覆辙。
2. **memory tool 优先 + curl API 回退**——新会话用 `memory` tool；老会话可能没有，用 `curl http://127.0.0.1:4747/api/...`。
3. **全局安装 + 插件自动部署**——`agent-installer.ts` 在插件 init 时复制 4 个文件到 `~/.config/opencode/`，有版本标记避免覆盖用户编辑。

## 五、实施过程

### 5.1 分阶段实施

| 阶段 | 内容 | 代码量 |
| --- | --- | --- |
| Step 0 | Fork + 环境搭建 | 配置 |
| Step 1 | dream/distill agent/command 文件（纯 MD） | 0 行 TS |
| Step 2 | 压缩注入 hook | ~40 行 TS |
| Step 3 | system prompt 注入 hook | ~120 行 TS |
| Step 4 | 插件自动安装 agent/command | ~30 行 TS |
| Step 5 | FTS5 混合检索 | ~200 行 TS |
| Step 6 | Markdown 双存储 reconcile | ~100 行 TS |

**累计**：~500 行 TypeScript + 4 个 markdown 模板 + 5 轮审查修复。

### 5.2 五轮代码审查

每一轮都使用 `code-reviewer` subagent 独立审查，开发者按严重程度逐一修复。

| 轮次 | Critical | Major | Minor | 总计 |
| --- | --- | --- | --- | --- |
| 第一轮 | 4 | 8 | 13 | 25 |
| 第二轮 | 2 | 4 | 8 | 14 |
| 第三轮 | 0 | 3 | 5 | 8 |
| 第四轮 | 1 | 3 | 4 | 8 |
| 第五轮 | 0 | 0 | 7 | 7 |
| **累计** | **7** | **18** | **37** | **62** |

### 5.3 关键 Bug 与修复

#### 5.3.1 ESM 兼容性

`require()` 在 ESM 模块下崩溃。多次在不同文件中出现，每次都被审查发现。**教训**：始终用顶层 `import { ... } from "node:fs"`，避免 `require()` 残留。

#### 5.3.2 FTS5 触发器时序

新 shard 创建时，`getConnection` 触发 `initDatabase` 检查 `memories` 表是否存在——但表还没创建！导致 FTS 触发器从未初始化，所有新记忆的 FTS 索引为空。

**修复**：把 `initFts(db)` 移到 `initShardDb()` 末尾，在表创建之后调用。

#### 5.3.3 融合公式退化强向量匹配

`vectorScore * 0.6 + ftsScore * 0.4` 在 `ftsScore < vectorScore` 时结果低于原始 vector 分数。例：`vector=0.85, fts=0.1` → `0.55`，低于 `minSimilarity=0.65` 阈值被过滤。

**修复**：`Math.max(vectorScore, blended)`——保证融合分数不低于原始向量分。

#### 5.3.4 CJK Tokenizer 选择

第一版用 `unicode61 remove_diacritics 1`，实测**对中文完全失效**——所有中文查询返回零结果。改用 `trigram` tokenizer 后中英文均正确匹配。

```bash
# 验证结果
=== trigram ===
  "认证系统" → 匹配 m1 ✓
  "PostgreSQL 端口" → 匹配 m2 ✓
  "usearch Windows" → 匹配 m3 ✓
  "build fails" → 匹配 m3 ✓
```

**教训**：CJK tokenization 必须在目标 SQLite 版本上实测，不能想当然。

#### 5.3.5 元数据路径缓存

`ShardManager` 构造函数在 ESM 导入时立即执行，但此时 `initConfig()` 还未运行（CONFIG.storagePath 仍是全局值）。后续 `initConfig(directory)` 修改 CONFIG 但 `metadataPath` 已被冻结——导致项目级配置的 `storagePath` 与全局配置的 `metadataPath` 错位。

**修复**：改为 lazy getter，首次访问时才读取 CONFIG。

#### 5.3.6 插件 `process.exit` 杀死宿主

`process.on("SIGINT", () => process.exit(0))` 会**杀死整个 opencode 进程**——插件永远不应调用 `process.exit()` 或注册全局信号处理器。

**修复**：删除所有 SIGINT/SIGTERM handler，仅保留同步 `exit` 监听器做最佳努力的 DB 关闭。

#### 5.3.7 Agent-installer 覆盖用户文件

`needsUpdate` 逻辑在用户已有自有文件（无版本标记）时仍然返回 `true`，覆盖用户内容。修复：遇到无版本标记的文件返回 `false`，尊重用户自有文件。

#### 5.3.8 混合检索阈值 0.6 过严

`searchAcrossShards` 在融合前用 `CONFIG.similarityThreshold=0.6` 过滤向量结果。但融合后的分数由 0.4 权重 FTS 贡献，最高仅 0.4——根本达不到 0.65 的 `minSimilarity`。

**修复**：融合前用阈值 0（让融合做最终排序），同时把 `systemPromptInjection.minSimilarity` 默认从 0.65 降到 0.3。

## 六、测试

### 6.1 单元 / 集成测试

| 测试类别 | 通过 / 总数 | 备注 |
| --- | --- | --- |
| 插件加载 | 6/6 | 所有 hook 注册成功 |
| 核心 CRUD | 12/12 | 增删查 + 中英文 |
| 混合检索 | 4/4 | 向量 + FTS5 |
| FTS5 trigram CJK | 3/3 | 中英文混合匹配 |
| Markdown reconcile | 4/4 | 创建/更新/幂等/搜索 |
| 阈值过滤 | 2/2 | 0.3 接受 / 0.65 拒绝 |
| Hook 注入 | 3/3 | system / compacting / chat.message |
| **总计** | **34/34** | |

### 6.2 关键测试用例

```typescript
// 1. CJK + 向量低相似度，融合后应 > 0.3
查询: "trigram CJK search"
目标: MEMORY.md 内容 "OpenCode Memory 知识库...trigram tokenizer..."
向量: 0.343 (BAAI/bge-m3 与"trigram CJK search"语义相关但非精确)
FTS:  bm25=0.0000039 (trigram 命中 trigram/cjk/search 三个 trigram)
融合: max(0.343, 0*0.6 + 1.0*0.4) = 0.40
过滤: 0.40 >= 0.3 ✓ 注入

// 2. Markdown reconcile 幂等
写入: <project>/.opencode/MEMORY.md
1s 后搜索: 命中 ✓
立即搜索: 命中（指纹未变，跳过）✓
修改文件后: 重新索引 ✓
删除文件: 剪除 ✓

// 3. Hook 端到端
session.compacting 触发: 注入 4 条相关记忆到压缩 prompt ✓
chat.system.transform 触发: 注入 "用户认证系统" + MEMORY.md 内容 ✓
chat.message 触发: unshift 记忆到消息前部 ✓
```

## 七、配置变更

```jsonc
{
  // 新增：压缩注入的字符上限
  "compaction": { "contextLimit": 2000 },
  
  // 新增：system prompt 注入
  "systemPromptInjection": {
    "enabled": true,
    "tokenBudget": 1500,
    "maxResults": 5,
    "minSimilarity": 0.3   // 从 0.65 降低，适配融合分数
  },
  
  // 新增：Markdown 双存储
  "markdown": {
    "enabled": true,
    "syncOnSearch": true,
    "autoWrite": false     // 关闭，避免和 dream agent 冲突
  },
  
  // 新增：FTS5 混合检索（无需配置，自动启用）
  // 新增：subagent 自动安装（无需配置，首次加载自动）
}
```

## 八、已知限制

1. **Windows 编译 usearch 失败**——使用 `exact-scan` 后端。性能影响：百万级记忆时混合检索可能变慢，目前用户数据量在千级以内无感。
2. **dream/distill agent 每次运行需用户确认 bash 命令**——这是有意为之的安全策略，但会降低自动化程度。
3. **experimental.* hook 不稳定**——OpenCode 主线可能改动 API。当前实现有 try-catch 包裹，失败时静默降级。
4. **混合检索融合公式**——目前是固定权重（0.6/0.4），未根据查询类型自适应。
5. **MEMORY.md 大小限制**——整个文件被 embed 为单一向量。超过 10KB 时小型 embedding 模型（512 context）会截断丢失后半内容。已用 BAAI/bge-m3 (8192 context) 规避。

## 九、后续可做

1. **手动 `/dream` 流程完善**——加入 MEMORY.md → 搜索可见的验证步骤
2. **FTS5 权重自适应**——查询长度短 → 向量权重高；包含罕见词 → FTS 权重高
3. **MEMORY.md 分段嵌入**——按 `##` section 拆分，每个 section 独立向量
4. **FTS5 query 高亮**——在记忆 tool 输出中显示 `<<命中词>>` 标记
5. **MiMo-Code 风格的全局搜索**——跨项目范围查询（`scope: "all-projects"`）增强
6. **发布到 npm**——fork 成熟后发布独立包

## 十、参考资源

- [opencode-mem 原仓库](https://github.com/tickernelz/opencode-mem) — v2.17.1
- [XiaomiMiMo/MiMo-Code](https://github.com/XiaomiMiMo/MiMo-Code) — FTS5 / dream / distill 灵感来源
- [OpenCode Plugin API](https://opencode.ai/docs/plugins/) — `experimental.*` hook 文档
- [SQLite FTS5 trigram](https://www.sqlite.org/fts5.html#the_trigram_tokenizer) — CJK 友好 tokenizer
- [Node.js node:sqlite](https://nodejs.org/api/sqlite.html) — Node 22.5+ 内置 SQLite

## 十一、致谢

- **tickernelz/opencode-mem** — 优秀的原始插件，本 fork 的全部基础
- **XiaomiMiMo/MiMo-Code** — 记忆系统设计的灵感与可移植代码片段
- **OpenCode 团队** — 提供稳定的 plugin API 与 experimental hooks
- **code-reviewer subagent** — 五轮严格审查，捕获 62 个问题
