import { pick } from "../../life/decide.js";

/**
 * In-process, deterministic provider. No network.
 * Chooses a legal option with the same priority rule as life/decide.pick.
 * Stays silent unless tests pass `{ speak: true }` or a `speech` payload.
 */
export function createDummyProvider({ speak = false, speech } = {}) {
  return {
    name: "dummy",
    async complete({ context, options, character } = {}) {
      const list = options ?? context?.options ?? [];
      const subject = character ?? context?.character;
      const chosen = pick(list) ?? (
        subject ? { action: subject.action, room: subject.room } : null
      );
      const intent = {
        characterId: subject?.id,
      };
      if (chosen?.action) {
        intent.action = chosen.action;
        if (chosen.room) intent.room = chosen.room;
      }
      if (speak || speech) {
        intent.speech = speech ?? {
          to: "viewer",
          line: `${subject?.name ?? subject?.id ?? "有人"}看了过来。`,
          reason: "测试强制开口",
        };
      }
      return intent;
    },
  };
}
