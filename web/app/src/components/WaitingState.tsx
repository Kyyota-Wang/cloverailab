import { useEffect, useState } from "react";
import { useI18n } from "../i18n";

/**
 * The wait.
 *
 * Scoring takes 60-90 seconds and the backend has no streaming yet, so there is
 * nothing honest to show as progress. A progress bar here would be a lie that
 * fills at a rate unrelated to anything. Instead: a real elapsed counter, the
 * actual expected range, a description of what the model is doing, and skeletons
 * shaped like the sections that are coming.
 */

export function useElapsed(active: boolean): number {
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    if (!active) {
      setSeconds(0);
      return;
    }
    const started = Date.now();
    const id = window.setInterval(() => {
      setSeconds(Math.floor((Date.now() - started) / 1000));
    }, 250);
    return () => window.clearInterval(id);
  }, [active]);

  return seconds;
}

interface Props {
  kind: "review" | "write";
  seconds: number;
}

export function WaitingState({ kind, seconds }: Props) {
  const { t } = useI18n();
  const range = kind === "review" ? "60–90" : "40–105";

  return (
    <div className="stack">
      <div className="waiting">
        <span className="spinner" />
        <div className="waiting__text">
          <div className="waiting__title">
            {kind === "review" ? t.waiting.reviewTitle : t.waiting.writeTitle}
          </div>
          <div className="waiting__sub">
            {kind === "review" ? t.waiting.reviewSub : t.waiting.writeSub}{" "}
            {t.waiting.typical.replace("{range}", range)}
          </div>
        </div>
        <div className="waiting__clock">
          {seconds}
          {t.ui.seconds}
        </div>
      </div>

      <div className="card">
        <div className="card__body skeleton__group">
          <div className="skeleton" style={{ height: 22, width: "38%" }} />
          <div className="skeleton" style={{ height: 13, width: "92%" }} />
          <div className="skeleton" style={{ height: 13, width: "84%" }} />
          <div className="skeleton" style={{ height: 13, width: "66%" }} />
          <div className="skeleton" style={{ height: 40, width: "100%", marginTop: 8 }} />
          <div className="skeleton" style={{ height: 13, width: "78%" }} />
          <div className="skeleton" style={{ height: 13, width: "88%" }} />
        </div>
      </div>
    </div>
  );
}
