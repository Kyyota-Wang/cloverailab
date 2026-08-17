import { useState } from "react";
import { api, ApiError } from "../api/client";
import { useI18n } from "../i18n";

/**
 * Follow-up questions about the result on screen.
 *
 * There is no server-side state: the client carries the context, which is the
 * prompt, the essay and the assessment. /api/chat loads neither the rubric nor
 * the anchors, which is why a follow-up costs roughly a twentieth of the call
 * that produced the thing being discussed.
 */

interface Turn {
  question: string;
  answer: string | null;
  error?: string;
}

export function ChatThread({ context }: { context: string }) {
  const { t } = useI18n();
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);

  const send = async () => {
    const question = draft.trim();
    if (!question || busy) return;
    setDraft("");
    setBusy(true);
    const index = turns.length;
    setTurns((current) => [...current, { question, answer: null }]);

    try {
      const data = await api.chat({ context, question });
      setTurns((current) =>
        current.map((turn, i) => (i === index ? { ...turn, answer: data.answer } : turn)),
      );
    } catch (cause) {
      const message = cause instanceof ApiError ? cause.message : String(cause);
      setTurns((current) =>
        current.map((turn, i) => (i === index ? { ...turn, answer: "", error: message } : turn)),
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="chat">
      <div className="sectionlabel">{t.chat.title}</div>

      {turns.length ? (
        <div className="chat__thread">
          {turns.map((turn, i) => (
            <div key={i} style={{ display: "contents" }}>
              <div className="bubble bubble--q">{turn.question}</div>
              {turn.error ? (
                <div className="error" style={{ alignSelf: "flex-start" }}>
                  <span>{turn.error}</span>
                </div>
              ) : (
                <div className="bubble bubble--a">{turn.answer ?? t.chat.thinking}</div>
              )}
            </div>
          ))}
        </div>
      ) : null}

      <form
        className="chat__form"
        onSubmit={(event) => {
          event.preventDefault();
          void send();
        }}
      >
        <input
          className="input"
          value={draft}
          placeholder={t.chat.placeholder}
          onChange={(event) => setDraft(event.target.value)}
          aria-label={t.chat.title}
        />
        <button type="submit" className="btn" disabled={busy || !draft.trim()}>
          {t.chat.send}
        </button>
      </form>
    </div>
  );
}
