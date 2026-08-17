/**
 * JSON Schema for a review.
 *
 * Property order is load-bearing, not cosmetic. Models generate object fields
 * in schema order, so the sequence below forces the grader to commit to
 * evidence before it commits to a number:
 *
 *   compliance -> per-axis judgements -> anchor comparison -> holistic score
 *
 * Putting `holisticScore` first would let it pick a number on impression and
 * then rationalise backwards, which is the classic failure of LLM graders.
 * The anchor comparison sits immediately before the score for the same
 * reason: the last thing considered should be "which officially scored
 * response is this most like".
 *
 * Structured outputs support only a subset of JSON Schema. Rejected with a
 * 400: `minimum`/`maximum`/`multipleOf`, `minLength`/`maxLength`, `minItems`
 * above 1, and `maxItems`. Bounded numbers are therefore expressed as `enum`,
 * and "exactly N items" as an object with N required properties. The guard
 * test in test/reviewer.test.ts walks this schema for those keywords, so the
 * constraint is caught locally instead of one 400 at a time.
 */

import { RUBRIC_AXES } from "../types.ts";

const HALF_POINTS = [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5, 5.5, 6];

export const REVIEW_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: [
    "compliance",
    "axisAssessments",
    "anchorComparison",
    "holisticScore",
    "confidenceRange",
    "raterCommentary",
    "suggestions",
  ],
  properties: {
    compliance: {
      type: "object",
      additionalProperties: false,
      description:
        "Whether the response performs each move its task instruction requires. Assessed first because the rubric's top criterion is scored 'in accordance with the assigned task'.",
      required: ["variant", "moves"],
      properties: {
        variant: { type: "string", description: "The task variant given in the prompt." },
        moves: {
          type: "array",
          minItems: 1,
          items: {
            type: "object",
            additionalProperties: false,
            required: ["move", "addressed", "evidence"],
            properties: {
              move: { type: "string", description: "The required move, restated." },
              addressed: { type: "boolean" },
              evidence: {
                type: "string",
                description:
                  "A short quotation from the response showing where it is addressed, or an explanation of what is missing.",
              },
            },
          },
        },
      },
    },

    // An object with one required property per axis, rather than an array of
    // five items. Structured outputs reject `minItems` above 1, so an array
    // could not enforce "exactly five"; naming the axes as properties makes
    // completeness a structural guarantee instead of a length constraint.
    // Property order still drives generation order, so the axes stay in the
    // sequence the ETS guide numbers them.
    axisAssessments: {
      type: "object",
      additionalProperties: false,
      description: "One judgement per rubric axis, in the order the ETS guide numbers them.",
      required: [...RUBRIC_AXES],
      properties: Object.fromEntries(
        RUBRIC_AXES.map((axis) => [
          axis,
          {
            type: "object",
            additionalProperties: false,
            required: ["score", "evidence", "reasoning"],
            properties: {
              score: {
                type: "integer",
                enum: [0, 1, 2, 3, 4, 5, 6],
                description:
                  "The score point whose descriptor for this axis the response best matches.",
              },
              evidence: {
                type: "string",
                description: "A direct quotation from the response. Do not paraphrase.",
              },
              reasoning: {
                type: "string",
                description:
                  "Why that quotation matches this score point's descriptor rather than the one above or below.",
              },
            },
          },
        ]),
      ),
    },

    anchorComparison: {
      type: "object",
      additionalProperties: false,
      description:
        "Calibration against officially scored responses. This is the step that anchors the number to ETS's published standard rather than to an internal impression.",
      required: ["comparedWith", "closestAnchorId", "relativePosition", "reasoning"],
      properties: {
        comparedWith: {
          type: "array",
          items: { type: "string" },
          description: "The anchor ids you weighed this response against.",
        },
        closestAnchorId: {
          type: "string",
          description:
            "The single anchor this response most resembles in quality. Its official score is the starting point for the holistic score below.",
        },
        relativePosition: { type: "string", enum: ["above", "level", "below"] },
        reasoning: {
          type: "string",
          description:
            "The specific difference that places this response above, level with, or below that anchor.",
        },
      },
    },

    holisticScore: {
      type: "number",
      enum: HALF_POINTS,
      description:
        "The overall score, in half points. Start from the official score of the closest anchor named above, then move off it only by an amount the stated difference justifies. Do not shade downward out of caution: if the response matches a 6-scored anchor, it is a 6.",
    },

    // An object rather than a two-element tuple, for the same reason as above.
    confidenceRange: {
      type: "object",
      additionalProperties: false,
      required: ["low", "high"],
      description:
        "The narrowest band you are confident contains the true score. Widen it when the response is genuinely borderline; do not report a range wider than 1.5 points.",
      properties: {
        low: { type: "number", enum: HALF_POINTS },
        high: { type: "number", enum: HALF_POINTS },
      },
    },

    raterCommentary: {
      type: "string",
      description:
        "An assessment in the register of the published ETS rater commentary: third person, about the response rather than the writer, citing specific features. 150-300 words.",
    },

    suggestions: {
      type: "array",
      description:
        "The highest-leverage changes, most valuable first. Give at most three: a longer list dilutes the advice.",
      minItems: 1,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["priority", "axis", "problem", "fix", "example"],
        properties: {
          priority: { type: "integer", enum: [1, 2, 3] },
          axis: { type: "string", enum: [...RUBRIC_AXES] },
          problem: { type: "string", description: "What is wrong, specifically." },
          fix: { type: "string", description: "What to do instead." },
          example: {
            type: "string",
            description:
              "A concrete rewrite of one sentence or passage from the response, showing the fix applied.",
          },
        },
      },
    },
  },
};
