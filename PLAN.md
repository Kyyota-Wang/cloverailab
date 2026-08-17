# GRE AWA Agent 项目计划

> 版本 2 —— 已确认：**只做 Issue，砍掉 Argument**；agent 逻辑用 TypeScript。

## 0. 核心结论

**30 个 ETS ground truth 训不出评分模型。** 架构必须是 LLM-as-judge + 显式 ETS rubric + 锚点样本，
语料的作用是**推理时上下文 + 评测集**，不是训练权重。
好处：不需要 GPU、不需要微调、不需要 ML pipeline，单机 + Cloudflare 完全跑得动。

## 1. 数据盘点（Issue-only 视角）

| 资产 | 全量 | Issue-only | 用途 |
|---|---:|---:|---|
| ETS 官方评分范文 | 30 | **18** | Reviewer 锚点 + gold set |
| Magoosh 教师评分 | 8 | **8** | gold set（全部是 Issue） |
| **gold 合计** | 38 | **26** | 覆盖 1.0–6.0，每档 3±1 篇 |
| 社区人评 | 70 | 28 | 弱标签，二级 eval |
| 机器分 (e-grader) | 2009 | — | ❌ 非真分数，仅作文体语料 |
| 真人作文（无分） | 5126 | 3102(总Issue) | 文体真实性 / 检索 |
| 官方题库 | 158+185 | **158** | 题目库 |

**砍掉 Argument 的代价很小**：gold set 从 38 → 26，且 26 篇仍覆盖全部 6 个分档。
Argument 的 12 篇官方范文**保留在 eval 目录**，只用作"分档阶梯排序"的额外校准测试
（ETS 四维评分标准两者高度重叠），不进产品。

⚠️ `Data/.claude/settings.local.json` 与 `Data/Kaggle/API token.txt` 含明文 Kaggle token，进 git 前清除/轮换。

### 抽取过程中发现的既有数据缺陷

**`gre_human_essays.csv` 里 18 篇官方 Issue 范文中，有 7 篇的 `essay_text` 混入了 rater commentary。**
受影响的正好是练习册来源的高分锚点——两篇 score-6、两篇 score-5、一篇 score-4、两篇 score-3。
例如 `ets_practice_test_1_issue_0_score6` 记录 1039 词，实际作文只有 775 词，其余 264 词是评分员评语
（"this response demonstrates facility with the conventions of standard written English"）。

后果如果不修：Reviewer 的最高分锚点里混着评分员的话，会教模型把"像评分员一样说话"当成高分特征。
`tools/extract_anchors.py` 从 PDF 重新抽取并正确分离两者，`tools/validate_kb.py` 里有专门的
断言防止回归。CSV 本身未改动（保留原始归档）。

## 2. 仓库结构

```
GRE writer/
  Data/              # 现有归档，不动（27MB CSV 留本地）
  kb/                # 精选知识库，几百 KB，部署到边缘
    rubric.json          # ETS Issue 四维 × 6 档描述符
    anchors.json         # 18 篇官方范文 + 评语 + 分数
    prompts_issue.json   # 158 题 + instruction 变体分类
    style_exemplars.json # 3 篇 score-6 官方范文（Writer 文体范本）
  packages/
    agent/           # TypeScript —— Reviewer + Writer 核心逻辑
      src/reviewer/ src/writer/ src/providers/ src/prompts/
    eval/            # 评测框架
      gold.jsonl  run.ts  results/
  web/               # Cloudflare Worker + 前端
  tools/             # Python —— 一次性 ETL（仅 Phase 0 用）
```

**关键决策：agent 逻辑直接用 TypeScript 写，Python 只做 Phase 0 的一次性抽取。**
本地 `wrangler dev` 跑的就是上线代码，零重写。

`src/providers/` 是 provider 抽象层：`interface LLMProvider { complete(req): Promise<Resp> }`，
下面挂 `anthropic.ts` 和 `gemini.ts` 两个 adapter。开发期用 Gemini 免费额度迭代，
用 eval harness 做 A/B，用数据决定生产用哪个。

## 3. 分阶段

### Phase 0 — 数据 → 知识库 ✅ 已完成

```bash
cd tools && for s in extract_rubric extract_anchors extract_prompts build_exemplars validate_kb; do python $s.py; done
```

