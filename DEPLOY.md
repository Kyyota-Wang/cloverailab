# CloverAI Lab 部署手册

最后更新：2026-08-18 · 面向接手部署工作的 AI 或开发者

这份文档假设你**没有读过这个仓库**。读完应该能：在本地把站点跑起来、拿到所有需要的凭据、部署到 Cloudflare、验证部署是否真的成功、以及在出问题时回滚。

配套文档：

| 文件 | 内容 |
|---|---|
| `PROJECT_WORKLOG.md` | 项目全貌、设计决定、踩过的坑 |
| `BACKEND.md` | API 契约（六个端点的请求/响应结构）与后端设计论证 |
| `PLAN.md` | 数据来源与分阶段规划 |
| **本文** | 本地实现 + 部署流程 |

> **⚠️ 本文不包含任何密钥值，也不要往里面写。** 只写「去哪里拿」。

---

## 0. 当前状态（部署已完成）

**这个项目已经上线了。** 下面的内容既适用于「更新已有部署」，也适用于「在一个全新账号上从零重建」。

| 项 | 值 |
|---|---|
| 正式地址 | https://www.cloverailab.com 和 https://cloverailab.com |
| 测试地址 | https://cloverailab.pumpkin-ai-v2.workers.dev |
| Worker 名 | `cloverailab` |
| Cloudflare 账号 | `yunlongwang1987@gmail.com` |
| Account ID | `bd61a7a5c0e63e9a5c05f70fb97a9b97`（标识符，不是密钥） |
| 当前线上 version | `25bcf25b-3146-451f-8fa7-c835222d72df` |
| 上一个可回退 version | `d4367c2b-2205-4d21-9b1b-88c7be5e9aac` |
| Git 仓库 | `Kyyota-Wang/cloverailab`，分支 `main` |

**⚠️ 这个仓库必须保持 private。** `kb/anchors.json` 收录 18 篇 ETS 官方评分范文及官方评分员评语，`kb/prompts_issue.json` 收录 158 道官方题 —— ETS 版权材料，内部可用，不可公开转载。

---

## 1. 这个项目是什么

一个 GRE Analytical Writing（**只做 Issue 题**）的批改与范文生成工具。

一个 Cloudflare Worker 同时承担两件事：

1. 提供 7 个 JSON API 端点
2. 托管前端静态资源（非 `/api/*` 的请求交给静态资源服务）

没有数据库，没有账号系统，没有服务端状态。追问的上下文由客户端携带。

### 端点一览

| 端点 | 方法 | 耗时 | 成本 | 保护 |
|---|---|---:|---:|---|
| `/api/config` | GET | <10ms | $0 | 无 |
| `/api/topics` | GET | <10ms | $0 | 无 |
| `/api/resolve` | POST | <10ms | $0 | 限流 |
| `/api/precheck` | POST | ~60ms | $0 | 限流 |
| `/api/review` | POST | **60–90s** | **~$0.15** | **限流 + Turnstile** |
| `/api/write` | POST | **40–105s** | **~$0.15** | **限流 + Turnstile** |
| `/api/chat` | POST | ~5s | ~$0.01 | **限流 + Turnstile** |

**后三个花真钱。** 这条线决定了所有安全设计。完整请求/响应结构见 `BACKEND.md` §1。

---

## 2. 本地实现

### 2.1 技术栈

| 层 | 选型 |
|---|---|
| 运行时 | Cloudflare Workers |
| 后端语言 | TypeScript，**Node 24+ 直接跑 `.ts`，无构建步骤**（Worker 侧由 wrangler 打包） |
| 前端 | Vite 8 + React 19 + TypeScript |
| 样式 | 手写 CSS + CSS 变量（**故意不用 Tailwind**） |
| 包管理 | npm |
| LLM | Anthropic（provider 抽象层下也挂了 Gemini adapter） |

### 2.2 目录结构

