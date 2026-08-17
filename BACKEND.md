# 后端交接文档 / Backend Handoff

**给接手前端的人。** 后端已完成并可运行，你不需要读后端代码就能开始做界面。

本文分三部分：**① 你需要的 API 契约** → **② 不要动的设计决定（附原因）** → **③ 已知问题与工作日志**。

最后更新：2026-08-16 · 72 个测试全绿 · `npx tsc --noEmit` 干净

---

# ① API 契约

## 起服务

```bash
npm install
```

```bash
npm run dev
```

→ `http://127.0.0.1:8788`。API key 在项目根目录 `.env`，本地开发用 `web/.dev.vars`（两者都已 gitignore）。

后端是一个 Cloudflare Worker（`web/src/index.ts`）。所有非 `/api/*` 的请求都交给静态资源服务，**目前指向 `web/public/`**。你可以整个替换那个目录，或者改 `web/wrangler.jsonc` 里的 `assets.directory` 指向你的构建产物。

## 端点总览

| 端点 | 方法 | 耗时 | 成本 | 用途 |
|---|---|---:|---:|---|
| `/api/topics` | GET | <10ms | $0 | 158 道官方题 |
| `/api/resolve` | POST | <10ms | $0 | 识别任务变体 |
| `/api/precheck` | POST | ~60ms | $0 | 确定性文本信号 |
| `/api/review` | POST | **60–90s** | ~$0.15 | 批改作文 |
| `/api/write` | POST | **40–105s** | ~$0.15 | 生成范文 |
| `/api/chat` | POST | ~5s | ~$0.01 | 对结果追问 |

**前三个免费且瞬时，后三个慢且花钱。** 界面设计的核心矛盾就在这条线上，见 §2。

错误一律是 `{ "error": "人类可读的英文说明" }`。**400 = 用户可自行修正**（缺 key、题目变体无法识别、目标分数非法），**500 = 后端问题**。错误文案是写给人看的，可以直接显示。

---

## `GET /api/topics`

```jsonc
{
  "topics": [{
    "id": "issue_de5d023168",
    "statement": "Governments should place few, if any, restrictions on...",
    "instruction": "Write a response in which you discuss the extent to which...",
    "variant": "recommendation",              // 六种之一
    "variantSummary": "Agree/disagree with a recommendation, argued through...",
    "requiredMoves": ["State a position...", "Describe...", "Describe..."]
  }],
  "variantCounts": { "statement": 53, "claim_challenge": 26, "claim_and_reason": 25,
                     "recommendation": 23, "two_views": 20, "policy": 11 }
}
```

六种变体：`statement` `claim_challenge` `claim_and_reason` `recommendation` `two_views` `policy`。

## `POST /api/resolve`

用户粘贴自定义题目时，**边打字边调用**（建议 debounce 400ms）。免费。

```jsonc
// 请求
{ "statement": "...", "instruction": "Write a response in which..." }
// 或 { "statement": "...", "variant": "two_views" }

// 响应
{ "prompt": { "statement": "...", "instruction": "...", "variant": "two_views",
              "requiredMoves": ["...", "...", "..."] },
  "variantSummary": "Choose between two opposing views and defend the choice." }
```

**识别不出会返回 400**，文案已经写好可以直接显示。这是有意的——见 §2.3。

## `POST /api/precheck`

确定性信号，**零 LLM 调用**。

```jsonc
// 请求
{ "statement": "...", "instruction": "...", "essay": "作文全文" }

// 响应
{ "precheck": {
    "wordCount": 502, "paragraphCount": 5, "sentenceCount": 28,
    "meanSentenceWords": 17.9, "sentenceLengthStdev": 8.3,
    "promptOverlap": 0.33,                    // 0–1，与题目的内容词重合度
    "opensByRestatingPrompt": false,
    "concessionMarkers": ["however", "critics"],      // 让步/反驳标记
    "specificityMarkers": ["Asilomar", "1975"],       // 专名/年份/数据
    "formulaicMarkers": ["firstly", "in conclusion"], // 模板化措辞
    "flags": ["extremely_short"]              // 见下
  },
  "formatted": "已排版的多行文本，可直接显示",
  "prompt": { /* 同 resolve */ } }
```

