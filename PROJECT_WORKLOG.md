# CloverAI Lab — GRE AWA 项目工作日志与交接说明

最后更新：2026-08-18

这份文档面向后续接手项目的 AI 或开发者。开始工作前应先读本文，再读 `BACKEND.md`（API 契约与后端设计决定）和 `PLAN.md`（数据与阶段规划），然后检查 `web/wrangler.jsonc` 与最新 Git 提交。本文不包含任何密钥值。

---

## 1. 项目定位

一个 GRE Analytical Writing（**只做 Issue 题，不做 Argument**）的批改与范文生成工具，对外身份是 **CloverAI Lab / cloverailab.com**。

产品的核心差异化**不是分数**，是**任务合规性检查**：Issue 题有六种 task instruction 变体，每种要求的论证动作实质不同，绝大多数考生失分在这里，而市面上的评分工具几乎都不做这件事。分数是附带的，而且已知偏严（见 §6）。

Argument 任务 2023-09-22 已停考，有意不做。

## 2. 当前状态摘要

| 项 | 状态 |
|---|---|
| 知识库（kb/） | 完成，235 KB，`tools/validate_kb.py` 守全部不变量 |
| Reviewer | 完成，可用 |
| Writer | 完成，可用；draft→review→revise 闭环**故意关闭**（见 §6） |
| Eval harness | 完成，已跑过校准 |
| 前端 | **2026-08-16 重建完成**，Vite + React + TS，见 §4 |
| 品牌 / Logo | 完成，见 §5 |
| 测试 | 72/72 通过，`npm run typecheck` 与 `npm run typecheck:ui` 干净 |
| 鉴权 / 限流 | Turnstile + 每 IP 限流已上线并实测，见 §9 |
| Cloudflare 部署 | **已上线**，见 §9.1 |

## 3. 仓库与版本

- Repository：`Kyyota-Wang/cloverailab`
- Branch：`main`

**⚠️ 这个仓库必须保持 private。** `kb/anchors.json` 收录了 18 篇 ETS 官方评分范文及官方评分员评语，`kb/prompts_issue.json` 收录 158 道官方题。这些是 ETS 的版权材料，可以内部使用，不能公开转载。转 public 之前必须先把 `kb/` 从仓库中剥离（但注意 `web/src/kb.ts` 是编译期 JSON 注入，剥离会破坏构建，需要改成运行时从 KV/R2 加载）。

已 gitignore 且**不进仓库**的资产（都在本地）：

| 目录 | 体积 | 原因 |
|---|---:|---|
| `Data/raw_cache/` `Data/argugpt_raw/` `Data/out/` | ~569 MB | 原始语料归档，体积 + 抓取内容的转载风险 |
| `测试集合/` | 6.4 MB | tier2–4 是抓来的论坛作文，不可转载 |
| `.env` `web/.dev.vars` | — | 密钥 |
| `web/dist/` `node_modules/` `.wrangler/` | — | 构建产物与依赖 |

丢失 `Data/` 不影响产品运行，只影响重新生成知识库；用 `tools/extract_*.py` 可重新导出，但需要原始 PDF。

## 4. 技术架构

### 后端（未改动，2026-08-16 前完成）

- Cloudflare Worker，入口 `web/src/index.ts`
- **Node 24+，直接跑 `.ts`，无构建步骤**（Worker 侧由 wrangler 打包）
- `packages/agent/` 是全部 agent 逻辑：`kb.ts` / `providers/` / `reviewer/` / `writer/`
- provider 抽象层下挂 `anthropic.ts` 和 `gemini.ts`
- Worker 里**没有文件系统**。知识库由 `web/src/kb.ts` 在编译期注入；Node 专属逻辑隔离在 `kb-node.ts` / `env-node.ts`
- 无持久化。追问的上下文由客户端携带

六个端点（完整契约见 `BACKEND.md` §1）：

