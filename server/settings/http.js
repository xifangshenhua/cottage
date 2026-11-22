import { PROJECT_ROOT, resolveModel, loadSettings } from "./index.js";
import { applySettingsUpdate, buildSettingsResponse } from "./update.js";
import { listenStatus } from "./listen.js";
import { invalidatePresentationCatalog } from "../presentation/catalog.js";
import { loadSecrets, saveSecrets, secretStatus, validateSecretsPatch } from "../secrets/index.js";

export function getSettingsPayload(world, settings, opts = {}) {
  const source = settings ?? world?.settings ?? null;
  const root = opts.root ?? source?.root ?? world?.settings?.root ?? PROJECT_ROOT;
  return decorateSettingsResponse(source, { ...opts, root });
}

export function putSettingsPayload(world, body, opts = {}) {
  const root = opts.root ?? world?.settings?.root ?? PROJECT_ROOT;
  const { settingsBody, secretsPatch } = peelSecrets(body);

  if (secretsPatch != null) {
    const checked = validateSecretsPatch(secretsPatch);
    if (!checked.ok) {
      return { status: 400, body: { ok: false, error: checked.error } };
    }
  }

  const dry = applySettingsUpdate(root, settingsBody, { ...opts, dryRun: true });
  if (!dry.ok) {
    return { status: dry.status || 400, body: { ok: false, error: dry.error } };
  }

  if (secretsPatch != null) {
    const preview = saveSecrets(root, secretsPatch, {
      dryRun: true,
      settings: loadSettings({ root, reload: true }),
      resolveModel,
    });
    if (!preview.ok) {
      return { status: 400, body: { ok: false, error: preview.error } };
    }
  }

  const result = applySettingsUpdate(root, settingsBody, opts);
  if (!result.ok) {
    return { status: result.status || 400, body: { ok: false, error: result.error } };
  }

  if (secretsPatch != null) {
    const saved = saveSecrets(root, secretsPatch, {
      settings: result.settings,
      resolveModel,
    });
    if (!saved.ok) {
      return { status: 400, body: { ok: false, error: saved.error } };
    }
  }

  if (typeof world?.reloadSettings === "function") {
    world.reloadSettings(result.settings);
  } else {
    invalidatePresentationCatalog();
  }
  const payload = decorateSettingsResponse(result.settings, { ...opts, root });
  return { status: 200, body: payload };
}

export function decorateSettingsResponse(settings, opts = {}) {
  const payload = buildSettingsResponse(settings);
  const root = opts.root ?? settings?.root;
  const secrets = loadSecrets(root);
  payload.secretStatus = secretStatus(secrets, {
    settings,
    env: opts.env ?? process.env,
    resolveModel,
  });
  payload.listen = listenStatus(settings, {
    env: opts.env ?? process.env,
    runtimeHost: opts.runtimeHost,
    runtimePort: opts.runtimePort,
  });
  return payload;
}

function peelSecrets(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { settingsBody: {}, secretsPatch: null };
  }
  const { secrets, ...rest } = body;
  return { settingsBody: rest, secretsPatch: secrets === undefined ? null : secrets };
}