`flags` 可能值：`empty` `off_topic` `extremely_short` `single_paragraph` `copies_prompt`

## `POST /api/review` ⏱️ 60–90 秒

```jsonc
// 请求
{ "statement": "...", "instruction": "...", "essay": "...",
  "effort": "high" }   // 可选：low|medium|high|xhigh|max，默认 high

// 响应
{ "review": {
    "compliance": {                    // ★ 产品核心价值，见 §2.1
      "variant": "claim_challenge",
      "moves": [{ "move": "State a position on the claim.",
                  "addressed": true,
                  "evidence": "引自原文的证据或缺失说明" }]
    },
    "axisAssessments": [               // 固定 5 条，顺序固定
      { "axis": "position",     "score": 5, "evidence": "原文引用", "reasoning": "..." },
      { "axis": "development",  "score": 4, "evidence": "...", "reasoning": "..." },
      { "axis": "organization", "score": 5, "evidence": "...", "reasoning": "..." },
      { "axis": "language",     "score": 5, "evidence": "...", "reasoning": "..." },
      { "axis": "conventions",  "score": 6, "evidence": "...", "reasoning": "..." }
    ],
    "anchorComparison": {
      "closestAnchorId": "practice_test_3_score6",
      "relativePosition": "level",     // above | level | below
      "comparedWith": ["...", "..."],
      "reasoning": "..."
    },
    "holisticScore": 4.5,              // ⚠️ 已知偏严，见 §2.2
    "confidenceRange": [4.0, 5.0],
    "raterCommentary": "ETS 评分员语气的评语，150–300 词",
    "suggestions": [{ "priority": 1, "axis": "development",
                      "problem": "...", "fix": "...", "example": "改写示例" }]
  },
  "precheck": { /* 同上 */ },
  "prompt": { /* 同上 */ },
  "samples": [4.5],                    // 多次采样时的各次分数
  "usage": { "provider": "anthropic", "model": "claude-sonnet-5",
             "inputTokens": 0, "cachedInputTokens": 21518,
             "cacheWriteTokens": 0, "outputTokens": 3200, "calls": 1 },
  "estimatedCostUsd": 0.152 }
```

五个轴的含义：`position` 立场与任务合规 · `development` 论证展开 · `organization` 结构组织 · `language` 语言表达 · `conventions` 语法规范。

**特例**：空提交或照抄题目会返回 `holisticScore: 0`，**且 `usage.calls === 0`**（不调模型、不花钱）。此时 `axisAssessments` 是空数组，渲染时要处理。

## `POST /api/write` ⏱️ 40–105 秒

```jsonc
// 请求
{ "statement": "...", "instruction": "...",
  "targetScore": 6,          // 3 | 3.5 | 4 | 4.5 | 5 | 5.5 | 6，默认 6
  "guidance": "反对这个观点" } // 可选自由文本

// 响应
{ "plan": {
    "position": "一句话立场",
    "moveCoverage": [{ "move": "...", "plan": "打算怎么做到" }],
    "bodyParagraphs": [{ "claim": "...", "example": "具体例证", "role": "在论证中的作用" }],
    "concession": "最强反方论据 + 如何回应"
  },
  "essay": "正文，段落之间是空行",
  "notes": { "targetScore": 6,
             "whyThisScores": "为什么这是 6 分",
             "ifAimingHigher": "要更高还差什么 / 6 与 5 的分界" },
  "prompt": { /* 同上 */ },
  "wordCount": 819,
  "usage": { /* 同上 */ },
  "estimatedCostUsd": 0.174 }
```

**最有说服力的界面**：同一道题生成 6 分和 4 分并排对比。差距不依赖任何分数校准，读者自己就能判断。

## `POST /api/chat`

对已有结果追问。**不加载锚点和评分标准**，所以比产生它的那次调用便宜约 20 倍。

```jsonc
// 请求
{ "context": "前一次结果的完整文本（题目+作文+评估 JSON）", "question": "用户的问题" }

// 响应
{ "answer": "...", "usage": { ... }, "estimatedCostUsd": 0.008 }
```

**无服务端状态**。上下文由客户端携带，你决定放什么进去。参考 `web/public/index.html` 里 `lastContext` 的拼法。

