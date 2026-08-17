import { useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import type { TaskVariant, Topic } from "../api/types";
import { VARIANTS } from "../api/types";
import { useI18n } from "../i18n";
import { ChevronIcon, SearchIcon } from "./icons";

/**
 * The topic picker.
 *
 * 158 topics in a <select> is technically a control and practically a wall:
 * every option is a 200-character sentence, and the thing a user actually wants
 * to do -- find a prompt about government funding, or see only the two_views
 * variants -- is impossible. So this is a combobox with free-text search over
 * the statement, variant filters carrying the pool counts, and keyboard
 * navigation.
 *
 * "Custom topic" is a pinned first row rather than a mode switch elsewhere,
 * because from the user's point of view it is one more thing in the same list.
 */

export const CUSTOM = "custom" as const;
export type Selection = typeof CUSTOM | number;

interface Props {
  topics: Topic[];
  variantCounts: Partial<Record<TaskVariant, number>>;
  value: Selection;
  onChange: (next: Selection) => void;
}

/** Case-insensitive substring match, returning the statement with <mark> runs. */
function highlight(text: string, query: string) {
  if (!query) return text;
  const at = text.toLowerCase().indexOf(query.toLowerCase());
  if (at < 0) return text;
  return (
    <>
      {text.slice(0, at)}
      <mark>{text.slice(at, at + query.length)}</mark>
      {text.slice(at + query.length)}
    </>
  );
}

export function TopicPicker({ topics, variantCounts, value, onChange }: Props) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [variant, setVariant] = useState<TaskVariant | null>(null);
  const [active, setActive] = useState(0);

  const rootRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    return topics
      .map((topic, index) => ({ topic, index }))
      .filter(({ topic }) => {
        if (variant && topic.variant !== variant) return false;
        if (!q) return true;
        return topic.statement.toLowerCase().includes(q);
      });
  }, [topics, query, variant]);

  // Rows are the pinned "custom" entry followed by the matches, so one index
  // covers both for arrow-key navigation.
  const rowCount = matches.length + 1;

  useEffect(() => {
    setActive(0);
  }, [query, variant]);

  useEffect(() => {
    if (!open) return;
    searchRef.current?.focus();
    const onDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    listRef.current?.querySelector<HTMLElement>('[data-active="true"]')?.scrollIntoView({
      block: "nearest",
    });
  }, [active, open]);

  const commit = (row: number) => {
    if (row === 0) onChange(CUSTOM);
    else {
      const match = matches[row - 1];
      if (match) onChange(match.index);
    }
    setOpen(false);
  };

  const onKeyDown = (event: ReactKeyboardEvent) => {
    if (event.key === "Escape") {
      setOpen(false);
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((a) => Math.min(a + 1, rowCount - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      commit(active);
    }
  };

  const selected = value === CUSTOM ? null : topics[value];

  return (
    <div className="picker" ref={rootRef}>
      <button
        type="button"
        className="picker__trigger"
        aria-expanded={open}
        aria-haspopup="listbox"
        onClick={() => setOpen((o) => !o)}
      >
        <span className={`picker__value${selected ? "" : " picker__value--muted"}`}>
          {selected ? selected.statement : t.topic.custom}
        </span>
        {selected ? (
          <span className="chip chip--accent">{t.variantName[selected.variant]}</span>
        ) : null}
        <span className="picker__caret">
          <ChevronIcon />
        </span>
      </button>

      {open ? (
        <div className="picker__panel" onKeyDown={onKeyDown}>
          <div className="picker__search">
            <SearchIcon />
            <input
              ref={searchRef}
              value={query}
              placeholder={t.topic.search}
              onChange={(e) => setQuery(e.target.value)}
              aria-label={t.topic.search}
            />
          </div>

          <div className="picker__filters">
            <button
              type="button"
              className="chip chip--button"
              aria-pressed={variant === null}
              onClick={() => setVariant(null)}
            >
              {t.topic.allVariants}
              <span className="chip__count">{topics.length}</span>
            </button>
            {VARIANTS.filter((v) => variantCounts[v]).map((v) => (
              <button
                key={v}
                type="button"
                className="chip chip--button"
                aria-pressed={variant === v}
                onClick={() => setVariant((current) => (current === v ? null : v))}
              >
                {t.variantName[v]}
                <span className="chip__count">{variantCounts[v]}</span>
              </button>
            ))}
          </div>

          <div className="picker__list" role="listbox" ref={listRef}>
            <button
              type="button"
              role="option"
              className="picker__opt"
              data-active={active === 0}
              aria-selected={value === CUSTOM}
              onMouseEnter={() => setActive(0)}
              onClick={() => commit(0)}
            >
              {t.topic.custom}
              <span className="picker__opt-meta">{t.topic.customHint}</span>
            </button>

            {matches.map(({ topic, index }, row) => (
              <button
                key={topic.id}
                type="button"
                role="option"
                className="picker__opt"
                data-active={active === row + 1}
                aria-selected={value === index}
                onMouseEnter={() => setActive(row + 1)}
                onClick={() => commit(row + 1)}
              >
                {highlight(topic.statement, query.trim())}
                <span className="picker__opt-meta">{t.variantName[topic.variant]}</span>
              </button>
            ))}

            {matches.length === 0 ? <div className="picker__empty">{t.topic.noMatch}</div> : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
