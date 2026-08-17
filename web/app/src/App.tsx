import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, ApiError } from "./api/client";
import { configureTurnstile } from "./api/turnstile";
import type {
  Precheck,
  PromptSpec,
  ReviewResponse,
  TaskVariant,
  Topic,
  WriteResponse,
} from "./api/types";
import { TARGET_SCORES } from "./api/types";
import { Logo, Wordmark } from "./brand/Logo";
import { ChatThread } from "./components/ChatThread";
import { PrecheckPanel } from "./components/PrecheckPanel";
import { PromptCard, PromptError } from "./components/PromptCard";
import { ReviewResult } from "./components/ReviewResult";
import { CUSTOM, TopicPicker, type Selection } from "./components/TopicPicker";
import { WaitingState, useElapsed } from "./components/WaitingState";
import { WriteResult } from "./components/WriteResult";
import { AlertIcon, MoonIcon, SunIcon } from "./components/icons";
import { useI18n, type Lang } from "./i18n";

type Mode = "review" | "write";

type Resolved =
  | { state: "idle" }
  | { state: "resolving" }
  | { state: "ok"; prompt: PromptSpec; summary: string }
  | { state: "error"; message: string };

const THEME_KEY = "clover.theme";

function useTheme() {
  const [theme, setTheme] = useState<"light" | "dark" | null>(() => {
    try {
      const saved = localStorage.getItem(THEME_KEY);
      return saved === "light" || saved === "dark" ? saved : null;
    } catch {
      return null;
    }
  });

  useEffect(() => {
    if (theme) document.documentElement.dataset.theme = theme;
    else delete document.documentElement.dataset.theme;
    try {
      if (theme) localStorage.setItem(THEME_KEY, theme);
      else localStorage.removeItem(THEME_KEY);
    } catch {
      /* private mode */
    }
  }, [theme]);

  const prefersDark =
    typeof matchMedia === "function" && matchMedia("(prefers-color-scheme: dark)").matches;
  const effective = theme ?? (prefersDark ? "dark" : "light");

  return { effective, toggle: () => setTheme(effective === "dark" ? "light" : "dark") };
}

/** Word and paragraph counts for the editor, matching the backend's definitions. */
function localCounts(text: string) {
  const trimmed = text.trim();
  return {
    words: trimmed ? trimmed.split(/\s+/).length : 0,
    paragraphs: trimmed ? trimmed.split(/\n\s*\n/).filter((p) => p.trim()).length : 0,
  };
}