---

# ② 不要动的设计决定

## 2.1 合规性检查是产品的核心，不是附属信息

六种任务变体要求的论证动作**实质不同**：

- `two_views` 要求**同时处理两个给定观点**，只论证自己选的那个就是失败
- `claim_and_reason` 要求对 claim 和 reason **分别表态**（一个 claim 可以对，但理由是错的）
- `claim_challenge` 要求**正面回应最强反方论据**，提一句绕过去不算

**绝大多数考生失分在这里**，而市面上的评分工具几乎都不做这件事——它们只看文章写得好不好。

这也是唯一**不依赖分数校准**的判断：「你没做到这道题要求的第二个动作」对不对，读者一眼能验证。

**界面上它应该比分数更显眼。**

## 2.2 分数已知偏严，必须如实呈现

在 26 篇有人工评分的作文上实测：

| | ETS 官方 18 篇 | **Magoosh 8 篇（真 held-out）** |
|---|---:|---:|
| bias | −0.33 | **−0.81** |
| QWK | 0.825 | **0.448** |

第二列才是真实水平。**三篇 ETS 官方满分作文，模型给出 5.0 / 4.5 / 5.5——一个 6 都没给过。**

现有界面的处理方式（建议保留）：
1. 分数**带置信区间**显示，不是一个孤零零的数字
2. 分数下方有一段明确说明：偏严 0.5–0.8 分、高分段压缩、**请以合规性检查和逐轴取证为准**
3. 视觉层级上，合规性检查在分数**之前**

理由很实际：合作者拿一篇好作文试出 4.5 分然后自己发现问题，比我们主动坦白要糟糕得多。

## 2.3 变体识别不出时必须报错，不能猜

猜错变体 → 整个合规性检查基于错误前提 → 产品最有价值的部分变成误导。

宁可让用户补一句任务指令。实践中不成问题：GRE 真题的指令就是那六段固定文字。

## 2.4 免费的确定性层要抢在付费层前面显示

`/api/precheck` 60 毫秒返回真实分析。批改要等 60–90 秒。

**现有界面：点批改 → 立刻显示预检结果 → 模型评分在后台跑。** 用户看到的是真实内容，不是转圈。这个模式建议保留，或者做得更好（比如流式）。

## 2.5 不要在 system prompt 里放会变的东西

后端靠 prompt 缓存把输入成本降到约 1/10。缓存要求 system 前缀**逐字节一致**。塞进任何时间戳、用户 ID、随机数都会静默失效——**不报错，只是成本涨 10 倍**。

已有测试守这条不变量（`packages/agent/test/reviewer.test.ts`）。前端不碰这块，但如果你要加「用户偏好」之类的功能，务必让它走 user message，不要走 system。

---

# ③ 已知问题与工作日志

## 现在没做的（前端可能需要）

| 缺口 | 影响 |
|---|---|
| **无鉴权、无限流** | 部署成公开地址 = 任何人都能烧 API 额度。**上线前必须加。** |
| **无流式输出** | 60–90 秒只能等。加 SSE 是明显的体验改进，需要改 provider 层。 |
| **无持久化** | 刷新即丢。需要 D1（提交记录）+ KV（同一篇作文的结果缓存）。 |
| **无 Argument 任务** | 2023-09-22 已停考，有意不做。 |
| **Writer 无质量闭环** | 原设计是 起草→评分→改写，因为评分器偏严会把范文改坏，**故意关掉的**。校准修好后再开。 |

## 三个悬而未决的问题

**1. 评分器高分段压缩，prompt 层面已试过一轮，无效。**

试过明确告诉模型「满分是真实档位、锚点里就有三篇 ETS 打的 6 分」。改前改后 MAE 都是 0.72，全在噪声范围内。

剩余方向：换 Opus 5（可能是模型能力问题）、少样本推理示范、事后校准映射。**每跑一轮全量评测约 $5、40 分钟。**

**2. 评分器可能有自我偏好偏差。**

拿评分器批改生成器自己写的范文 → **给了 6.0，五轴全 6**。这是它唯一一次给 6 分。对真人 ETS 满分作文从来没给过。

