/**
 * The ThinkIntent a provider must return.
 * `fact` is an optional short memory fact. Invalid values are dropped.
 */
export const thinkIntentSchema = {
  type: "object",
  required: ["characterId"],
  additionalProperties: true,
  properties: {
    characterId: { type: "string" },
    action: {
      type: "string",
      description: "Must be one of the legal options, or omitted to keep the current action.",
    },
    room: { type: "string" },
    speech: {
      type: "object",
      properties: {
        to: { type: "string", description: '"viewer" or a character id' },
        line: { type: "string" },
        reason: { type: "string", description: "Concrete reason; required if speaking" },
      },
    },
    fact: { description: "Optional short fact for memory. Ignored if empty or too long after cap." },
  },
};

export const thinkIntentDescription = `{
  "characterId": string,
  "action": string (one of the legal options, or omit to keep the current action),
  "room": string (optional; must match the chosen option),
  "speech": { "to": "viewer" | characterId, "line": string, "reason": string } | omitted,
  "fact": optional short fact for memory
}`;
