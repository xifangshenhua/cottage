/**
 * The ChatIntent a provider must return.
 * `line` is required. Optional fact/topic are stored by memory when valid.
 * Optional action/room are ignored in v1 except a same-room "talk".
 */
export const chatIntentSchema = {
  type: "object",
  required: ["line"],
  additionalProperties: true,
  properties: {
    characterId: { type: "string" },
    line: { type: "string", description: "The spoken reply. Required." },
    fact: { description: "Optional short fact for memory. Dropped if empty or too long after cap." },
    topic: { description: "Optional short topic phrase. Dropped if empty or too long after cap." },
    action: { type: "string", description: "v1: ignored unless it is talk in the current room." },
    room: { type: "string", description: "v1: ignored if it would change rooms." },
  },
};

export const chatIntentDescription = `{
  "characterId": string,
  "line": string (required; the spoken reply),
  "fact": optional short fact for memory,
  "topic": optional short topic phrase
}`;
