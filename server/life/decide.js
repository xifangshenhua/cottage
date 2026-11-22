/**
 * Pick one legal option by priority (lower number wins).
 * Swap this module later for a model that chooses among the same options;
 * needs, actions, rules, and apply should not need to change.
 */
export function pick(options, _context) {
  if (!options?.length) return null;
  let chosen = options[0];
  for (const option of options) {
    const p = option.priority ?? 99;
    if (p < (chosen.priority ?? 99)) chosen = option;
  }
  return chosen;
}
