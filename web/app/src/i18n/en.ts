/**
 * The English chrome, and the shape every other language must match.
 *
 * Deliberately not `as const`: the values need to be plain `string` so that
 * `typeof en` can be used as the contract for translations.
 */
export const en = {
  brandTagline: "GRE Analytical Writing · Analyze an Issue",

  mode: {
    review: "Review my essay",
    write: "Write a response",
  },

  topic: {
    label: "Topic",
    placeholder: "Choose one of the 158 official topics",
    custom: "Custom topic",
    customHint: "Paste any prompt. The task instruction is required — it decides what the essay has to do.",
    search: "Search topics",
    noMatch: "No topic matches that search.",
    poolNote: "158 official pool topics",
    statement: "Issue statement",
    instruction: "Task instruction",
    instructionPlaceholder: "Write a response in which you discuss…",
    resolving: "Reading the instruction…",
    unrecognised: "Task instruction not recognised",
    allVariants: "All",
  },

  variantName: {
    statement: "Statement",
    claim_challenge: "Claim + challenge",
    claim_and_reason: "Claim + reason",
    recommendation: "Recommendation",
    two_views: "Two views",
    policy: "Policy",
  },

  moves: {
    title: "What this task requires",
    subtitle: "The response has to do each of these. Most lost points are here, not in the writing.",
  },

  essay: {
    label: "Your essay",
    placeholder: "Paste your essay here…",
    words: "words",
    paragraphs: "paragraphs",
    review: "Review this essay",
    needTopic: "Choose or enter a topic first.",
    needEssay: "Paste an essay first.",
  },

  write: {
    target: "Target score",
    guidance: "Extra direction",
    guidancePlaceholder: "e.g. argue against the statement; use examples from the history of science",
    guidanceHint: "Optional.",
    go: "Write it",
    plan: "The plan",
    position: "Position",
    concession: "Strongest objection, and the answer to it",
    essay: "The response",
    why: "Why this scores {score}",
    higher: "What a higher score would need",
    boundary: "Where 6 separates from 5",
    factCheck:
      "Names, dates and figures in generated responses are not verified. Check them before reusing any of them.",
  },

  precheck: {
    title: "Instant analysis",
    subtitle: "Computed locally. No model call, no cost.",
    words: "Words",
    paragraphs: "Paragraphs",
    sentences: "Sentences",
    sentenceLength: "Sentence length",
    sentenceLengthValue: "{mean} words on average, standard deviation {sd}",
    overlap: "Prompt overlap",
    opensByRestating: "Opens by restating the prompt",
    yes: "Yes",
    no: "No",
    concession: "Concession and counterargument markers",
    specificity: "Proper nouns, dates and figures",
    formulaic: "Formulaic signposting",
    none: "None found",
    flags: "Mechanical flags",
    noFlags: "None",
  },

  flag: {
    empty: "Empty submission",
    off_topic: "Off topic",
    extremely_short: "Extremely short",
    single_paragraph: "Single paragraph",
    copies_prompt: "Copies the prompt",
  },

  waiting: {
    reviewTitle: "Scoring against the ETS guide",
    reviewSub: "Checking each required move, gathering evidence on five axes, comparing with 18 official responses.",
    writeTitle: "Planning, then writing",
    writeSub: "An outline commits to a position and named examples before a sentence gets written.",
    typical: "Usually {range} seconds.",
  },

  review: {
    complianceTitle: "Task compliance",
    complianceWhy: "Whether the response did what this variant of the task asks for.",
    addressed: "Addressed",
    missed: "Not addressed",
    scoreTitle: "Reference score",
    range: "Confidence range {low} to {high}",
    calibration:
      "This score runs harsh. Measured against 26 human-scored essays it averages 0.5 to 0.8 points low, and it compresses the top of the scale — real 6s usually come back as 4.5 to 5. Read the compliance check and the per-axis evidence instead; neither depends on calibration.",
    zeroTitle: "Scored zero without calling the model",
    zeroBody:
      "An empty submission or a copy of the prompt is a zero by ETS definition, so this short-circuits before any model call. Nothing was spent.",
    anchor: "Closest official anchor",
    anchorAbove: "above it",
    anchorLevel: "level with it",
    anchorBelow: "below it",
    axesTitle: "Evidence by axis",
    commentaryTitle: "Rater commentary",
    suggestionsTitle: "Highest-leverage changes",
    fix: "What to do",
    example: "Rewritten",
  },

  axis: {
    position: "Position and task",
    development: "Development",
    organization: "Organization",
    language: "Language",
    conventions: "Conventions",
  },

  chat: {
    title: "Ask about this",
    placeholder: "e.g. why doesn't my concession paragraph count as addressing the objection?",
    send: "Ask",
    thinking: "…",
  },

  empty: {
    reviewTitle: "Nothing scored yet",
    reviewText:
      "Pick a topic, paste your essay, and the free analysis appears immediately while the model works on the scoring.",
    writeTitle: "Nothing written yet",
    writeText:
      "Pick a topic and a target score. Generating a 4 alongside a 6 shows the gap better than any number does.",
  },

  errors: {
    title: "Something went wrong",
    fixableTitle: "That needs a change",
  },

  usage: {
    model: "Model",
    output: "Output",
    cached: "Cache hit",
    cost: "This call",
    free: "No model call · no cost",
    tokens: "tokens",
  },

  ui: {
    theme: "Theme",
    language: "Language",
    light: "Light",
    dark: "Dark",
    system: "System",
    seconds: "s",
    close: "Close",
    expand: "Show evidence",
  },

  footer: {
    built: "Scored against the official ETS scoring guide, 18 official scored responses and the 158-topic Issue pool.",
    costNote: "Reviewing and writing call a language model and cost about $0.15 each. The other endpoints are free.",
  },
};