```
GRE writer/
├── kb/                       # 知识库，235 KB，编译期注入 Worker
│   ├── rubric.json           #   ETS Issue 评分标准
│   ├── anchors.json          #   18 篇官方范文 + 官方评语
│   ├── prompts_issue.json    #   158 道官方题 + 变体分类
│   └── style_exemplars.json  #   Writer 的文体范本
├── packages/
│   ├── agent/src/            # 全部 agent 逻辑
│   │   ├── kb.ts             #   知识库加载 + 题目变体判定
│   │   ├── providers/        #   provider 抽象 + anthropic.ts / gemini.ts
│   │   ├── reviewer/         #   批改管线（precheck / prompt / schema / index）
│   │   └── writer/           #   生成管线
│   └── eval/                 # 评测框架（跑一次全量约 $5、40 分钟）
├── web/
│   ├── src/index.ts          # ★ Worker 入口：路由 + 限流 + Turnstile
│   ├── src/kb.ts             #   编译期把 kb/*.json 注入（Worker 无文件系统）
│   ├── app/                  # ★ 前端源码（Vite root）
│   │   ├── index.html
│   │   ├── src/api/          #   client.ts / types.ts / turnstile.ts
│   │   ├── src/components/   #   UI 组件
│   │   ├── src/i18n/         #   中英双语字典
│   │   ├── src/brand/Logo.tsx
│   │   └── src/styles/       #   tokens.css（设计系统）+ app.css
│   ├── dist/                 # 构建产物，gitignored，Worker 从这里读静态资源
│   ├── vite.config.ts
│   ├── wrangler.jsonc        # ★ Cloudflare 配置
│   └── .dev.vars             # 本地密钥，gitignored（模板 .dev.vars.example）
├── tools/                    # Python，一次性 ETL（正常部署用不到）
├── package.json
└── tsconfig.json             # 后端用；前端另有 web/app/tsconfig.json
```

**三个关键文件**：`web/src/index.ts`（Worker 入口）、`web/wrangler.jsonc`（部署配置）、`web/app/src/api/turnstile.ts`（前端人机验证）。

### 2.3 准备本地环境

**⚠️ 这台机器上 Node 不在系统 PATH 上。**

当前位置：

```
C:\Users\kangc\AppData\Local\Microsoft\WinGet\Packages\OpenJS.NodeJS.LTS_Microsoft.Winget.Source_8wekyb3d8bbwe\node-v24.19.0-win-x64
```

每次跑命令前要补 PATH：

```bash
# Git Bash
export PATH="/c/Users/kangc/AppData/Local/Microsoft/WinGet/Packages/OpenJS.NodeJS.LTS_Microsoft.Winget.Source_8wekyb3d8bbwe/node-v24.19.0-win-x64:$PATH"
```

```powershell
# PowerShell
$env:PATH = "$env:LOCALAPPDATA\Microsoft\WinGet\Packages\OpenJS.NodeJS.LTS_Microsoft.Winget.Source_8wekyb3d8bbwe\node-v24.19.0-win-x64;$env:PATH"
```

历史提醒：这个目录以前在 `%LOCALAPPDATA%\nodejs`，2026-08-17 整个消失过一次（原因不明），2026-08-18 用 `winget install OpenJS.NodeJS.LTS --scope user` 重装到了现在的位置。**如果 `node` 找不到，先按上面的路径找，别假设它还在老地方。**

装依赖：

```bash
npm install
```

**要求 Node ≥ 24。** Node 的类型剥离模式不支持构造函数参数属性、`enum`、`namespace` —— 用了会在 import 时崩溃，不是编译期报错。

### 2.4 本地环境变量

两个**不同**的文件，别搞混：

| 文件 | 谁读 | 用途 |
|---|---|---|
| `.env`（项目根） | Node 脚本（`npm run eval`） | 评测用 |
| `web/.dev.vars` | `wrangler dev` | 本地 Worker 用 |

**Worker 永远不读 `.env`** —— 它没有文件系统。两个文件都已 gitignore。

`web/.dev.vars` 的模板见 `web/.dev.vars.example`：

```
ANTHROPIC_API_KEY=
GEMINI_API_KEY=
LLM_PROVIDER=anthropic
REVIEWER_MODEL=claude-sonnet-5
WRITER_MODEL=claude-opus-5

# 本地一般没有 Turnstile widget，把强制要求关掉
REQUIRE_TURNSTILE=false
```

**`REQUIRE_TURNSTILE=false` 很重要**：生产在 `wrangler.jsonc` 里设成 `true`，那时缺 `TURNSTILE_SECRET` 会直接 500（fail closed）。本地没有 Turnstile 密钥，不关掉的话所有付费端点都会 500。

