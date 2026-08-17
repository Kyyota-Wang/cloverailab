import { useId } from "react";

/**
 * The CloverAI Lab mark.
 *
 * The whole figure is one shape repeated four times: a circle of radius 46
 * whose inward-facing quadrant is squared off to a 90 degree corner, rotated
 * 90/180/270 degrees. Each leaf is pushed 5 units out along its own diagonal,
 * which opens the hairline cross at the centre; the group is then scaled to
 * 0.95 to keep the margin.
 *
 * Three essay lines are KNOCKED OUT of the top-right leaf with a mask rather
 * than painted in the background colour. That is the difference between a mark
 * that works on any surface and one that only works on white -- the dark theme
 * and the favicon both rely on it.
 *
 * Everything paints in `currentColor`, so the colour comes from CSS and follows
 * the theme without a second asset.
 */

const LEAF = "M100,54 A46,46 0 1,0 54,100 L100,100 Z";

/** Three lines, two long and one short: a paragraph, in the fourth leaf. */
const LINES = (
  <g fill="none" stroke="#000" strokeWidth="9" strokeLinecap="round">
    <path d="M133,43 H163" />
    <path d="M133,55 H163" />
    <path d="M133,67 H149" />
  </g>
);

function Leaves() {
  return (
    <g transform="translate(100,100) scale(0.95) translate(-100,-100)">
      <g transform="translate(-5,-5)">
        <path d={LEAF} />
      </g>
      <g transform="rotate(90 100 100)">
        <g transform="translate(-5,-5)">
          <path d={LEAF} />
        </g>
      </g>
      <g transform="rotate(180 100 100)">
        <g transform="translate(-5,-5)">
          <path d={LEAF} />
        </g>
      </g>
      <g transform="rotate(270 100 100)">
        <g transform="translate(-5,-5)">
          <path d={LEAF} />
        </g>
      </g>
    </g>
  );
}

export interface LogoProps {
  size?: number;
  /** The stemmed lockup, for large display use. The primary mark has no stem. */
  stem?: boolean;
  title?: string;
  className?: string;
}

export function Logo({ size = 32, stem = false, title, className }: LogoProps) {
  const maskId = useId();
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 200 200"
      className={className}
      role={title ? "img" : "presentation"}
      aria-hidden={title ? undefined : true}
      aria-label={title}
      focusable="false"
    >
      {title ? <title>{title}</title> : null}
      <mask id={maskId} maskUnits="userSpaceOnUse" x="0" y="0" width="200" height="200">
        <rect width="200" height="200" fill="#fff" />
        {LINES}
      </mask>
      {stem ? (
        <>
          <path
            d="M100,138 C104,162 98,178 83,187"
            fill="none"
            stroke="currentColor"
            strokeWidth="10"
            strokeLinecap="round"
          />
          <g transform="translate(100,86) scale(0.84) translate(-100,-100)">
            <g fill="currentColor" mask={`url(#${maskId})`}>
              <Leaves />
            </g>
          </g>
        </>
      ) : (
        <g fill="currentColor" mask={`url(#${maskId})`}>
          <Leaves />
        </g>
      )}
    </svg>
  );
}

/**
 * The wordmark lockup. `AI` carries the brand colour so the name reads as
 * Clover + AI rather than as one long word.
 */
export function Wordmark({ size = 26 }: { size?: number }) {
  return (
    <span className="brand">
      <Logo size={size} className="brand__mark" title="CloverAI Lab" />
      <span className="brand__name">
        Clover<em>AI</em>
      </span>
      <span className="brand__tag">LAB</span>
    </span>
  );
}
