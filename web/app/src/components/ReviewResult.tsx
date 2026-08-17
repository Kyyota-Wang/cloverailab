import { useState } from "react";
import type { AxisAssessment, ReviewResponse, Usage } from "../api/types";
import { useI18n } from "../i18n";
import { AlertIcon, CheckIcon, CrossIcon, InfoIcon } from "./icons";

/**
 * The review.
 *
 * Order is the argument here, and it is deliberate:
 *
 *   1. Task compliance, first and largest. It is the part of the product that
 *      does not depend on score calibration -- "you never addressed the second
 *      thing this prompt asked for" is checkable by the reader against their own
 *      essay -- and almost no other tool does it at all.
 *   2. The score, second, always with its confidence range and always with the
 *      measured harshness printed next to it rather than buried.
 *   3. Per-axis evidence, quoted from the essay.
 *   4. Suggestions.
 *
 * A collaborator who tries a good essay, gets 4.5 and works out the bias for
 * themselves is a far worse outcome than saying it upfront.
 */

function ComplianceSection({ review }: { review: ReviewResponse["review"] }) {
  const { t } = useI18n();
  const moves = review.compliance.moves;
  const done = moves.filter((m) => m.addressed).length;

  return (
    <section className="compliance">
      <header className="compliance__head">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <h2 className="compliance__title">{t.review.complianceTitle}</h2>
          <span className={done === moves.length ? "chip chip--ok" : "chip chip--risk"}>
            {done} / {moves.length}
          </span>
        </div>
        <p className="compliance__why">{t.review.complianceWhy}</p>
      </header>

      {moves.map((move, i) => (
        <div className="move" key={i}>
          <span className={`move__flag move__flag--${move.addressed ? "yes" : "no"}`}>
            {move.addressed ? <CheckIcon /> : <CrossIcon />}
          </span>
          <div>
            <div className="move__text">{move.move}</div>
            <p className="move__evidence">{move.evidence}</p>
          </div>
        </div>
      ))}
    </section>
  );
}

/** The 0-6 scale with the confidence range drawn as a band, not just printed. */
function ScoreScale({ score, range }: { score: number; range: [number, number] }) {
  const pct = (value: number) => `${(Math.max(0, Math.min(6, value)) / 6) * 100}%`;
  const width = `${((Math.min(6, range[1]) - Math.max(0, range[0])) / 6) * 100}%`;

  return (
    <div className="scale">
      <div className="scale__track" />
      <div className="scale__band" style={{ left: pct(range[0]), width }} />
      <div className="scale__dot" style={{ left: pct(score) }} />
      <div className="scale__ticks">
        {[0, 1, 2, 3, 4, 5, 6].map((n) => (
          <span key={n}>{n}</span>
        ))}
      </div>
    </div>
  );
}

function ScoreSection({ review }: { review: ReviewResponse["review"] }) {
  const { t } = useI18n();
  const anchorWord =
    review.anchorComparison.relativePosition === "above"
      ? t.review.anchorAbove
      : review.anchorComparison.relativePosition === "below"
        ? t.review.anchorBelow
        : t.review.anchorLevel;

  return (
    <section className="card">
      <div className="card__head">
        <div className="card__title">{t.review.scoreTitle}</div>
      </div>
      <div className="card__body stack">
        <div className="score">
          <div className="score__num">{review.holisticScore.toFixed(1)}</div>
          <div className="score__scale">
            <div className="hint">
              {t.review.range
                .replace("{low}", review.confidenceRange[0].toFixed(1))
                .replace("{high}", review.confidenceRange[1].toFixed(1))}
            </div>
            <ScoreScale score={review.holisticScore} range={review.confidenceRange} />
          </div>
        </div>

        <div className="note">
          <span className="note__icon">
            <AlertIcon />
          </span>
          <p>{t.review.calibration}</p>
        </div>

        {review.anchorComparison.closestAnchorId ? (
          <div className="note note--plain">
            <span className="note__icon">
              <InfoIcon />
            </span>
            <p>
              <b>{t.review.anchor}:</b> <code>{review.anchorComparison.closestAnchorId}</code> —{" "}
              {anchorWord}. {review.anchorComparison.reasoning}
            </p>
          </div>
        ) : null}
      </div>
    </section>
  );
}