### 2.5 命令

```bash
npm run dev          # 构建前端 + wrangler dev，完整形态在 http://127.0.0.1:8788
npm run dev:ui       # Vite 热更新（5173），API 代理到 8788 —— 日常改前端用这个
npm run build        # 只构建前端到 web/dist
npm test             # 72 个测试
npm run typecheck    # 后端 tsc --noEmit
npm run typecheck:ui # 前端 tsc --noEmit
npm run deploy       # 构建 + 部署到 Cloudflare
npm run eval         # 全量评测（约 $5、40 分钟，正常部署用不到）
```

**⚠️ `wrangler dev` 在启动时给 `web/dist` 拍快照。** 服务器运行中重新构建前端，它认不到新文件 —— 浏览器会拿到旧的 `index.html` 引用已不存在的 hash 资源，结果是白屏 + 资源 404。改完前端必须**重启** wrangler，或者改用 `npm run dev:ui`。

### 2.6 本地怎么验证

部署前应当全绿：

```bash
npm run typecheck && npm run typecheck:ui && npm test    # 期望 72/72
```

浏览器走查（全部走免费端点，不花钱）：

- 题目选择器：搜索、六个变体筛选、键盘上下选择
- 自定义题目：贴合法指令 → 实时识别变体；贴无法识别的 → 显示后端 400 文案
- `/api/precheck`：正常作文 / 极短 / 单段 / 照抄题目四种输入
- 深浅主题、中英切换、375px 与 1440px 两种宽度
- console 无报错

**零成本验证付费链路的技巧**：把题目原文当作文提交。照抄题目是 ETS 明文定义的 0 分，后端在调用模型之前就短路，返回 `usage.calls === 0` 和 `estimatedCostUsd === 0`。这条路径能验证「限流 → Turnstile → 后端 → 前端渲染」整条链，但一分钱不花。

**另一个教训**：只断言 DOM 的 `textContent` 查不出排版 bug。曾经有个必做动作列表一个词一行（`li` 是两列网格却塞了三个子项），文字内容检查完全正确所以判定通过。**排版是几何问题，内容检查看不见。** 现在的做法是遍历元素量几何，找三类问题：装着 15 字符以上却宽度不足 90px 的盒子、`scrollWidth > clientWidth` 的、右边界超出视口的。

---

## 3. 部署前要准备的凭据

一共四样。**没有任何一样应该进 Git。**

### 3.1 Cloudflare 授权（二选一）

#### 方式 A：OAuth 登录（推荐，不产生长期 token）

```bash
npx wrangler login
```

浏览器会打开授权页。**必须看到两个确认**：浏览器出现 `Authorization granted to Wrangler`，终端出现 `Successfully logged in`。

> ⚠️ **在 Cloudflare 网页后台登录 ≠ wrangler 已授权。** 这两件事完全无关，踩过。
>
> ⚠️ wrangler 可能问你要不要安装 Cloudflare skills，这跟 OAuth 授权无关，不装也能部署。

确认当前授权状态：

```bash
npx wrangler whoami
```

会打印账号邮箱、Account ID 和 token 权限范围。

#### 方式 B：API Token（适合 CI，或 OAuth 不方便时）

**去哪里拿：**

1. 打开 https://dash.cloudflare.com
2. 右上角**头像** → **My Profile**
3. 左侧 **API Tokens**
4. **Create Token**
5. 用 **"Edit Cloudflare Workers"** 模板（**不要用 Global API Key**，那个权限过大且无法限定范围）
6. 在模板里指定范围：
   - Account Resources：选这个账号
   - Zone Resources：选 `cloverailab.com`
7. 如果还要让脚本管理 DNS 记录（绑定自定义域名会用到），额外加一条权限：
   **Zone → DNS → Edit**
8. Continue → Create Token → **token 只显示这一次，立刻复制保存**

**怎么给 wrangler 用** —— 设成环境变量，**不要写进任何文件**：

```powershell
# PowerShell，仅当前会话
$env:CLOUDFLARE_API_TOKEN = "<你的 token>"
$env:CLOUDFLARE_ACCOUNT_ID = "bd61a7a5c0e63e9a5c05f70fb97a9b97"
```

