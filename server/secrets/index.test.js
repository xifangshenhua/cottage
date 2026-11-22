import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";
import {
  cleanKey,
  invalidateSecrets,
  loadSecrets,
  saveSecrets,
  secretStatus,
  secretsPath,
  validateSecretsPatch,
} from "./index.js";
import { resolveTextCredentials, resolveVoiceCredentials, resolveMinimaxBaseUrl } from "./resolve.js";

function tempRoot() {
  const root = mkdtempSync(path.join(tmpdir(), "house-secrets-"));
  mkdirSync(path.join(root, "data"), { recursive: true });
  mkdirSync(path.join(root, "settings"), { recursive: true });
  return root;
}

const roots = [];
afterEach(() => {
  for (const root of roots) invalidateSecrets(root);
  roots.length = 0;
});

function makeRoot() {
  const root = tempRoot();
  roots.push(root);
  return root;
}

describe("secrets store", () => {
  it("saves only to data/secrets.json with 0600 and reloads", () => {
    const root = makeRoot();
    const result = saveSecrets(root, {
      house: { minimaxApiKey: "  test-house-minimax  " },
    });
    assert.equal(result.ok, true);
    const file = secretsPath(root);
    const raw = JSON.parse(readFileSync(file, "utf8"));
    assert.equal(raw.house.minimaxApiKey, "test-house-minimax");
    const mode = statSync(file).mode & 0o777;
    assert.equal(mode, 0o600);
    const loaded = loadSecrets(root, { reload: true });
    assert.equal(loaded.house.minimaxApiKey, "test-house-minimax");
  });

  it("omitting a field or sending empty string does not overwrite", () => {
    const root = makeRoot();
    saveSecrets(root, { house: { minimaxApiKey: "keep-me", voiceApiKey: "voice-keep" } });
    saveSecrets(root, { house: { minimaxApiKey: "", deepseekApiKey: "" } });
    const loaded = loadSecrets(root, { reload: true });
    assert.equal(loaded.house.minimaxApiKey, "keep-me");
    assert.equal(loaded.house.voiceApiKey, "voice-keep");
    assert.equal(loaded.house.deepseekApiKey, undefined);
  });

  it("clear flag removes a saved key", () => {
    const root = makeRoot();
    saveSecrets(root, { house: { minimaxApiKey: "keep-me", voiceApiKey: "voice-keep" } });
    saveSecrets(root, { house: { minimaxApiKeyClear: true } });
    const loaded = loadSecrets(root, { reload: true });
    assert.equal(loaded.house.minimaxApiKey, undefined);
    assert.equal(loaded.house.voiceApiKey, "voice-keep");
  });

  it("rejects unknown keys and does not write", () => {
    const root = makeRoot();
    const result = saveSecrets(root, { house: { token: "nope" } });
    assert.equal(result.ok, false);
    assert.equal(loadSecrets(root, { reload: true }).house.token, undefined);
    try {
      readFileSync(secretsPath(root), "utf8");
      assert.fail("should not write");
    } catch (err) {
      assert.equal(err.code, "ENOENT");
    }
  });

  it("maps character modelApiKey to the current provider field", () => {
    const root = makeRoot();
    const settings = { root, house: { model: { provider: "minimax", model: "MiniMax-M3.1-Flash" } }, characters: { qingqing: {} } };
    const result = saveSecrets(root, {
      characters: { qingqing: { modelApiKey: "test-qingqing-minimax", voiceApiKey: "test-qingqing-voice" } },
    }, { settings });
    assert.equal(result.ok, true);
    const loaded = loadSecrets(root, { reload: true });
    assert.equal(loaded.characters.qingqing.minimaxApiKey, "test-qingqing-minimax");
    assert.equal(loaded.characters.qingqing.voiceApiKey, "test-qingqing-voice");
    assert.equal(loaded.characters.qingqing.modelApiKey, undefined);
  });

  it("secretStatus never includes key material", () => {
    const root = makeRoot();
    saveSecrets(root, { house: { minimaxApiKey: "test-house-minimax" } });
    const status = secretStatus(loadSecrets(root, { reload: true }), {
      settings: { characters: { qingqing: {} } },
      env: { DEEPSEEK_API_KEY: "test-env-deepseek" },
    });
    const text = JSON.stringify(status);
    assert.equal(text.includes("test-house-minimax"), false);
    assert.equal(text.includes("test-env-deepseek"), false);
    assert.deepEqual(status.house.minimaxApiKey, { configured: true, source: "file" });
    assert.deepEqual(status.house.deepseekApiKey, { configured: true, source: "env" });
    assert.equal(status.house.voiceApiKey.configured, false);
    assert.equal(status.house.voiceApiKey.fallsBackTo, "minimaxApiKey");
    assert.equal(status.characters.qingqing.modelApiKey.fallsBackTo, "house");
  });

  it("validateSecretsPatch ignores empty strings", () => {
    const result = validateSecretsPatch({ house: { minimaxApiKey: "  " } });
    assert.equal(result.ok, true);
    assert.deepEqual(result.patch.house, {});
  });
});

