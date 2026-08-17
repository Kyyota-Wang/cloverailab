import type { Precheck } from "../api/types";
import { useI18n } from "../i18n";

/**
 * The deterministic layer, rendered as structure rather than as the backend's
 * pre-formatted text block.
 *
 * This is the half of the reviewer that is free and returns in about 60ms, and
 * it is shown while the 60-90 second scoring request is still in flight. The
 * point is that the user looks at real analysis of their own essay instead of a
 * spinner. It is evidence, never a verdict -- no score appears here.
 */

function Markers({ label, items, tone }: { label: string; items: string[]; tone?: "warn" }) {
  const { t } = useI18n();
  return (
    <div>
      <div className="hint" style={{ marginBottom: 5 }}>
        {label}
      </div>
      {items.length ? (
        <div className="row" style={{ gap: 5 }}>
          {items.map((item) => (
            <span key={item} className={tone === "warn" ? "chip chip--warn" : "chip"}>
              {item}
            </span>
          ))}
        </div>
      ) : (
        <div style={{ fontSize: "var(--t-sm)", color: "var(--ink-3)" }}>{t.precheck.none}</div>
      )}
    </div>
  );
}

export function PrecheckPanel({ precheck }: { precheck: Precheck }) {
  const { t } = useI18n();
  const overlapPct = Math.round(precheck.promptOverlap * 100);

  return (
    <section className="card">
      <div className="card__head">
        <div style={{ flex: 1 }}>
          <div className="card__title">{t.precheck.title}</div>
          <div className="card__sub">{t.precheck.subtitle}</div>
        </div>
        <span className="chip chip--ok">{t.usage.free}</span>
      </div>

      <div className="card__body stack">
        <div className="stats">
          <div className="stat">
            <div className="stat__n">{precheck.wordCount}</div>
            <div className="stat__k">{t.precheck.words}</div>
          </div>
          <div className="stat">
            <div className="stat__n">{precheck.paragraphCount}</div>
            <div className="stat__k">{t.precheck.paragraphs}</div>
          </div>
          <div className="stat">
            <div className="stat__n">{precheck.sentenceCount}</div>
            <div className="stat__k">{t.precheck.sentences}</div>
          </div>
          <div className="stat">
            <div className="stat__n">{overlapPct}%</div>
            <div className="stat__k">{t.precheck.overlap}</div>
          </div>
        </div>

        <div className="row" style={{ justifyContent: "space-between", gap: 12 }}>
          <span className="hint">{t.precheck.sentenceLength}</span>
          <span style={{ fontSize: "var(--t-sm)" }}>
            {t.precheck.sentenceLengthValue
              .replace("{mean}", String(precheck.meanSentenceWords))
              .replace("{sd}", String(precheck.sentenceLengthStdev))}
          </span>
        </div>

        <div className="row" style={{ justifyContent: "space-between", gap: 12 }}>
          <span className="hint">{t.precheck.opensByRestating}</span>
          <span className={precheck.opensByRestatingPrompt ? "chip chip--warn" : "chip"}>
            {precheck.opensByRestatingPrompt ? t.precheck.yes : t.precheck.no}
          </span>
        </div>

        <hr className="divider" style={{ margin: 0 }} />

        <Markers label={t.precheck.concession} items={precheck.concessionMarkers} />
        <Markers label={t.precheck.specificity} items={precheck.specificityMarkers} />
        <Markers label={t.precheck.formulaic} items={precheck.formulaicMarkers} tone="warn" />

        <div>
          <div className="hint" style={{ marginBottom: 5 }}>
            {t.precheck.flags}
          </div>
          {precheck.flags.length ? (
            <div className="row" style={{ gap: 5 }}>
              {precheck.flags.map((flag) => (
                <span key={flag} className="chip chip--risk">
                  {t.flag[flag] ?? flag}
                </span>
              ))}
            </div>
          ) : (
            <span className="chip chip--ok">{t.precheck.noFlags}</span>
          )}
        </div>
      </div>
    </section>
  );
}