wrangler 会自动读这两个变量。

**Account ID 在哪找**（不是密钥，是标识符）：dashboard 进任意一个域名 → 右侧栏 **API** 区块；或 Workers & Pages 概览页右侧；或直接跑 `npx wrangler whoami`。

### 3.2 Anthropic API Key

**去哪里拿：**

1. 打开 https://console.anthropic.com
2. **Settings** → **API keys**
3. **Create Key**，复制保存（只显示一次）
4. 格式是 `sk-ant-` 开头

**⚠️ 顺手做的成本保护**：Settings → **Limits**，设一个月度消费上限。换算参考：批改一次约 $0.146，$30/月 ≈ 200 次。

> 当前这个账号用的是**预付余额**且**未开 auto-reload**，所以最坏损失有硬顶（就是余额那个数）。余额耗尽时 API 直接返回错误，不会透支。代价是网站会坏 —— 用户等 90 秒拿到一个报错。

### 3.3 Turnstile（人机验证）

Cloudflare 免费的 CAPTCHA 替代品。**这是保护付费端点最主要的一道闸。**

**建 widget：**

1. https://dash.cloudflare.com → 左侧 **Turnstile** → **Add widget**
2. 填：

| 字段 | 值 |
|---|---|
| Widget name | `cloverailab` |
| Hostnames | **三个都要加**：`cloverailab.com`、`www.cloverailab.com`、`cloverailab.pumpkin-ai-v2.workers.dev` |
| Widget Mode | **Managed**（推荐） |
| Pre-clearance | **关闭** |

3. Create

**为什么 Hostnames 要填全**：Worker 在验证 token 时会核对 Cloudflare 返回的 `hostname` 必须**严格等于**当前请求的域名。这是防盗用的 —— site key 是公开的，别人把页面复制到自己域名下也用不了你的额度。**少填一个域名，那个域名下的付费请求会全部 403。**

**为什么选 Managed 而不是 Invisible**：Invisible 永远不会升级成可见挑战，是三个模式里最弱的。付费端点值得保留「发现异常就升级」的能力。前端用的是 `appearance: "interaction-only"`，所以正常用户什么都看不到，只有 Cloudflare 判定可疑时才显形。

**为什么关 Pre-clearance**：它会让通过验证的访客在 30 分钟内绕过域名上的其它安全规则。我们的 Worker 每个请求单独验一次 token，不依赖任何缓存放行，开了只有坏处。

**创建后拿到两个 key：**

| Key | 性质 | 放哪 |
|---|---|---|
| **Site Key**（`0x4AAA…`） | **公开**，本来就在网页源码里 | `web/wrangler.jsonc` 的 `vars.TURNSTILE_SITE_KEY`，**可以进 Git** |
| **Secret Key** | **机密** | Worker Secret，**绝不进 Git** |

当前用的 Site Key 是 `0x4AAAAAAESMRvL_5zgM0RtZ`，已经在 `wrangler.jsonc` 里。

### 3.4 把 secret 设到 Worker 上

两个：`ANTHROPIC_API_KEY` 和 `TURNSTILE_SECRET`。

#### 方式 A：命令行

```bash
npx wrangler secret put ANTHROPIC_API_KEY --config web/wrangler.jsonc
npx wrangler secret put TURNSTILE_SECRET  --config web/wrangler.jsonc
```

交互式提示输入，内容不回显、不落盘。

#### 方式 B：网页后台（不需要命令行）

dashboard → **Compute**（Workers & Pages）→ 点 **cloverailab** → **Settings** → **Variables and Secrets** → **Add**

类型选 **Secret**（不是 Text —— Secret 加密存储且不回显）。**名字大小写必须完全一致**，Worker 是按名字读的。

保存后**立即生效，不需要重新部署**。

#### 确认设上了（不显示值）

```bash
npx wrangler secret list --config web/wrangler.jsonc
```

应该看到：

```json
[
  { "name": "ANTHROPIC_API_KEY", "type": "secret_text" },
  { "name": "TURNSTILE_SECRET",  "type": "secret_text" }
]
```

> **注意**：secret 存在 ≠ 有效。key 是不是过期或被撤销，只有真实调用一次才知道。

