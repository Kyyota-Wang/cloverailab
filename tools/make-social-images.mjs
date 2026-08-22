/**
 * Rasterise the social and touch icons.
 *
 * These have to be PNG, not SVG. LinkedIn, Facebook and X do not fetch SVG
 * og:image at all, and iOS Safari ignores an SVG apple-touch-icon -- so the
 * vector sources are the master and this script bakes the bitmaps the
 * platforms will actually accept.
 *
 * Run after changing the mark:
 *   node tools/make-social-images.mjs
 *
 * Output goes to web/app/public/, which Vite copies into the build.
 */

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Resvg } from "@resvg/resvg-js";

const OUT = fileURLToPath(new URL("../web/app/public/", import.meta.url));

const GREEN = "#3bb86e";
const GREEN_BRIGHT = "#4ed68c";
const INK = "#0b0f0d";
const PAPER = "#f7faf8";

/** One leaf: a circle whose inward quadrant is squared off to a right angle. */
const LEAF = "M100,54 A46,46 0 1,0 54,100 L100,100 Z";

/**
 * The mark, as markup rather than a file, so the lines that are knocked out of
 * the fourth leaf can be tuned per size. `lines` is [strokeWidth, ...paths].
 */
function mark({ id, fill, lines }) {
  return `
  <mask id="${id}" maskUnits="userSpaceOnUse" x="0" y="0" width="200" height="200">
    <rect width="200" height="200" fill="#fff"/>
    <g fill="none" stroke="#000" stroke-width="${lines.width}" stroke-linecap="round">
      ${lines.paths.map((d) => `<path d="${d}"/>`).join("\n      ")}
    </g>
  </mask>
  <g fill="${fill}" mask="url(#${id})">
    <g transform="translate(100,100) scale(0.95) translate(-100,-100)">
      <g transform="translate(-5,-5)"><path d="${LEAF}"/></g>
      <g transform="rotate(90 100 100)"><g transform="translate(-5,-5)"><path d="${LEAF}"/></g></g>
      <g transform="rotate(180 100 100)"><g transform="translate(-5,-5)"><path d="${LEAF}"/></g></g>
      <g transform="rotate(270 100 100)"><g transform="translate(-5,-5)"><path d="${LEAF}"/></g></g>
    </g>
  </g>`;
}

const THREE_LINES = {
  width: 9,
  paths: ["M133,43 H163", "M133,55 H163", "M133,67 H149"],
};

/** Two thicker lines survive small sizes where three blur together. */
const TWO_LINES = {
  width: 13,
  paths: ["M132,48 H164", "M132,64 H152"],
};

const UI_FONT = "Segoe UI, Segoe UI Variable Text, Helvetica Neue, Arial, sans-serif";

/**
 * 1200x630 is the size every scraper crops from. The mark sits left of the
 * wordmark rather than above it so the composition still reads when LinkedIn
 * crops the card to a wide strip.
 */
const og = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <rect width="1200" height="630" fill="${INK}"/>
  <rect x="0" y="0" width="1200" height="6" fill="${GREEN}"/>
  <g transform="translate(96,171) scale(1.44)">
    ${mark({ id: "ogmark", fill: GREEN_BRIGHT, lines: THREE_LINES })}
  </g>
  <g font-family="${UI_FONT}" fill="${PAPER}">
    <text x="452" y="270" font-size="76" font-weight="600" letter-spacing="-1.5">Clover<tspan fill="${GREEN_BRIGHT}">AI</tspan> Lab</text>
    <text x="456" y="330" font-size="30" font-weight="400" fill="#9aaba1">GRE Analytical Writing · Analyze an Issue</text>
    <text x="456" y="410" font-size="26" font-weight="400" fill="#e8efea">Task-compliance checking, axis-by-axis evidence,</text>
    <text x="456" y="448" font-size="26" font-weight="400" fill="#e8efea">and scoring anchored to 18 official responses.</text>
  </g>
</svg>`;

/** iOS draws its own rounded mask, so the artwork is a full-bleed square. */
const touch = `<svg xmlns="http://www.w3.org/2000/svg" width="180" height="180" viewBox="0 0 180 180">
  <rect width="180" height="180" fill="${INK}"/>
  <g transform="translate(26,26) scale(0.64)">
    ${mark({ id: "touchmark", fill: GREEN_BRIGHT, lines: TWO_LINES })}
  </g>
</svg>`;

function render(svg, file, width) {
  const png = new Resvg(svg, {
    fitTo: { mode: "width", value: width },
    font: { loadSystemFonts: true },
    background: "transparent",
  })
    .render()
    .asPng();
  writeFileSync(OUT + file, png);
  console.log(`${file.padEnd(24)} ${width}px  ${(png.length / 1024).toFixed(1)} KB`);
}

render(og, "og.png", 1200);
render(touch, "apple-touch-icon.png", 180);
