import type { WriteResponse } from "../api/types";
import { useI18n } from "../i18n";
import { AlertIcon } from "./icons";
import { UsageLine } from "./ReviewResult";

/**
 * A generated response.
 *
 * The plan comes before the essay because that is the order it was produced in:
 * the writer commits to a position, the required moves and named examples
 * first, then writes against them. Showing the plan is what separates this from
 * a text box that emits an essay -- the reader can see the argument's skeleton
 * and copy the method rather than the words.
 */

export function WriteResult({ data }: { data: WriteResponse }) {
  const { t } = useI18n();
  const target = data.notes.targetScore;

  return (
    <div className="stack">
      <section className="card">
        <div className="card__head">
          <div style={{ flex: 1 }}>
            <div className="card__title">{t.write.plan}</div>
          </div>
          <span className="chip chip--accent">{target.toFixed(1)}</span>
          <span className="chip">
            {data.wordCount} {t.essay.words}
          </span>
        </div>
        <div className="card__body stack stack--tight">
          <div>
            <div className="sectionlabel">{t.write.position}</div>
            <p style={{ marginTop: 6 }}>{data.plan.position}</p>
          </div>

          <div>
            <div className="sectionlabel">{t.write.concession}</div>
            <p style={{ marginTop: 6, color: "var(--ink-2)", fontSize: "var(--t-sm)" }}>
              {data.plan.concession}
            </p>
          </div>

          <div>
            {data.plan.bodyParagraphs.map((paragraph, i) => (
              <div className="sug" key={i}>
                <div className="sug__head">
                  <span className="sug__rank">{i + 1}</span>
                  <span className="chip">{paragraph.role}</span>
                </div>
                <div className="sug__problem">{paragraph.claim}</div>
                <p className="sug__fix" style={{ marginTop: 5 }}>
                  {paragraph.example}
                </p>
              </div>
            ))}
          </div>

          {data.plan.moveCoverage.length ? (
            <div>
              <div className="sectionlabel">{t.moves.title}</div>
              <ol className="prompt__moves" style={{ marginTop: 8 }}>
                {data.plan.moveCoverage.map((coverage, i) => (
                  <li key={i}>
                    <span>
                      <b style={{ color: "var(--ink)" }}>{coverage.move}</b>
                      <br />
                      {coverage.plan}
                    </span>
                  </li>
                ))}
              </ol>
            </div>
          ) : null}
        </div>
      </section>

      <section className="card">
        <div className="card__head">
          <div className="card__title">{t.write.essay}</div>
        </div>
        <div className="card__body">
          <div className="prose prose--essay">{data.essay}</div>
        </div>
      </section>

      <section className="card">
        <div className="card__head">
          <div className="card__title">{t.write.why.replace("{score}", target.toFixed(1))}</div>
        </div>
        <div className="card__body stack stack--tight">
          <p className="commentary">{data.notes.whyThisScores}</p>
          <div className="sectionlabel" style={{ marginTop: 6 }}>
            {target >= 6 ? t.write.boundary : t.write.higher}
          </div>
          <p className="commentary">{data.notes.ifAimingHigher}</p>

          <div className="note">
            <span className="note__icon">
              <AlertIcon />
            </span>
            <p>{t.write.factCheck}</p>
          </div>

          <UsageLine usage={data.usage} cost={data.estimatedCostUsd} />
        </div>
      </section>
    </div>
  );
}