| 文件 | 大小 | 内容 |
|---|---:|---|
| `kb/rubric.json` | 8 KB | ETS Issue Scoring Guide，7 个分档 × 5 条评分轴，两本练习册交叉验证一致 |
| `kb/anchors.json` | 82 KB | 18 篇官方范文 + 18 段 rater commentary + 3 组题目 + ETS 应试策略 |
| `kb/prompts_issue.json` | 139 KB | 158 道官方题 + 6 种 instruction 变体分类 + 每种的必需论证动作 |
| `kb/style_exemplars.json` | 5 KB | Writer 文体简报：锚点引用 + 实测长度/段落分布 + 反模式清单 |
| **合计** | **235 KB** | 全部部署到边缘 |

`tools/validate_kb.py` 断言全部不变量（分档数、锚点分布、评语最短长度、
**评语不得混入作文正文**、变体计数、题目长度区间、provenance 标注）。改任何抽取脚本后必须重跑。

**评分轴是 5 条不是 4 条**（我之前说 4 条不准确）：position / development / organization /
language / conventions。score 1 档 ETS 把 development 和 organization 合并成 4 条，score 0 无条目。

### Phase 1 — Reviewer ✅ 代码完成

`packages/agent/`，TypeScript，Node 24 原生跑 `.ts`（无构建步骤）。**55 个测试全绿。**

| 模块 | 说明 |
|---|---|
| `src/kb.ts` | 知识库加载 + `resolvePrompt()` 按 instruction 判定变体；题目在池中重复出现时**拒绝猜测**而非蒙一个 |
| `src/providers/` | provider 抽象 + Anthropic / Gemini 两个 adapter |
| `src/reviewer/precheck.ts` | 确定性信号层，**零 LLM 调用** |
| `src/reviewer/schema.ts` | 结构化输出 schema，**字段顺序即推理顺序** |
| `src/reviewer/prompt.ts` | prompt 装配 + cache 断点布局 |
| `src/reviewer/index.ts` | 管线 |

三个关键设计决定：

1. **一次调用，用 schema 字段顺序强制推理顺序**：compliance → 逐轴取证 → 锚点对比 → 分数。
   模型按 schema 顺序生成，把 `holisticScore` 放最后，它就无法先拍脑袋给分再倒着编理由
   —— 那正是 LLM judge 最典型的失败模式。拆成 3 次调用贵 3 倍（输出占成本 85%），
   是否值得交给 eval 判断。
2. **机械 0 分不调模型**：空提交、照抄题目是 ETS 明文定义的 0 分，直接短路，不花钱。
3. **cache 不变量有测试保护**：断言 system prefix 逐字节一致、只有一个断点、前缀里无时间戳/UUID。
   这三条任何一条破了，输入成本静默涨 10 倍且没有任何报错。

原设计的四步管线：
1. **确定性预检**（无 LLM）：字数、段落数、**题目指令变体合规性**。
   Issue 题有 6 种 task instruction（"discuss the extent to which you agree"、
   "address the most compelling evidence that could challenge your position" …），
   每种要求不同的论证动作 —— **绝大多数考生失分在这里**，这是最强的差异化功能。
2. **分轴打分**：按 `kb/rubric.json` 的 5 条轴分开打，再合成 holistic。
   ⚠️ 官方范文长度与分数高度相关（score 6 中位 775 词、score 4 中位 392 词、score 1 中位 49 词），
   这是**混淆变量不是评分标准**。prompt 里必须显式禁止把长度当作打分依据。
3. **锚点对比**：给出同分档相邻的两篇官方锚点，问"这篇更接近哪一篇，为什么"。
   这一步是让 LLM judge 不再和稀泥的关键。
4. **结构化输出**：holistic 分 + 置信区间 + 四维分 + ETS 语气评语 + 3 条最高杠杆修改建议。

用 structured outputs（`output_config.format`）保证 JSON 可解析。
**prompt caching 是硬性设计要求**：rubric + anchors + instructions ≈ 9k tokens 在所有请求间完全一致，
必须放在 cache 断点之前，用户作文放在断点之后。这是 10× 的输入成本差别。

### Phase 2 — Eval harness ✅ 代码完成，等 API key 跑第一次校准