| 端点 | 耗时 | 成本 |
|---|---:|---:|
| `GET /api/topics` | <10ms | $0 |
| `POST /api/resolve` | <10ms | $0 |
| `POST /api/precheck` | ~60ms | $0 |
| `POST /api/review` | **60–90s** | **~$0.15** |
| `POST /api/write` | **40–105s** | **~$0.15** |
| `POST /api/chat` | ~5s | ~$0.01 |

前三个免费且瞬时，后三个慢且花钱。这条线是所有界面和安全决策的分界。

### 前端（2026-08-16 重建）

- 源码 `web/app/`（Vite root），构建产物 `web/dist/`，Worker 从那里读静态资源
- Vite 8 + React 19 + TypeScript，配置在 `web/vite.config.ts`
- **不用 Tailwind**（通用感强，品牌视觉控制力弱），不用路由，不用状态库
- 设计系统在 `web/app/src/styles/tokens.css`：从品牌绿推导的完整色阶 + 带绿灰的中性色 + 语义色。深浅两套，`prefers-color-scheme` 默认，`<html data-theme>` 显式覆盖
- 字体用精调的系统字体栈：UI 用 grotesk，作文正文用 serif（长文本可读性）。未自托管字体
- 中英双语，自建轻量 i18n（`web/app/src/i18n/`，React context + 两个 typed 字典）。**只翻译界面文案，模型产出（评语、范文、题目）保持英文** —— 考的就是英文写作，翻成中文有害

前一版单文件参考实现 `web/public/index.html` 仍在仓库里，已不再被服务（`assets.directory` 现在指向 `./dist`）。它是初始提交的一部分，可以随时删除，Git 里留有记录。

## 5. 品牌

图形的全部定义是一个基本形重复四次，设计语言参考 clover.com：

- 叶片：半径 46 的圆，朝向中心的那个象限切成 90° 直角 → `M100,54 A46,46 0 1,0 54,100 L100,100 Z`（viewBox `0 0 200 200`，中心 `100,100`）
- 四片 = 同一路径 `rotate(90/180/270)`，每片沿自身对角线向外推 5 单位，整体 `scale(0.95)`，中心留一个细十字缝
- 右上叶片里**镂空**三条作文行（用 `mask`，不是画白线 —— 所以任何底色上都成立）
- 主标无茎（`<Logo />`）；弯茎版（`<Logo stem />`）供大图和印刷用
- `web/app/public/favicon.svg` 是**小尺寸专版**：作文行减为两条、加粗、间距拉开。三条行在 20px 下会糊，这是必须的单独优化

品牌色：`#3bb86e`（浅底）/ `#4ed68c`（深底）。比 clover.com 的荧光绿 `#b6fb6f` 压暗 —— 那套配色适合 POS 硬件品牌，对评测工具太活泼。

**待办**：`apple-touch-icon` 和 `og:image` 目前只有 SVG。iOS Safari 不认 SVG 的 apple-touch-icon，Facebook/Twitter 也不抓 SVG 的 og:image，上线前需要栅格化成 PNG。

## 6. 不可动的设计决定

`BACKEND.md` §2 有完整论证。四条与界面直接相关，改前端时必须保留：

1. **合规性检查在视觉层级上先于分数。** 它是唯一不依赖分数校准的判断，读者能拿自己的作文一眼验证。
2. **分数必须带置信区间 + 偏严说明，且不折叠不淡化。** 实测：ETS 官方 18 篇 bias −0.33 / QWK 0.825；Magoosh 8 篇（真 held-out）bias **−0.81** / QWK **0.448**。第二列才是真实水平。**三篇 ETS 官方满分作文，模型给出 5.0 / 4.5 / 5.5 —— 一个 6 都没给过。** 合作者拿一篇好作文试出 4.5 然后自己发现问题，比主动坦白糟糕得多。
3. **免费预检抢在付费评分前显示。** 点批改 → 60ms 出真实分析 → 评分在后台跑。用户看到的是内容不是转圈。
4. **变体识别不出必须报错，不能猜。** 猜错变体 → 合规性检查基于错误前提 → 产品最有价值的部分变成误导。后端 400 的文案是写给人看的，前端直接显示。

另外两条：

