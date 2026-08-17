import type { en } from "./en";

/**
 * The Chinese chrome. Structurally identical to `en` -- the type annotation
 * makes a missing or misspelled key a build error rather than a blank label.
 */
export const zh: typeof en = {
  brandTagline: "GRE 分析性写作 · Issue 题",

  mode: {
    review: "批改我的作文",
    write: "生成范文",
  },

  topic: {
    label: "题目",
    placeholder: "从 158 道官方题中选择",
    custom: "自定义题目",
    customHint: "可以粘贴任意题目。任务指令必须提供——它决定了这篇作文要做哪些动作。",
    search: "搜索题目",
    noMatch: "没有匹配的题目。",
    poolNote: "158 道官方题库",
    statement: "题目陈述",
    instruction: "任务指令",
    instructionPlaceholder: "Write a response in which you discuss…",
    resolving: "正在识别指令…",
    unrecognised: "无法识别任务指令",
    allVariants: "全部",
  },

  variantName: {
    statement: "陈述",
    claim_challenge: "主张 + 反驳",
    claim_and_reason: "主张 + 理由",
    recommendation: "建议",
    two_views: "两种观点",
    policy: "政策",
  },

  moves: {
    title: "这道题要求做到什么",
    subtitle: "以下每一条都必须做到。绝大多数失分在这里，而不在文笔。",
  },

  essay: {
    label: "你的作文",
    placeholder: "把作文粘贴到这里…",
    words: "词",
    paragraphs: "段",
    review: "批改这篇作文",
    needTopic: "请先选择或填写题目。",
    needEssay: "请先贴上作文。",
  },

  write: {
    target: "目标分数",
    guidance: "附加要求",
    guidancePlaceholder: "例如：反对这个观点；用科学史上的例子",
    guidanceHint: "可选。",
    go: "开始生成",
    plan: "写作计划",
    position: "立场",
    concession: "最强的反方论据，以及如何回应",
    essay: "范文",
    why: "为什么这是 {score} 分",
    higher: "再高一档还差什么",
    boundary: "6 分与 5 分的分界在哪里",
    factCheck: "范文中的人名、年份和数据未经核实。引用之前请自行核查。",
  },

  precheck: {
    title: "即时分析",
    subtitle: "本地计算完成。不调用模型，零成本。",
    words: "词数",
    paragraphs: "段落",
    sentences: "句数",
    sentenceLength: "句长",
    sentenceLengthValue: "平均 {mean} 词，标准差 {sd}",
    overlap: "题目重合度",
    opensByRestating: "开头是否在复述题目",
    yes: "是",
    no: "否",
    concession: "让步与反驳标记",
    specificity: "专名、年份与数据",
    formulaic: "模板化措辞",
    none: "未发现",
    flags: "机械标记",
    noFlags: "无",
  },

  flag: {
    empty: "空白提交",
    off_topic: "偏题",
    extremely_short: "篇幅极短",
    single_paragraph: "只有一段",
    copies_prompt: "照抄题目",
  },

  waiting: {
    reviewTitle: "正在按 ETS 评分标准打分",
    reviewSub: "逐条核对任务要求的动作，在五条评分轴上取证，并与 18 篇官方范文对比。",
    writeTitle: "先规划，再成文",
    writeSub: "提纲会先锁定立场和具体例证，然后才开始写句子。",
    typical: "通常需要 {range} 秒。",
  },

  review: {
    complianceTitle: "任务合规性",
    complianceWhy: "这篇作文有没有做到这个题目变体所要求的动作。",
    addressed: "已做到",
    missed: "未做到",
    scoreTitle: "参考分数",
    range: "置信区间 {low} – {high}",
    calibration:
      "这个分数已知偏严。在 26 篇有人工评分的作文上实测，平均比真人低 0.5–0.8 分，且高分段被压缩——真实的 6 分作文通常只给到 4.5–5。请以上面的合规性检查和逐轴取证为准，那两部分不依赖分数校准。",
    zeroTitle: "判为 0 分，未调用模型",
    zeroBody: "空白提交或照抄题目是 ETS 明文定义的 0 分，因此在调用模型之前就短路了。本次没有产生任何费用。",
    anchor: "最接近的官方锚点",
    anchorAbove: "高于它",
    anchorLevel: "与它持平",
    anchorBelow: "低于它",
    axesTitle: "逐轴取证",
    commentaryTitle: "评分员评语",
    suggestionsTitle: "最高杠杆的修改",
    fix: "怎么改",
    example: "改写示例",
  },

  axis: {
    position: "立场与任务",
    development: "论证展开",
    organization: "结构组织",
    language: "语言表达",
    conventions: "语法规范",
  },

  chat: {
    title: "追问",
    placeholder: "例如：为什么说我的让步段没有真正回应反方？",
    send: "提问",
    thinking: "…",
  },

  empty: {
    reviewTitle: "还没有批改结果",
    reviewText: "选好题目、贴上作文，免费的即时分析会立刻出现，模型评分在后台同时进行。",
    writeTitle: "还没有生成范文",
    writeText: "选一道题和目标分数。同题生成一篇 4 分和一篇 6 分放在一起读，比任何分数都更能说明差距。",
  },

  errors: {
    title: "出错了",
    fixableTitle: "这里需要改一下",
  },

  usage: {
    model: "模型",
    output: "输出",
    cached: "缓存命中",
    cost: "本次约",
    free: "未调用模型 · 零成本",
    tokens: "tokens",
  },

  ui: {
    theme: "主题",
    language: "语言",
    light: "浅色",
    dark: "深色",
    system: "跟随系统",
    seconds: "秒",
    close: "关闭",
    expand: "查看取证",
  },

  footer: {
    built: "依据 ETS 官方评分标准、18 篇官方评分范文和 158 道 Issue 官方题库。",
    costNote: "批改与生成会调用语言模型，每次约 $0.15。其余接口免费。",
  },
};