```bash
node packages/eval/run.ts                    # 全量 26 篇，leave-one-out
node packages/eval/run.ts --limit 6          # 便宜的冒烟测试（跨分档抽样）
node packages/eval/run.ts --provider gemini  # A/B 对比
```

- gold set = 26 篇（18 ETS + 8 Magoosh），覆盖 1.0–6.0，3 组完整阶梯
- **leave-one-out anchoring（默认开）**：给 18 篇官方范文打分时，把该篇从 grader 自己的锚点
  上下文里剔除。不这么做，等于让模型给一篇它能直接看到官方评语和分数的作文打分，测出来的是
  检索能力不是判断力。代价是每篇一次 cache miss —— eval 偶尔跑，这个交换划算。
- 指标分三层报：**bias（有符号误差，看偏松还是偏严）** / ±0.5 一致率 / **QWK**
  （对随机猜测校正、大错二次惩罚；专门防"永远猜众数 4 分"这种假高分——有测试专门验证这一点）
- **阶梯排序测试**：3 组 1<2<3<4<5<6。这是唯一不受校准偏移影响的指标——统一偏松 1 分的
  grader 仍能通过，所以它单独隔离出"到底能不能分辨档位"这个问题
- 每改一次 prompt 就重跑全套 eval。这是"产品"和"demo"的分界线。

### Phase 3 — Writer（2 天）
核心难点：LLM 写出来的一眼假 —— 太工整、太爱列举、"multifaceted"、"In conclusion"。
对策：
- 用官方 score-6 范文当文体范本 + 显式反模式清单
- 两步：先出提纲（立场 / 3 个论证动作，其中含一个让步反驳 / 具体例证），再成文
- **过 Reviewer 闭环**：低于目标分就带反馈重写，最多 2 轮
- 支持"写一篇 4.0 / 3.0"—— 教学上有用，也顺便产出 eval 数据

### Phase 4 — Cloudflare 部署（3–4 天）
- **Workers** (TS) —— API，SSE 流式返回
- **D1** —— 题库、锚点、用户提交记录
- **KV** —— essay hash → review 结果缓存（同一篇不重复付费）
- **Workers 静态资源** —— 前端
- **Turnstile + 每 IP 限流** —— 防滥用
- LLM 从 Worker 直接 fetch 调用（provider 抽象层同一套代码）

## 4. 成本

### 单次调用（Sonnet 5，含 prompt caching）
| 项 | tokens | 单价 | 成本 |
|---|---:|---|---:|
| 缓存命中输入（rubric+anchors） | 9,000 | $3/M × 0.1 | $0.0027 |
| 新鲜输入（用户作文+prompt） | 1,000 | $3/M | $0.0030 |
| 输出（含 thinking） | 2,500 | $15/M | $0.0375 |
| **Reviewer 单次** | | | **≈ $0.043** |
| Reviewer 3× 自洽 | | | ≈ $0.13 |
| Writer 完整闭环（draft+review+改写+复评） | | | **≈ $0.20** |

用 Opus 5（$5/$25）约为 1.6×：Reviewer 单次 ≈ $0.072。

### 月度
| 场景 | Reviewer 单次 | Reviewer 3× |
|---|---:|---:|
| 1,000 次/月 | $43 | $130 |
| 10,000 次/月 | $430 | $1,300 |

Cloudflare：Workers 付费版 $5/月，D1/KV 在这个量级基本落在免费额度内。

**开发期一次性成本**：Phase 2 校准，约 20 轮 prompt 迭代 × 26 篇 × 3 次 ≈ 1,560 次调用 ≈ **$70**。
加上探索和 Writer 调试，整个开发期预算 **$100–200** 足够。

### 成本优化优先级
1. **Prompt caching**（10× 输入节省）—— 必做
2. **KV 缓存同一篇作文**—— 必做
3. 3× 自洽降为 1× —— 省 66%，代价是分数方差变大。**用 eval 数据决定，别拍脑袋。**
4. 降 effort 等级 —— 输出 token 占成本 85%，thinking 深度是最大变量

## 5. 需要决定 / 待办

- [ ] 是否购买 Anthropic API key（建议：是，$100 预算覆盖整个开发期）
- [ ] 法务边界：爬来的 7k 篇真人作文**不能公开转载**，只能服务端分析或极短引文
- [ ] 清除 Kaggle token
- [ ] （可选）第二 provider：Gemini adapter，用 eval 做 A/B