- **不要在 system prompt 里放会变的东西。** 输入成本靠 prompt caching 降到约 1/10，缓存要求 system 前缀逐字节一致。塞时间戳/用户 ID/随机数会**静默失效，不报错，成本涨 10 倍**。有测试守这条。加"用户偏好"之类功能务必走 user message。
- **`holisticScore: 0` + `axisAssessments: []` + `usage.calls === 0` 是合法响应**（空白提交或照抄题目，ETS 明文定义的 0 分，短路不调模型）。渲染必须单独处理，不能崩。

### 三个悬而未决的问题

1. **评分器高分段压缩，prompt 层面已试过一轮无效。** 明确告诉模型"满分是真实档位、锚点里就有三篇 ETS 打的 6 分"，改前改后 MAE 都是 0.72。剩余方向：换 Opus 5、少样本推理示范、事后校准映射。每跑一轮全量评测约 $5、40 分钟。
2. **评分器可能有自我偏好偏差。** 拿它批改生成器自己写的范文 → 给了 6.0，五轴全 6。这是它唯一一次给 6 分。
3. **生成的范文可能不够像考场作文。** 实测一篇引用了 Dickey 修正案、Fouchier 的 H5N1 实验、Tuskegee 起止年份。真实考生 30 分钟内不可能调用这种密度的材料。作为结构示范可以，作为"你该写成这样"不现实。

Writer 的 draft→review→revise 闭环因为第 1 条**故意关闭** —— 偏严的评分器会把范文改坏，且难以察觉。校准修好后再开。

## 7. 环境变量与密钥

变量名（值见本地文件，绝不写进文档或 Git）：

- `ANTHROPIC_API_KEY`
- `GEMINI_API_KEY`（可选，开发期用免费额度迭代）
- `LLM_PROVIDER` / `REVIEWER_MODEL` / `WRITER_MODEL`

位置：

- 本地 Node 脚本（eval 等）：项目根 `.env`，模板 `.env.example`
- 本地 `wrangler dev`：`web/.dev.vars`
- 生产：Cloudflare Worker Secrets（`npx wrangler secret put ANTHROPIC_API_KEY`）

两者都已 gitignore。任何 AI 不得打印密钥值、写入日志、提交到 Git，或把 server secret 放进浏览器代码。

**注意**：`C:/Users/kangc/OneDrive/Documents/pumpkinsolve/` 是另一个项目（Pumpkin AI），它也有 `GEMINI_API_KEY`。两个项目的环境文件不能互相参照判断配置是否正确。

## 8. 本地开发与测试

```powershell
cd "C:\Users\kangc\OneDrive\Documents\cc_sandbox\GRE writer"
```

```powershell
npm run dev          # 构建前端 + wrangler dev，最终形态在 http://127.0.0.1:8788
npm run dev:ui       # Vite 热更新（5173），API 代理到 8788，日常迭代用这个
npm run build        # 只构建前端到 web/dist
npm test             # 72 个测试
npm run typecheck    # 后端 tsc --noEmit
npm run typecheck:ui # 前端 tsc --noEmit
npm run eval         # 全量 26 篇评测（约 $5、40 分钟）
npm run deploy       # 构建 + 部署到 Cloudflare
```

重建知识库（只在改了 PDF 抽取逻辑后需要）：

```powershell
cd tools; python extract_rubric.py; python extract_anchors.py; python extract_prompts.py; python build_exemplars.py; python validate_kb.py; python build_testsets.py
```

## 9. 滥用与成本保护（2026-08-16 实现）

完整契约见 `BACKEND.md` §1.5。方案照搬 Pumpkin AI 的做法。

`/api/review` `/api/write` `/api/chat` 在**碰到 provider 之前**过两道关，顺序是先限流（本地、免费）后 Turnstile（要网络往返）：

1. **每 IP 限流**（Cloudflare Rate Limiting binding，key 为 `端点:CF-Connecting-IP`）
   - `PAID_LIMIT`：review + write，3 次 / 60 秒
   - `LIGHT_LIMIT`：chat + precheck + resolve，20 次 / 60 秒