---

## 4. 配置文件详解：`web/wrangler.jsonc`

```jsonc
{
  "name": "cloverailab",              // 决定 workers.dev 地址的第一段
  "main": "src/index.ts",             // Worker 入口
  "compatibility_date": "2026-08-01",
  "compatibility_flags": ["nodejs_compat"],

  // 静态资源目录。指向 Vite 的构建产物，所以部署前必须先 build。
  "assets": { "directory": "./dist", "binding": "ASSETS" },

  "observability": { "enabled": true },

  "routes": [
    { "pattern": "cloverailab.com", "custom_domain": true },
    { "pattern": "www.cloverailab.com/*", "zone_name": "cloverailab.com" }
  ],

  "ratelimits": [
    { "name": "PAID_LIMIT",  "namespace_id": "1001", "simple": { "limit": 3,  "period": 60 } },
    { "name": "LIGHT_LIMIT", "namespace_id": "1002", "simple": { "limit": 20, "period": 60 } }
  ],

  "vars": {
    "REQUIRE_TURNSTILE": "true",
    "TURNSTILE_SITE_KEY": "0x4AAAAAAESMRvL_5zgM0RtZ"
  }
}
```

### 必须理解的几点

**`assets.directory` 指向 `./dist`**（相对于 `web/`）。这是 gitignored 的构建产物。**所以部署前必须 `npm run build`** —— `npm run deploy` 已经包含这一步。

**`ratelimits` 的 `period` 只支持 10 或 60 秒。** 没有更长的窗口，所以做不了「每天最多 N 次」。

**`REQUIRE_TURNSTILE: "true"` 是 fail-closed 开关。** 打开时，如果 `TURNSTILE_SECRET` 没设，付费端点直接返回 500 而不是放行。这是唯一一种「看起来一切正常但付费端点其实裸奔」的失效模式，必须让它响。

**`namespace_id` 只是限流桶的标识符**，随便取，但两个限流器不能重复。

### Worker 里的保护逻辑（`web/src/index.ts`）

顺序是**先限流后 Turnstile** —— 限流是本地的、免费的，Turnstile 要一次网络往返。

1. 按 `端点:CF-Connecting-IP` 做限流。`CF-Connecting-IP` 由 Cloudflare 边缘设置，客户端伪造不了。
2. Turnstile siteverify，除 `success` 外还校验：
   - **`action`** 必须等于端点名（`review` / `write` / `chat`）—— 为 chat 铸的 token 不能用在 review 上
   - **`hostname`** 必须等于请求域名 —— 别人搬走页面解出来的 token 无效

两关都在**碰到 provider 之前**。

---

## 5. 部署

### 5.1 部署前检查

```bash
git status                                             # 确认没有意外改动
npm run typecheck && npm run typecheck:ui
npm test                                               # 期望 72/72
npx wrangler whoami                                    # 确认授权和账号对
npx wrangler secret list --config web/wrangler.jsonc   # 确认两个 secret 都在
```

### 5.2 部署

```bash
npm run deploy
```

等价于 `npm run build && wrangler deploy --config web/wrangler.jsonc`。

### 5.3 输出里要核对什么

```
Your Worker has access to the following bindings:
env.PAID_LIMIT (3 requests/60s)                       Rate Limit
env.LIGHT_LIMIT (20 requests/60s)                     Rate Limit
env.ASSETS                                            Assets
env.REQUIRE_TURNSTILE ("true")                        Environment Variable
env.TURNSTILE_SITE_KEY ("0x4AAAAAAESMRvL_5zgM0RtZ")   Environment Variable
Uploaded cloverailab (3.53 sec)
Deployed cloverailab triggers (0.71 sec)
  https://cloverailab.pumpkin-ai-v2.workers.dev
Current Version ID: 25bcf25b-3146-451f-8fa7-c835222d72df
```

必须确认：

- **两个 Rate Limit binding 都在**
- **`REQUIRE_TURNSTILE` 是 `"true"`**
- **`TURNSTILE_SITE_KEY` 不是空字符串**
- 静态资源上传数量合理（首次 5 个，之后只传变更的）

**把 Version ID 记下来** —— 这是回滚点。

