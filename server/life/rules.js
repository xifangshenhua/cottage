import { config } from "./config.js";
import { getAction, isNight, resolveRoom } from "./actions.js";
import { canEnter } from "./occupancy.js";

/**
 * Propose legal action options for a character. Does not write to the world.
 * Priority (lower is sooner): finish a short in-progress eat/wash even if
 * energy is low or night has started; then, during the day, eat before starting
 * a nap; at night, bedtime before starting a new meal; then wash, sit.
 */
export function propose(world, character, clock, cfg = config) {
  const options = [];
  const life = cfg ?? config;
  const night = isNight(clock, life);

  if (isShortAction(character.action)) {
    const option = legalOption(world, character, clock, character.action, 0, life);
    if (option) options.push(option);
  }

  const sleepPriority = night ? 1 : 2;
  const eatPriority = night ? 2 : 1;

  const sleepOption = legalOption(world, character, clock, "sleep", sleepPriority, life);
  if (sleepOption) options.push(sleepOption);

  const eatOption = legalOption(world, character, clock, "eat", eatPriority, life);
  if (eatOption) options.push(eatOption);

  const washOption = legalOption(world, character, clock, "wash", 3, life);
  if (washOption) options.push(washOption);

  const sitOption = legalOption(world, character, clock, "sit", 4, life);
  if (sitOption) options.push(sitOption);

  return options;
}

function isShortAction(actionId) {
  return actionId === "eat" || actionId === "wash";
}

function legalOption(world, character, clock, actionId, priority, cfg = config) {
  const def = getAction(actionId);
  if (!def) return null;
  if (actionId === "talk") return null;
  if (def.canStart && !def.canStart({ world, character, clock, cfg })) return null;
  const room = resolveRoom(def, character);
  if (!room) return null;
  if (!canEnter(world, character.id, room)) return null;
  return { action: actionId, room, priority };
}
