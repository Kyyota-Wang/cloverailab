import type { PromptSpec } from "../api/types";
import { useI18n } from "../i18n";
import { AlertIcon } from "./icons";

/**
 * The prompt, and what this variant of the task requires.
 *
 * This sits above the essay box on purpose. The six Issue instruction variants
 * ask for materially different things -- two_views wants both given views
 * handled, claim_and_reason wants a separate stance on the claim and on the
 * reason -- and most lost points are here rather than in the prose. Showing the
 * required moves before the user writes is the same information the result page
 * checks them against afterwards.
 */

interface Props {
  prompt: PromptSpec;
  summary: string;
  showStatement?: boolean;
}

export function PromptCard({ prompt, summary, showStatement = false }: Props) {
  const { t } = useI18n();
  return (
    <div className="prompt">
      {showStatement ? <p className="prompt__statement">{prompt.statement}</p> : null}
      <div className="row" style={{ marginTop: showStatement ? 12 : 0 }}>
        <span className="chip chip--accent">{t.variantName[prompt.variant]}</span>
        <span className="hint" style={{ flex: 1, minWidth: 180 }}>
          {summary}
        </span>
      </div>
      <ol className="prompt__moves">
        {prompt.requiredMoves.map((move) => (
          <li key={move}>
            <span>{move}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

/**
 * Shown when /api/resolve cannot classify a pasted instruction.
 *
 * The backend refuses to guess on purpose: a wrong variant would make the whole
 * compliance check rest on a false premise, turning the most valuable part of
 * the product into confident misinformation. Its 400 message is written for a
 * person, so it is displayed as-is.
 */
export function PromptError({ message }: { message: string }) {
  const { t } = useI18n();
  return (
    <div className="prompt prompt--error">
      <div className="row" style={{ flexWrap: "nowrap", alignItems: "flex-start", gap: 10 }}>
        <span style={{ color: "var(--risk)", marginTop: 2, flex: "none", display: "flex" }}>
          <AlertIcon />
        </span>
        <div>
          <div style={{ fontWeight: 600, color: "var(--risk)", fontSize: "var(--t-sm)" }}>
            {t.topic.unrecognised}
          </div>
          <p className="prompt__statement" style={{ marginTop: 4 }}>
            {message}
          </p>
        </div>
      </div>
    </div>
  );
}