> secret 不会出现在这个列表里，那是正常的。

---

## 6. 自定义域名

### 6.1 前提

域名必须已经托管在同一个 Cloudflare 账号下（NS 指向 Cloudflare）。查：

```bash
nslookup -type=NS cloverailab.com
```

应该返回 `*.ns.cloudflare.com`。

### 6.2 两种绑定方式，区别很重要

| 方式 | 自动建 DNS | 自动签证书 | 支持子域名 |
|---|---|---|---|
| **Custom Domain** | ✅ | ✅ | 网页后台对话框 ❌ / wrangler ✅ |
| **Route** | ❌ **要自己建** | ✅（Universal SSL） | ✅ |

### 6.3 用 wrangler（推荐，一步到位）

在 `wrangler.jsonc` 的 `routes` 里写 `custom_domain: true`，然后 `npm run deploy`。wrangler 走 API，**会连 DNS 记录一起建**，也不会碰到下面那个对话框的毛病。

### 6.4 用网页后台（Node 不可用时的退路）

**主域名**：Worker → **Settings** → **Domains & Routes** → **Add** → **Custom Domain** → 填 `cloverailab.com`

**子域名（比如 www）—— 这里有个坑：**

网页后台的 Connect domain 对话框做的是**精确 zone 匹配**，输入 `www.cloverailab.com` 会报：

```
No zones match www.cloverailab.com
```

**这不是你的错，是那个对话框的限制。** 绕法分两步：

**第 1 步 · 手工建 DNS 记录**

（route 不会帮你建，**这才是子域名连不上的真正原因** —— 那个主机名在 DNS 上根本不存在）

回到**域名列表**点 `cloverailab.com`（是 zone，不是 Worker）→ **DNS** → **Add record**：

| 字段 | 值 |
|---|---|
| Type | `AAAA` |
| Name | `www` |
| IPv6 address | `100::` |
| Proxy status | **Proxied（橙色云，必须开）** |

`100::` 是 IPv6 的丢弃地址，Cloudflare 官方推荐的「只走边缘、不回源」占位记录。流量到 Cloudflare 就被 Worker 接管，永远不会真的发到那个地址。**橙色云是关键** —— 灰色云等于绕过 Cloudflare，Worker 接不到。

**第 2 步 · 加 Route**

Worker → **Settings** → **Domains & Routes** → **Add** → 选 **Route**（**不是** Custom Domain）：

| 字段 | 值 |
|---|---|
| Route | `www.cloverailab.com/*` |
| Zone | `cloverailab.com` |

`/*` 不能省。

**做完记得把结果同步回 `wrangler.jsonc`**，否则下次 `wrangler deploy` 可能把网页后台建的路由抹掉。

### 6.5 绑完之后

**Turnstile 白名单里必须有这个新域名**，否则该域名下所有付费请求都会 403（hostname 校验失败）。提前把所有计划使用的域名一次填进 widget，省得回头改。

### 6.6 关于 workers.dev 地址

```
cloverailab . pumpkin-ai-v2 . workers.dev
     ↑              ↑
  Worker 名    账号级子域名（不是项目名）
```

中间那段是**整个 Cloudflare 账号共用的** workers.dev 子域名，同账号下每个 Worker 都是这个结构。**改它会同时改掉账号下所有 Worker 的地址**（包括别的项目），不要动。绑定自定义域名后，可以在 Worker 设置里把 workers.dev 路由关掉。

---

## 7. 验证清单

**全部走免费端点，不花钱。** 把 `$U` 换成要测的地址。