三种可能，我认为都有份：LLM 评委偏爱 LLM 文风（有文献记载）、长度混淆（991 词 vs ETS 的 627–933）、以及——

**3. 生成的范文可能不够像考场作文。**

实测一篇引用了 Dickey 修正案、Fouchier 的 H5N1 实验、NSABB 删改建议、Tuskegee 起止年份、英国新冠人体挑战试验批准月份。**真实考生 30 分钟内不可能调用这种密度的材料。**

作为结构示范是好的，作为「你该写成这样」的目标不现实。可以在 prompt 里限制例证范围来修。

⚠️ **另外：范文里全是具体的人名年份数据。** 抽查过的都对，但**错误事实会被学生照抄**。界面上建议加免责说明，上线前应考虑事实核查。

## 成本实测（重要修正）

我早期报的成本数字**错了 3.4 倍**，因为漏统计了 `cache_creation_input_tokens`——冷缓存时绝大部分输入记在这一项里。已修复。

真实数字：

| 场景 | 单次 |
|---|---:|
| 批改（缓存命中） | **$0.146** |
| 批改（冷缓存 / 评测模式） | $0.216 |
| 生成范文（缓存命中） | ~$0.08 |
| 追问 | ~$0.01 |

**输出 token 占成本 85%**，所以真正的成本旋钮是 `effort` 等级，不是输入长度。

## 数据资产

| 目录 | 内容 |
|---|---|
| `kb/` (235 KB) | 部署到边缘的知识库：ETS 评分标准 · **18 篇官方范文 + 官方评分员评语** · 158 道官方题及变体分类 · 文体范本与反模式清单 |
| `Data/` (465 MB) | 原始语料归档，7,243 篇真人作文。**已 gitignore**（体积 + 抓取内容的转载风险） |
| `测试集合/` | 评测集，按打分人分四层。**已 gitignore**（同上） |
| `packages/eval/results/` | 历次评测结果 JSON |

**⚠️ 已经咬过三次的坑**：`Data/gre_human_essays.csv` 里 18 篇官方 Issue 范文有 **7 篇混入了评分员评语**（`practice_test_1_score6` 记录 1039 词，实际正文 774 词）。**永远从 `kb/anchors.json` 取官方范文，不要从 CSV 取。**

## 命令

```bash
npm run dev        # 本地起服务 (127.0.0.1:8788)
npm test           # 72 个测试
npm run typecheck  # tsc --noEmit
npm run eval       # 全量 26 篇评测（约 $5、40 分钟）
npm run deploy     # 部署到 Cloudflare
```

重建知识库 / 测试集（改了 PDF 抽取逻辑才需要）：

```bash
cd tools && python extract_rubric.py && python extract_anchors.py && python extract_prompts.py && python build_exemplars.py && python validate_kb.py && python build_testsets.py
```

## 技术栈约束

- **Node 24+**，直接跑 `.ts`，**无构建步骤**
- ⚠️ Node 的类型剥离模式**不支持**构造函数参数属性、`enum`、`namespace`——用了会在 import 时崩，不是编译期报错
- Worker 里**没有文件系统**。Node 专属逻辑隔离在 `kb-node.ts` / `env-node.ts`，Worker 走 `web/src/kb.ts` 的编译期 JSON 注入。**不要在被 Worker 引用的模块顶层调用 `fileURLToPath` 或 `node:fs`**（踩过，Worker 启动即崩）
- 结构化输出**不支持** `minimum` `maximum` `multipleOf` `minLength` `maxLength` `maxItems`、以及大于 1 的 `minItems`。所以「必须有 5 个轴」是用 5 个 required 属性实现的，不是数组长度约束。有测试专门守这条

## 现有前端的定位

`web/public/index.html` 是**单文件参考实现**，没有框架、没有构建。

它不是要保留的成品——**你可以整个替换**。但里面有四个行为是设计决定不是随手写的，替换时请保留：

1. 预检结果抢在评分之前显示（§2.4）
2. 分数带置信区间 + 偏严说明（§2.2）
3. 合规性检查在视觉层级上先于分数（§2.1）
4. 自定义题目边打字边调 `/api/resolve` 实时反馈（§2.3）