function AxisRow({ axis }: { axis: AxisAssessment }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);

  return (
    <div className="axis">
      <button
        type="button"
        className="axis__head"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="axis__name">{t.axis[axis.axis] ?? axis.axis}</span>
        <span className="meter">
          <span className="meter__fill" style={{ width: `${(axis.score / 6) * 100}%` }} />
        </span>
        <span className="axis__n">{axis.score}</span>
      </button>
      {open ? (
        <div className="axis__body">
          <blockquote className="axis__quote">{axis.evidence}</blockquote>
          <p className="axis__why">{axis.reasoning}</p>
        </div>
      ) : null}
    </div>
  );
}

function UsageLine({ usage, cost }: { usage: Usage; cost: number }) {
  const { t } = useI18n();
  if (usage.calls === 0) {
    return (
      <div className="usage">
        <span>{t.usage.free}</span>
      </div>
    );
  }
  return (
    <div className="usage">
      <span>
        {t.usage.model}: {usage.model}
      </span>
      <span>
        {t.usage.output}: {usage.outputTokens.toLocaleString()} {t.usage.tokens}
      </span>
      <span>
        {t.usage.cached}: {usage.cachedInputTokens.toLocaleString()}
      </span>
      <span>
        {t.usage.cost}: ${cost.toFixed(3)}
      </span>
    </div>
  );
}

export function ReviewResult({ data }: { data: ReviewResponse }) {
  const { t } = useI18n();
  const review = data.review;

  // Empty submissions and copies of the prompt are a zero by ETS definition, so
  // the backend short-circuits before any model call: no axes, no cost.
  const mechanicalZero = review.axisAssessments.length === 0;

  return (
    <div className="stack">
      {/* On a mechanical zero the backend returns no moves, and an empty
          "0 / 0" compliance card would be noise rather than information. */}
      {review.compliance.moves.length ? <ComplianceSection review={review} /> : null}

      {mechanicalZero ? (
        <section className="card">
          <div className="card__body">
            <div className="score">
              <div className="score__num">0.0</div>
              <div className="score__scale">
                <div className="card__title">{t.review.zeroTitle}</div>
                <p className="hint" style={{ marginTop: 4 }}>
                  {t.review.zeroBody}
                </p>
              </div>
            </div>
          </div>
        </section>
      ) : (
        <ScoreSection review={review} />
      )}

      {review.axisAssessments.length ? (
        <section className="card">
          <div className="card__head">
            <div style={{ flex: 1 }}>
              <div className="card__title">{t.review.axesTitle}</div>
              <div className="card__sub">{t.ui.expand}</div>
            </div>
          </div>
          <div className="card__body">
            {review.axisAssessments.map((axis) => (
              <AxisRow key={axis.axis} axis={axis} />
            ))}
          </div>
        </section>
      ) : null}

      {review.raterCommentary ? (
        <section className="card">
          <div className="card__head">
            <div className="card__title">{t.review.commentaryTitle}</div>
          </div>
          <div className="card__body">
            <p className="commentary">{review.raterCommentary}</p>
          </div>
        </section>
      ) : null}

      {review.suggestions.length ? (
        <section className="card">
          <div className="card__head">
            <div className="card__title">{t.review.suggestionsTitle}</div>
          </div>
          <div className="card__body">
            {review.suggestions.map((suggestion, i) => (
              <div className="sug" key={i}>
                <div className="sug__head">
                  <span className="sug__rank">{suggestion.priority}</span>
                  <span className="chip">{t.axis[suggestion.axis] ?? suggestion.axis}</span>
                </div>
                <div className="sug__problem">{suggestion.problem}</div>
                <p className="sug__fix" style={{ marginTop: 5 }}>
                  {suggestion.fix}
                </p>
                {suggestion.example ? (
                  <div className="sug__example">{suggestion.example}</div>
                ) : null}
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <div className="card">
        <div className="card__body" style={{ paddingTop: 0 }}>
          <UsageLine usage={data.usage} cost={data.estimatedCostUsd} />
        </div>
      </div>
    </div>
  );
}

export { UsageLine };