```bash
U="https://www.cloverailab.com"
INSTR="Write a response in which you discuss the extent to which you agree or disagree with the statement and explain your reasoning for the position you take."

# 1. 页面能开
curl -s -o /dev/null -w "page  HTTP %{http_code}\n" "$U/"

# 2. 题库
curl -s "$U/api/topics" | head -c 200

# 3. site key 有下发（不能是 null，否则前端不会做人机验证）
curl -s "$U/api/config"

# 4. 付费端点无 token —— 必须 403
curl -s -X POST "$U/api/review" -H 'content-type: application/json' \
  -d "{\"statement\":\"x\",\"instruction\":\"$INSTR\",\"essay\":\"hi\"}" \
  -w "  <- HTTP %{http_code}\n"

# 5. 伪造 token —— 必须 403（证明 siteverify 真的在跑）
curl -s -X POST "$U/api/review" -H 'content-type: application/json' \
  -d "{\"statement\":\"x\",\"instruction\":\"$INSTR\",\"essay\":\"hi\",\"turnstileToken\":\"forged\"}" \
  -w "  <- HTTP %{http_code}\n"

# 6. 免费端点仍然可用
curl -s -o /dev/null -w "precheck HTTP %{http_code}\n" -X POST "$U/api/precheck" \
  -H 'content-type: application/json' \
  -d "{\"statement\":\"x\",\"instruction\":\"$INSTR\",\"essay\":\"a b c\"}"

# 7. 证书
echo | openssl s_client -connect www.cloverailab.com:443 -servername www.cloverailab.com 2>/dev/null \
  | openssl x509 -noout -subject -dates
```

### 结果对照

| 检查 | 期望 |
|---|---|
| 页面 | 200 |
| `/api/topics` | 158 道题 |
| `/api/config` | `turnstileSiteKey` **不是 null** |
| `/api/review` 无 token | **403** |
| `/api/review` 伪造 token | **403**，文案 `Verification failed` |
| `/api/precheck` | 200 |
| 证书 | 有效期覆盖当前 |

**如果第 4 步返回 500 而不是 403**，文案是 `This deployment is missing its abuse-protection secret` —— 说明 `TURNSTILE_SECRET` 没设。这是 fail-closed 在起作用，不是 bug。

**如果第 4 步返回 200，立刻停下** —— 付费端点在裸奔。检查 `REQUIRE_TURNSTILE` 是不是 `"true"`。

### 浏览器端到端（仍然零成本）

在**真实浏览器**里打开站点，选一道题，**把题目原文复制粘贴当作文提交**。

预期：Turnstile 无感通过 → 后端返回 → 界面显示「未调用模型 · 零成本」，`usage.calls === 0`、`estimatedCostUsd === 0`。

这条路径验证完整链路 —— Turnstile 脚本加载、铸 token、siteverify 的 hostname 校验、后端处理、前端渲染 —— 但因为照抄题目是 ETS 定义的 0 分，后端在调模型之前就短路了，所以不花钱。

### 最后一步：一次真实调用（约 $0.15）

上面全过之后，唯一还没证明的是 **API key 是否有效**（存在 ≠ 有效）。

在浏览器里贴一篇真作文点批改，等 60–90 秒。成功即全通。如果 key 无效，会立刻返回 credential 相关的错误，**不扣钱**。

> 这一步会真实花钱，**执行前先跟人确认**。

---

## 8. 回滚

### 8.1 看历史版本

```bash
npx wrangler deployments list --config web/wrangler.jsonc
```

### 8.2 回滚

```bash
npx wrangler rollback <VERSION_ID> --config web/wrangler.jsonc
```

或网页后台：Worker → **Deployments** → 选历史版本 → Rollback。

### 8.3 已知可用的版本

| Version ID | 说明 |
|---|---|
| `25bcf25b-3146-451f-8fa7-c835222d72df` | 当前线上。完整功能 + Turnstile |
| `d4367c2b-2205-4d21-9b1b-88c7be5e9aac` | 首次部署。**没有 Turnstile site key**，付费端点全部 fail closed |

**代码层面的回退点是 Git**：`git log --oneline` 能看到每一步。

---

## 9. 坑（都踩过）

### 9.1 网页后台登录 ≠ wrangler 已授权

两件完全独立的事。必须跑 `npx wrangler login` 并看到 `Successfully logged in`。

### 9.2 `wrangler dev` 会给 `web/dist` 拍快照

运行中重新构建前端，它认不到。浏览器拿到旧 `index.html` → 引用不存在的 hash 资源 → 白屏 + 404。**改完前端必须重启 wrangler**，或者用 `npm run dev:ui`。

### 9.3 本地限流数字不代表生产

同样的配置，本地 `wrangler dev` 是**精确**的（配 3/60s 就第 4 次 429），生产是**最终一致**的，宽松得多。

2026-08-17 生产实测（配置 `PAID_LIMIT` 3/60s、`LIGHT_LIMIT` 20/60s）：

