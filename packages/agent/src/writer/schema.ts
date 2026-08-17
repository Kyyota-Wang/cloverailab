/**
 * JSON Schema for a generated response.
 *
 * As in the reviewer, property order is load-bearing: the plan is generated
 * before the essay, so the essay is written against a committed position and
 * a specific set of examples rather than discovered a sentence at a time.
 * That is what stops the output drifting into the shapeless five-paragraph
 * template an LLM produces by default.
 *
 * Same structured-output constraints apply: no `minimum`/`maximum`,
 * no `minItems` above 1, no `maxItems`. See the reviewer's schema.
 */

export const WRITE_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["plan", "essay", "notes"],
  properties: {
    plan: {
      type: "object",
      additionalProperties: false,
      description:
        "The plan a test taker would make in the first three minutes. Written before the essay, and the essay must follow it.",
      required: ["position", "moveCoverage", "bodyParagraphs", "concession"],
      properties: {
        position: {
          type: "string",
          description:
            "The thesis, stated as one committed sentence. Not a summary of both sides.",
        },
        moveCoverage: {
          type: "array",
          minItems: 1,
          description:
            "How the response will perform each move this task variant requires. One entry per required move.",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["move", "plan"],
            properties: {
              move: { type: "string" },
              plan: { type: "string", description: "Where and how it will be addressed." },
            },
          },
        },
        bodyParagraphs: {
          type: "array",
          minItems: 1,
          description:
            "The body paragraphs. Deliberately uneven: one paragraph should carry more weight than the others, as in real strong responses.",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["claim", "example", "role"],
            properties: {
              claim: { type: "string" },
              example: {
                type: "string",
                description:
                  "The specific, named case this paragraph will use. A real event, person, work, institution or documented situation -- not 'a study' or 'many companies'.",
              },
              role: {
                type: "string",
                description: "What this paragraph does for the argument as a whole.",
              },
            },
          },
        },
        concession: {
          type: "string",
          description:
            "The strongest genuine objection to the position, and how the response answers it rather than waving it away.",
        },
      },
    },

    essay: {
      type: "string",
      description:
        "The response itself, with paragraphs separated by blank lines. No title, no headings, no bullet points -- this is a timed handwritten-style exam response. Write only the essay text.",
    },

    notes: {
      type: "object",
      additionalProperties: false,
      description: "What was done deliberately, for the person studying this response.",
      required: ["targetScore", "whyThisScores", "ifAimingHigher"],
      properties: {
        targetScore: { type: "number", enum: [3, 3.5, 4, 4.5, 5, 5.5, 6] },
        whyThisScores: {
          type: "string",
          description:
            "Which features of this response put it at the target score point, referring to the scoring guide's descriptors.",
        },
        ifAimingHigher: {
          type: "string",
          description:
            "For a response written below 6: what specifically is missing that a 6 would have. For a 6: the one thing that most often separates it from a 5.",
        },
      },
    },
  },
};