describe("credential resolution", () => {
  const settings = {
    root: null,
    house: { model: { provider: "minimax", model: "M" } },
    characters: { qingqing: {}, linxia: { model: { provider: "minimax" } } },
  };

  it("uses character then house then env for text keys", () => {
    const root = makeRoot();
    settings.root = root;
    saveSecrets(root, {
      house: { minimaxApiKey: "test-house-minimax" },
      characters: { qingqing: { minimaxApiKey: "test-qingqing-minimax" } },
    });
    const secrets = loadSecrets(root, { reload: true });
    const env = { MINIMAX_API_KEY: "test-env-minimax" };
    const qingqing = resolveTextCredentials("qingqing", { settings, secrets, env, purpose: "chat" });
    assert.equal(qingqing.apiKey, "test-qingqing-minimax");
    assert.equal(qingqing.source, "character");
    const linxia = resolveTextCredentials("linxia", { settings, secrets, env, purpose: "chat" });
    assert.equal(linxia.apiKey, "test-house-minimax");
    assert.equal(linxia.source, "file");
    saveSecrets(root, { house: { minimaxApiKeyClear: true } });
    const after = resolveTextCredentials("linxia", { settings, secrets: loadSecrets(root, { reload: true }), env, purpose: "chat" });
    assert.equal(after.apiKey, "test-env-minimax");
    assert.equal(after.source, "env");
  });

  it("voice falls back along the designed chain; ASR skips character keys", () => {
    const root = makeRoot();
    settings.root = root;
    saveSecrets(root, {
      house: { minimaxApiKey: "test-house-minimax" },
      characters: { qingqing: { voiceApiKey: "test-qingqing-voice" } },
    });
    const secrets = loadSecrets(root, { reload: true });
    const spoken = resolveVoiceCredentials("qingqing", { settings, secrets, env: {} });
    assert.equal(spoken.apiKey, "test-qingqing-voice");
    const asr = resolveVoiceCredentials(null, { settings, secrets, env: {} });
    assert.equal(asr.apiKey, "test-house-minimax");
    assert.equal(asr.source, "file-minimax");
  });

  it("file keys beat env for the same item", () => {
    const root = makeRoot();
    settings.root = root;
    saveSecrets(root, { house: { minimaxApiKey: "test-house-minimax" } });
    const creds = resolveTextCredentials(null, {
      settings,
      secrets: loadSecrets(root, { reload: true }),
      env: { MINIMAX_API_KEY: "test-env-minimax" },
    });
    assert.equal(creds.apiKey, "test-house-minimax");
    assert.equal(creds.source, "file");
  });

  it("reads model.baseUrl then env then the default", () => {
    assert.equal(
      resolveMinimaxBaseUrl({ house: { model: { baseUrl: "https://example.test/v1/" } } }, {}),
      "https://example.test/v1",
    );
    assert.equal(
      resolveMinimaxBaseUrl({}, { MINIMAX_BASE_URL: "https://api.minimax.cn/v1/" }),
      "https://api.minimax.cn/v1",
    );
    assert.equal(resolveMinimaxBaseUrl({}, {}), "https://api.minimax.cn/v1");
  });

  it("cleanKey drops oversized values", () => {
    assert.equal(cleanKey("  ok  "), "ok");
    assert.equal(cleanKey("x".repeat(600)), "");
  });
});