2. **Turnstile**：Worker 端 siteverify，除 `success` 外校验 `action`（必须等于端点名）和 `hostname`（必须等于请求域名）。Token 一次性，前端每次请求现铸。

**fail closed**：`REQUIRE_TURNSTILE=true` 时缺 `TURNSTILE_SECRET` 直接 500。这是唯一一种「看起来正常但付费端点裸奔」的失效模式，必须让它响。本地开发在 `.dev.vars` 里设 `false` 跳过。

⚠️ **Rate Limiting binding 是边缘位置级、最终一致的限制，不是精确的全局计费器。**

2026-08-17 生产实测（`PAID_LIMIT` 配置 3/60s、`LIGHT_LIMIT` 配置 20/60s）：

| 测试 | 结果 |
|---|---|
| 连发 5 次 `/api/review` | **0 次被拦** |
| 连发 15 次 `/api/review` | 放行 11、拦截 4 |
| 连发 30 次 `/api/precheck` | **0 次被拦** |

本地 `wrangler dev` 里同样的配置是**精确**的（第 4 次就 429）。也就是说**本地测出来的限流数字不能代表生产**。

结论：把它当成抗持续滥用的兜底，不要当成每分钟闸门。真正的硬闸是两个：

1. **Turnstile** —— 每个请求单独验证，无 token / 伪造 token 一律 403，这是确定性的
2. **Anthropic 账户余额上限** —— 当前是预付 $20 且未开 auto-reload，所以最坏损失有硬顶

配置的数字可以调得比想要的效果更严（比如想要 5/分钟就配 3/分钟），因为实际生效值总是更松。

### 9.1 生产部署

| 项 | 值 |
|---|---|
| Worker 名 | `cloverailab` |
| 地址 | `https://cloverailab.pumpkin-ai-v2.workers.dev` |
| 首次部署 version | `d4367c2b-2205-4d21-9b1b-88c7be5e9aac`（无 Turnstile site key，付费端点 fail closed） |
| 当前 version | `25bcf25b-3146-451f-8fa7-c835222d72df` |
| Turnstile widget | Managed 模式，hostname 白名单含 workers.dev 地址 + `cloverailab.com` + `www.cloverailab.com` |
| 正式地址 | **https://www.cloverailab.com** 与 **https://cloverailab.com**，两个都在服务同一个站 |
| 域名绑定方式 | 主域名是 `custom_domain`（Cloudflare 自动管 DNS 与证书）；www 是普通 **route** `www.cloverailab.com/*` + 一条手建的代理 AAAA 记录指向 `100::` |

**为什么 www 用 route 而不是 custom_domain**：面板的 Connect domain 对话框做的是**精确 zone 匹配**，输入子域名会报 "No zones match"，加不进去。Route 表单没有这个毛病。但 route **不会创建 DNS 记录**，这才是 www 一开始完全连不上的真正原因 —— 那个主机名在 DNS 上根本不存在。所以 route 必须配一条自己的代理记录（AAAA → `100::`，Cloudflare 官方的「只走边缘」占位地址，永远不会真的收到流量）。

用 wrangler 部署则没有这个问题：`custom_domain: true` 走 API，不经过那个对话框，而且会连 DNS 记录一起建。**这两步本来一条 `npm run deploy` 就够，是因为 Node 当时不在（见 §10.1）才改用面板手工操作的。**

`pumpkin-ai-v2` 是**账号级的 workers.dev 子域名**，不是项目名 —— 账号下每个 Worker 都是 `<worker名>.pumpkin-ai-v2.workers.dev`。改它会同时改掉 Pumpkin AI 的地址，不要动。绑定自定义域名后可以把 workers.dev 路由关掉。

2026-08-17 线上实测结果：

- 页面、`/api/topics`（158 题）、`/api/precheck` 正常
- `/api/review` 无 token → 403；伪造 token → 403（siteverify 真实拒绝，证明 `TURNSTILE_SECRET` 已设且有效）
- 真实浏览器端到端：Turnstile 脚本加载 → 铸 token → siteverify 通过 → 后端 200
- 照抄题目的机械 0 分路径：`usage.calls === 0`、`estimatedCostUsd === 0`，界面显示「未调用模型 · 零成本」