export function App() {
  const { t, lang, setLang } = useI18n();
  const theme = useTheme();

  const [topics, setTopics] = useState<Topic[]>([]);
  const [variantCounts, setVariantCounts] = useState<Partial<Record<TaskVariant, number>>>({});
  const [loadError, setLoadError] = useState<string | null>(null);

  const [mode, setMode] = useState<Mode>("review");
  const [selection, setSelection] = useState<Selection>(0);
  const [customStatement, setCustomStatement] = useState("");
  const [customInstruction, setCustomInstruction] = useState("");
  const [resolved, setResolved] = useState<Resolved>({ state: "idle" });

  const [essay, setEssay] = useState("");
  const [targetScore, setTargetScore] = useState(6);
  const [guidance, setGuidance] = useState("");

  const [busy, setBusy] = useState(false);
  const [precheck, setPrecheck] = useState<Precheck | null>(null);
  const [review, setReview] = useState<ReviewResponse | null>(null);
  const [written, setWritten] = useState<WriteResponse | null>(null);
  const [runError, setRunError] = useState<ApiError | null>(null);

  const elapsed = useElapsed(busy);

  useEffect(() => {
    api
      .topics()
      .then((data) => {
        setTopics(data.topics);
        setVariantCounts(data.variantCounts);
      })
      .catch((cause: unknown) => {
        setLoadError(cause instanceof ApiError ? cause.message : String(cause));
      });

    // The site key is public and only gates whether a challenge can be shown.
    // If this fails, the paid endpoints will reject the request anyway, so
    // there is nothing useful to tell the user until they try one.
    api
      .config()
      .then((data) => configureTurnstile(data.turnstileSiteKey))
      .catch(() => configureTurnstile(null));
  }, []);

  const selectedTopic = selection === CUSTOM ? null : topics[selection];

  /**
   * Resolve a pasted prompt while the user types.
   *
   * Free, instant, no model call. Without it, an instruction that cannot be
   * classified only fails after a 60-second wait -- and one that IS classified
   * never shows what it was classified as, which is the single most important
   * thing to get right, because every compliance judgement rests on it.
   */
  const resolveTimer = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (selection !== CUSTOM) {
      setResolved({ state: "idle" });
      return;
    }
    const statement = customStatement.trim();
    const instruction = customInstruction.trim();
    if (!statement && !instruction) {
      setResolved({ state: "idle" });
      return;
    }

    setResolved({ state: "resolving" });
    window.clearTimeout(resolveTimer.current);
    const controller = new AbortController();
    resolveTimer.current = window.setTimeout(() => {
      api
        .resolve({ statement, ...(instruction ? { instruction } : {}) }, controller.signal)
        .then((data) =>
          setResolved({ state: "ok", prompt: data.prompt, summary: data.variantSummary }),
        )
        .catch((cause: unknown) => {
          if (controller.signal.aborted) return;
          setResolved({
            state: "error",
            message: cause instanceof ApiError ? cause.message : String(cause),
          });
        });
    }, 400);

    return () => {
      window.clearTimeout(resolveTimer.current);
      controller.abort();
    };
  }, [selection, customStatement, customInstruction]);

  /** The prompt to send, and whether it is complete enough to send at all. */
  const activePrompt = useMemo((): { statement: string; instruction?: string } | null => {
    if (selectedTopic) {
      return { statement: selectedTopic.statement, instruction: selectedTopic.instruction };
    }
    const statement = customStatement.trim();
    const instruction = customInstruction.trim();
    if (!statement) return null;
    return { statement, ...(instruction ? { instruction } : {}) };
  }, [selectedTopic, customStatement, customInstruction]);

  const promptForDisplay = selectedTopic
    ? { prompt: selectedTopic as unknown as PromptSpec, summary: selectedTopic.variantSummary }
    : resolved.state === "ok"
      ? { prompt: resolved.prompt, summary: resolved.summary }
      : null;

  const resetResults = useCallback(() => {
    setPrecheck(null);
    setReview(null);
    setWritten(null);
    setRunError(null);
  }, []);

  useEffect(() => {
    resetResults();
  }, [mode, selection, resetResults]);

  const runReview = async () => {
    if (!activePrompt || !essay.trim() || busy) return;
    resetResults();
    setBusy(true);
    try {
      // The free half first: real analysis on screen in about 60ms, so the
      // 60-90 second scoring wait is spent reading rather than watching a
      // spinner.
      const pre = await api.precheck({ ...activePrompt, essay });
      setPrecheck(pre.precheck);
      const result = await api.review({ ...activePrompt, essay });
      setReview(result);
    } catch (cause) {
      setRunError(cause instanceof ApiError ? cause : new ApiError(String(cause), 500));
    } finally {
      setBusy(false);
    }
  };

  const runWrite = async () => {
    if (!activePrompt || busy) return;
    resetResults();
    setBusy(true);
    try {
      const result = await api.write({
        ...activePrompt,
        targetScore,
        ...(guidance.trim() ? { guidance: guidance.trim() } : {}),
      });
      setWritten(result);
    } catch (cause) {
      setRunError(cause instanceof ApiError ? cause : new ApiError(String(cause), 500));
    } finally {
      setBusy(false);
    }
  };

  const chatContext = review
    ? `THE PROMPT\n${review.prompt.statement}\n\nTASK INSTRUCTION\n${review.prompt.instruction}\n\n` +
      `THE ESSAY\n${essay}\n\nTHE ASSESSMENT\n${JSON.stringify(review.review, null, 2)}`
    : written
      ? `THE PROMPT\n${written.prompt.statement}\n\nTASK INSTRUCTION\n${written.prompt.instruction}\n\n` +
        `THE PLAN\n${JSON.stringify(written.plan, null, 2)}\n\nTHE ESSAY\n${written.essay}\n\n` +
        `NOTES\n${JSON.stringify(written.notes, null, 2)}`
      : null;

  const counts = localCounts(essay);
  const canRun = mode === "review" ? Boolean(activePrompt) && Boolean(essay.trim()) : Boolean(activePrompt);

  return (
    <div className="shell">
      <header className="topbar">
        <Wordmark />
        <span className="card__sub" style={{ marginLeft: 6 }}>
          {t.brandTagline}
        </span>
        <span className="topbar__spacer" />
        <div className="topbar__tools">
          <button
            type="button"
            className="iconbtn"
            onClick={() => setLang((lang === "zh" ? "en" : "zh") as Lang)}
            aria-label={t.ui.language}
            title={t.ui.language}
          >
            {lang === "zh" ? "EN" : "中文"}
          </button>
          <button
            type="button"
            className="iconbtn"
            onClick={theme.toggle}
            aria-label={t.ui.theme}
            title={t.ui.theme}
          >
            {theme.effective === "dark" ? <SunIcon /> : <MoonIcon />}
          </button>
        </div>
      </header>

      <main className="main">
        {loadError ? (
          <div className="error" style={{ marginBottom: 20 }}>
            <span className="error__icon">
              <AlertIcon />
            </span>
            <div>
              <div className="error__title">{t.errors.title}</div>
              <div>{loadError}</div>
            </div>
          </div>
        ) : null}

        <div className="row" style={{ marginBottom: 18 }}>
          <div className="segmented" role="group">
            {(["review", "write"] as const).map((m) => (
              <button
                key={m}
                type="button"
                className="segmented__item"
                aria-pressed={mode === m}
                onClick={() => setMode(m)}
              >
                {t.mode[m]}
              </button>
            ))}
          </div>
        </div>

        <div className="workbench">
          <div className="col">
            <section className="card">
              <div className="card__body stack">
                <div className="field">
                  <label className="field__label">{t.topic.label}</label>
                  <TopicPicker
                    topics={topics}
                    variantCounts={variantCounts}
                    value={selection}
                    onChange={setSelection}
                  />
                  <p className="hint">{t.topic.poolNote}</p>
                </div>

                {selection === CUSTOM ? (
                  <>
                    <div className="field">
                      <label className="field__label" htmlFor="stmt">
                        {t.topic.statement}
                      </label>
                      <textarea
                        id="stmt"
                        className="textarea"
                        rows={3}
                        style={{ minHeight: 80 }}
                        value={customStatement}
                        onChange={(e) => setCustomStatement(e.target.value)}
                      />
                    </div>
                    <div className="field">
                      <label className="field__label" htmlFor="instr">
                        {t.topic.instruction}
                      </label>
                      <textarea
                        id="instr"
                        className="textarea"
                        rows={3}
                        style={{ minHeight: 80 }}
                        placeholder={t.topic.instructionPlaceholder}
                        value={customInstruction}
                        onChange={(e) => setCustomInstruction(e.target.value)}
                      />
                      <p className="hint">{t.topic.customHint}</p>
                    </div>
                  </>
                ) : null}

                {resolved.state === "resolving" ? (
                  <p className="hint">{t.topic.resolving}</p>
                ) : null}
                {resolved.state === "error" ? <PromptError message={resolved.message} /> : null}
                {promptForDisplay ? (
                  <div>
                    <div className="sectionlabel" style={{ marginBottom: 8 }}>
                      {t.moves.title}
                    </div>
                    <PromptCard
                      prompt={promptForDisplay.prompt}
                      summary={promptForDisplay.summary}
                      showStatement={selection === CUSTOM}
                    />
                    <p className="hint" style={{ marginTop: 8 }}>
                      {t.moves.subtitle}
                    </p>
                  </div>
                ) : null}
              </div>
            </section>

            {mode === "review" ? (
              <section className="card">
                <div className="card__body stack">
                  <div className="field">
                    <div className="row" style={{ justifyContent: "space-between" }}>
                      <label className="field__label" htmlFor="essay">
                        {t.essay.label}
                      </label>
                      <span className="hint">
                        {counts.words} {t.essay.words} · {counts.paragraphs} {t.essay.paragraphs}
                      </span>
                    </div>
                    <textarea
                      id="essay"
                      className="textarea textarea--essay"
                      placeholder={t.essay.placeholder}
                      value={essay}
                      onChange={(e) => setEssay(e.target.value)}
                    />
                  </div>
                  <button
                    type="button"
                    className="btn btn--block"
                    disabled={!canRun || busy}
                    onClick={() => void runReview()}
                  >
                    {t.essay.review}
                  </button>
                  {!activePrompt ? <p className="hint">{t.essay.needTopic}</p> : null}
                </div>
              </section>
            ) : (
              <section className="card">
                <div className="card__body stack">
                  <div className="field">
                    <label className="field__label">{t.write.target}</label>
                    <div className="segmented" style={{ flexWrap: "wrap" }}>
                      {TARGET_SCORES.map((score) => (
                        <button
                          key={score}
                          type="button"
                          className="segmented__item"
                          aria-pressed={targetScore === score}
                          onClick={() => setTargetScore(score)}
                        >
                          {score.toFixed(1)}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="field">
                    <label className="field__label" htmlFor="guidance">
                      {t.write.guidance}
                    </label>
                    <input
                      id="guidance"
                      className="input"
                      placeholder={t.write.guidancePlaceholder}
                      value={guidance}
                      onChange={(e) => setGuidance(e.target.value)}
                    />
                    <p className="hint">{t.write.guidanceHint}</p>
                  </div>
                  <button
                    type="button"
                    className="btn btn--block"
                    disabled={!canRun || busy}
                    onClick={() => void runWrite()}
                  >
                    {t.write.go}
                  </button>
                  {!activePrompt ? <p className="hint">{t.essay.needTopic}</p> : null}
                </div>
              </section>
            )}
          </div>

          <div className="col col--result">
            {precheck ? <PrecheckPanel precheck={precheck} /> : null}

            {busy ? <WaitingState kind={mode} seconds={elapsed} /> : null}

            {runError ? (
              <div className="error">
                <span className="error__icon">
                  <AlertIcon />
                </span>
                <div>
                  <div className="error__title">
                    {runError.userFixable ? t.errors.fixableTitle : t.errors.title}
                  </div>
                  <div>{runError.message}</div>
                </div>
              </div>
            ) : null}

            {review ? <ReviewResult data={review} /> : null}
            {written ? <WriteResult data={written} /> : null}

            {chatContext && !busy ? <ChatThread context={chatContext} /> : null}

            {!precheck && !busy && !review && !written && !runError ? (
              <section className="card">
                <div className="empty">
                  <Logo size={54} className="empty__mark" />
                  <div className="empty__title">
                    {mode === "review" ? t.empty.reviewTitle : t.empty.writeTitle}
                  </div>
                  <p className="empty__text">
                    {mode === "review" ? t.empty.reviewText : t.empty.writeText}
                  </p>
                </div>
              </section>
            ) : null}
          </div>
        </div>
      </main>

      <footer className="footer">
        <Logo size={16} />
        <span>{t.footer.built}</span>
        <span>{t.footer.costNote}</span>
      </footer>
    </div>
  );
}
