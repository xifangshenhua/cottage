/**
 * Settings shape (documented here; validated in index.js).
 *
 * Merge order (later wins):
 *   code defaults (think/speech/life/memory/chat/relations/mood/presentation/voice config modules)
 *   ← settings/house.json  (and settings/presentation.json for presentation)
 *   ← settings/characters/<id>.json  (appearance only for sprites; cannot change house anchors)
 *
 * Model resolution for a think pass:
 *   character.model if present
 *   else house.model
 *   else env THINK_PROVIDER + MINIMAX_MODEL (or DEEPSEEK_MODEL)
 *   else { provider: "dummy", model: null }
 *
 * NEVER put api keys, tokens, or secret-bearing URLs in these files.
 * Keys stay in `.env` (MINIMAX_API_KEY, later DEEPSEEK_API_KEY).
 * A character may override only `{ "provider", "model" }`, for example:
 *   "model": { "provider": "minimax", "model": "MiniMax-M3.1-Flash" }
 *
 * settings/house.json:
 * {
 *   model: { provider, model },
 *   identityCardChars,
 *   think: { intervalMin | intervalMs, timeoutMs, staggerMs, maxLineChars, maxReasonChars, maxPromptChars },
 *   speech: { canSpeakProactively, maxPerGameDay, minGapMin | minGapMs, quietStartHhmm, quietEndHhmm, dayStartHhmm, justEnteredMin, viewerAwayTimeoutMin, livingRoom, npcTalk: { enabled, requiresViewer, forbiddenRooms, canTalkWhenSleeping, canTalkWhenWashing, canTalkWhenEating, canTalkInQuietHours, maxPerGameDay, minGapMin, houseMaxPerHour, mouthCooldownMin, lineVisibleOnlySameRoom, setActionToTalkWhenSitting } },
 *   life: { dayStartHhmm, nightStartHhmm }  // stored; life loop still uses life/config unless later wired
 *   memory: { ...overrides of server/memory/config.js numbers, including
 *            compress: { enabled, diaryUseModel, weekUseModel, monthUseModel, episodeUseModel,
 *              skipModelOnNoInteraction, writeDiaryIfNoInteraction, modelIfPlayerChat,
 *              modelIfProactiveSpeech, modelIfNpcTalk, modelIfQuietDay, minNewContentChars,
 *              maxModelJobsPerCharacterDay, maxModelJobsPerHouseDay, staggerMs, timeoutMs,
 *              maxPromptChars, maxOutputChars, retryFailedUpgrade },
 *            idleDiaryDays, engagedDiaryDays, chatDiaryDays, chatIncludeWeek, chatIncludeMonth,
 *            model: { provider, model }  // optional compress-model override; keys stay in .env
 *          }
 *   chat: { maxInputChars, maxReplyChars, timeoutMs, mustShareRoom, canTalkWhenSleeping, canTalkWhenWashing, countAgainstProactiveCap, defaultTone, allowedTones, defaultLength, allowedLengths, styleInstructionsChars,
 *            addressing: { defaultVolume, volumes[{id,label,range,requiresTarget}], canHearWhenSleeping, canHearWhenWashing, isolatedRooms, maxResponders, sameRoomFirst, unaddressedPick, actionPreference, contextChars, houseLock } }
 *   Addressing (who can hear) is house-level only; character.chat cannot change it.
 *   relations: { ...overrides of server/relations/config.js numbers }
 *   mood: { dayStartHhmm, highMoodStart, highMoodFactor, veryHighMoodStart, veryHighMoodFactor,
 *           playerChat: { delta, maxGainPerDay, minInputChars, cooldownMs | cooldownSec },
 *           npcTalk: { speakerDelta, listenerDelta, maxGainPerDay },
 *           proactiveSpeech: { delta, maxGainPerDay } }
 *   presentation: { ...optional overrides of settings/presentation.json / server/presentation/config.js }
 *   voice: { enabled, micEnabled, autoSend, masterVolume, model, timeoutMs, maxRecordSec,
 *            cacheMaxFiles, cacheMaxMb | cacheMaxBytes, voiceId }
 * }
 *
 * settings/presentation.json (house-level sprite catalog; later wins after code defaults,
 * and may itself be overridden by house.presentation):
 * {
 *   pack, presenter, artWidth, artHeight, fit,
 *   maxVisiblePerRoom, fallbackPose, poseAlias, transitionMs, clickToFocus, showNameplates,
 *   assets: { rooms, characters, fallback }  // path patterns with {pack} {roomId} {characterId} {pose}
 *   rooms: { [roomId]: { anchors: [{ id, x, y, poses[], scale, z? }], props[] } },
 *   props: []  // reserved for later furniture occlusion
 * }
 * Addressing who can hear stays in house.chat; presentation only decides who is drawn.
 *
 * settings/relations.json:
 *   { edges: [{ from, to, familiarity, closeness, stance }] }
 *   Directed seeds only; applied when a runtime edge is missing, never overwrites world.json.
 *
 * settings/characters/<id>.json:
 * {
 *   identity: { id, name, bedroom, addressPlayerAs },
 *   persona: { traits[], speechStyle, background, likes[], dislikes[] },  // all short, stable
 *   think: { intervalMin | intervalMs, timeoutMs },
 *   speech: { canSpeakProactively, maxPerGameDay, minGapMin, quietStartHhmm, quietEndHhmm },
 *   life: { nightStartHhmm, dayStartHhmm, optional need thresholds },
 *   startingStats: { energy, hunger, clean, mood, bond },  // seed only; never reset existing world.json
 *   chat: { defaultTone, allowedTones, defaultLength, allowedLengths, and any house.chat style/flag/number — not addressing }
 *   appearance: { dir, scale, preferredAnchors: { [roomId]: anchorId } }  // optional; missing uses fallback silhouettes
 *   model: { provider, model }  // optional
 *   voice: { enabled, voiceId, speed, customVoiceId }  // TTS only; defaults live in code
 * }
 *
 * Runtime state stays in data/world.json: room, action, stats, lastThinkAt,
 * lastProactiveAt, lines, relations. Cultivation must not rewrite persona files
 * or seed stances on existing edges. stats.bond is a composite HUD value
 * (familiarity 40% + closeness 60% by default), not the source of truth.
 */
export const SETTINGS_SHAPE = "see file comment";