2026-08-18 两个自定义域名上线后复测，`cloverailab.com` 与 `www.cloverailab.com` 均：证书有效、158 题正常、无 token 的 `/api/review` 返回 403、真实浏览器铸出的 token 通过 siteverify 的 **hostname 校验**并拿到 200。hostname 校验是换域名时唯一真正有风险的一条（Worker 要求 token 解出的域名严格等于请求域名），两个域名都成立。
- **尚未验证**：`ANTHROPIC_API_KEY` 是否已设。机械 0 分路径在碰 provider 之前就短路了，而 `createProvider` 缺 key 也不抛错（构造函数会回退去找 OAuth profile），所以那次 200 证明不了这一点。要确认只有两条路：面板上看 secret 列表，或者跑一次真实批改（约 $0.15）

以下仍未做，视情况再评估：

- 用户账号 / 配额（当前任何通过验证的人都能用）
- KV 或 D1 的日级别用量上限（binding 只支持 10 秒和 60 秒窗口）
- 匿名用量统计（Pumpkin AI 用 D1 做了一套，可以搬）

## 10. 已踩过的工程坑

### 10.1 Node 不在 PATH 里，而且消失过一次

**当前路径（2026-08-18 重装后）：**

```
C:\Users\kangc\AppData\Local\Microsoft\WinGet\Packages\OpenJS.NodeJS.LTS_Microsoft.Winget.Source_8wekyb3d8bbwe\node-v24.19.0-win-x64
```

**它不在系统 PATH 上**（winget 提示改了 PATH，但新开的 shell 里仍然看不到）。每次命令前要加：

```bash
export PATH="/c/Users/kangc/AppData/Local/Microsoft/WinGet/Packages/OpenJS.NodeJS.LTS_Microsoft.Winget.Source_8wekyb3d8bbwe/node-v24.19.0-win-x64:$PATH"
```

```powershell
$env:PATH = "$env:LOCALAPPDATA\Microsoft\WinGet\Packages\OpenJS.NodeJS.LTS_Microsoft.Winget.Source_8wekyb3d8bbwe\node-v24.19.0-win-x64;$env:PATH"
```

**历史**：原本装在 `C:\Users\kangc\AppData\Local\nodejs`，同样不在 PATH 上。**2026-08-17 那个目录整个消失了** —— 同一天早些时候还能正常 `npm install` / `npm run deploy`，之后 `Test-Path` 与 `where.exe node` 都找不到，其它常见位置（Program Files、nvm、fnm、volta、scoop）也都没有。原因未查明，未做任何卸载操作。

期间影响：**已上线的 Worker 完全不受影响**（它跑在 Cloudflare 上），但本地 `npm run build` / `npm test` / `npm run deploy` / `wrangler` 全部不可用，持续约一天。

2026-08-18 用 `winget install OpenJS.NodeJS.LTS --scope user` 重装 24.19.0（与消失的那份同版本）。`node_modules` 未受影响，不需要重新 `npm install`。恢复后 72/72 测试通过、两个 typecheck 均干净。

⚠️ 如果再次出现 `node: command not found`，先按上面的路径找，再考虑重装 —— 不要假设它还在老位置。

### 10.2 `wrangler dev` 在启动时给 `web/dist` 拍快照

运行中重新构建前端，服务器**认不到新文件**，浏览器会拿到旧的 `index.html` 引用已不存在的 hash 资源，页面白屏、资源 404。改完前端必须**重启** wrangler，或者日常迭代改用 `npm run dev:ui`（Vite 热更新）。踩过一次，白排查了十几分钟。

### 10.3 Cloudflare Dashboard 登录不等于 Wrangler CLI 授权