| 测试 | 结果 |
|---|---|
| 连发 5 次 `/api/review` | 0 次被拦 |
| 连发 15 次 `/api/review` | 放行 11、拦截 4 |
| 连发 30 次 `/api/precheck` | 0 次被拦 |

**结论**：Rate Limiting binding 是边缘位置级、最终一致的，是抗持续滥用的兜底，**不是每分钟闸门，更不是计费器**。配置值要比想要的效果更严。真正确定的两道闸是 **Turnstile** 和 **Anthropic 账户余额上限**。

### 9.4 子域名加不进 Custom Domain 对话框

见 §6.4。用 route + 手建 DNS 记录，或者干脆用 wrangler。

### 9.5 Turnstile token 是一次性的

每次请求都要现铸新 token。批改要 60–90 秒，复用同一个 token 第二次必然失败。前端逻辑在 `web/app/src/api/turnstile.ts`。

### 9.6 别在 system prompt 里放会变的东西

输入成本靠 prompt caching 降到约 1/10，缓存要求 system 前缀**逐字节一致**。塞时间戳、用户 ID、随机数会让缓存**静默失效** —— 不报错，只是成本涨 10 倍。有测试守这条（`packages/agent/test/reviewer.test.ts`）。要加「用户偏好」之类功能，务必走 user message。

### 9.7 Worker 里没有文件系统

不要在被 Worker 引用的模块顶层调用 `fileURLToPath` 或 `node:fs` —— Worker 启动即崩。Node 专属逻辑隔离在 `packages/agent/src/kb-node.ts` 和 `env-node.ts`，Worker 走 `web/src/kb.ts` 的编译期 JSON 注入。

### 9.8 Windows + OneDrive 的 Git dubious ownership

```bash
git -c safe.directory="C:/Users/kangc/OneDrive/Documents/cc_sandbox/GRE writer" status
```

不要全局改配置。

### 9.9 PowerShell 把 git 的 stderr 当错误显示

`git push` 成功时 PowerShell 也会打红字 `NativeCommandError`。看实际输出行（比如 `main -> main`）判断，不要看红字。

### 9.10 结构化输出的 schema 限制

不支持 `minimum` `maximum` `multipleOf` `minLength` `maxLength` `maxItems`，以及大于 1 的 `minItems`。所以「必须有 5 个评分轴」是用 5 个 required 属性实现的，不是数组长度约束。有测试专门守这条。

---

## 10. 界面上不能动的四条

改前端时必须保留。完整论证见 `BACKEND.md` §2。

1. **合规性检查在视觉层级上先于分数。** 它是唯一不依赖分数校准的判断，读者能拿自己的作文一眼验证。
2. **分数必须带置信区间 + 偏严说明，不折叠不淡化。** 实测偏严 0.5–0.8 分，高分段压缩明显 —— 三篇 ETS 官方满分作文，模型给出 5.0 / 4.5 / 5.5，一个 6 都没给过。
3. **免费预检抢在付费评分前显示。** 用户看到的是真实内容，不是转圈。
4. **题目变体识别不出必须报错，不能猜。** 猜错 → 整个合规性检查基于错误前提 → 产品最有价值的部分变成误导。

另外：`holisticScore: 0` + `axisAssessments: []` + `usage.calls === 0` 是**合法响应**（空白提交或照抄题目），渲染必须单独处理，不能崩。

---

## 11. 还没做的

| 缺口 | 说明 |
|---|---|
| 用户账号 / 配额 | 当前任何通过人机验证的人都能用 |
| 日级别用量上限 | 限流 binding 只支持 10 秒和 60 秒窗口，做不了 |
| 匿名用量统计 | `pumpkinsolve` 项目用 D1 做过一套，可以搬 |
| SSE 流式输出 | 批改要等 60–90 秒，加流式需要改 provider 层 |
| 持久化 | 刷新即丢，需要 D1（提交记录）+ KV（同一篇作文的结果缓存） |
| `og:image` / `apple-touch-icon` 的 PNG 版 | 目前只有 SVG，iOS Safari 和社交平台不认 |
| 主域名与 www 的规范化 | 两个都在服务同一个站，建议挑一个做 301 跳转 |