（沿用 Pumpkin AI 的记录）必须跑 `npx wrangler login`，浏览器出现 `Authorization granted to Wrangler`，终端出现 `Successfully logged in`。Wrangler 可能询问是否安装 Cloudflare skills，与 OAuth 授权无关，不装也能部署。

### 10.4 只断言 DOM 文字内容查不出排版 bug

`PromptCard.tsx` 的必做动作列表曾经一个词一行：`li` 是 `grid-template-columns: 20px 1fr` 两列，但里面有三个子项（CSS 计数器 `::before` + 一个多余的空 `<span />` + 文字 span），第三个溢出到第二行第一列，即 20px 宽的那列。

当时的自动检查读 `textContent` 完全正确，所以判定通过。**排版是几何问题，内容检查看不见。**

现在的检查方式是遍历元素量几何，找三类问题：装着 15 字符以上却宽度不足 90px 的盒子、`scrollWidth > clientWidth` 的、右边界超出视口的。复杂组件（评分结果、范文结果）用构造数据渲染出来再量。

### 10.5 Git dubious ownership

Windows + OneDrive 路径可能触发 `detected dubious ownership`。不要全局改配置，对单条命令用：

```powershell
git -c safe.directory="C:/Users/kangc/OneDrive/Documents/cc_sandbox/GRE writer" status
```

### 10.6 Node 类型剥离模式的限制

Node 直接跑 `.ts` **不支持**构造函数参数属性、`enum`、`namespace`。用了会在 import 时崩溃，不是编译期报错。

### 10.7 结构化输出的 schema 限制

不支持 `minimum` `maximum` `multipleOf` `minLength` `maxLength` `maxItems`，以及大于 1 的 `minItems`。所以"必须有 5 个轴"是用 5 个 required 属性实现的，不是数组长度约束。有测试专门守这条。

### 10.8 永远从 `kb/anchors.json` 取官方范文

`Data/gre_human_essays.csv` 里 18 篇官方 Issue 范文有 **7 篇混入了评分员评语**（`practice_test_1_score6` 记录 1039 词，实际正文 774 词）。不修的后果：Reviewer 的最高分锚点里混着评分员的话，会教模型把"像评分员一样说话"当成高分特征。已经咬过三次。

### 10.9 成本统计漏项

早期报的成本数字错了 3.4 倍，因为漏统计 `cache_creation_input_tokens` —— 冷缓存时绝大部分输入记在这一项。已修复。真实数字：批改缓存命中 $0.146、冷缓存 $0.216。**输出 token 占成本 85%**，所以真正的成本旋钮是 `effort` 等级，不是输入长度。

## 11. 部署检查表

1. `git status` 确认没有意外改动，且 `.env` / `web/.dev.vars` 未被跟踪
2. `npm run typecheck` 和 `npm run typecheck:ui`
3. `npm test`（应为 72/72）
4. `npm run build`，确认 `web/dist` 有新产物
5. `npx wrangler login`（首次；见 §10.3）
6. `npx wrangler secret put ANTHROPIC_API_KEY --config web/wrangler.jsonc`
7. `npm run deploy`
8. 部署输出必须包含正确的 Worker 名、静态资源上传数量
9. 先验证 `workers.dev` 地址：`/api/topics` 返回 158 题，页面能打开
10. 验证一次真实批改（约 $0.15），确认 `usage.calls` 与费用符合预期
11. **确认限流/鉴权生效**（见 §9），再绑定自定义域名
12. 记录本次的 Worker version ID 作为回退点，提交并推送

## 12. 后续工作的边界

- 不要动 `packages/agent/` 和 `web/src/index.ts` 的设计决定，除非读过 `BACKEND.md` §2 的论证
- 不要破坏 §6 的四条界面不变量，它们是产品可信度的基础
- 不要把 Argument 任务加回来
- 不要在没有鉴权和限流的情况下把地址公开
- 不要把这个仓库转成 public（ETS 版权材料）
- 不要在 system prompt 里加会变的内容（会静默毁掉 prompt cache）
- 不要在评分器校准修好之前打开 Writer 的质量闭环
- 新基础设施功能应保留可回退的 Worker version 和 Git commit
