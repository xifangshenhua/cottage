import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isAllowedListenHost, listenStatus, normalizeListenHost, resolveListenHost } from "./listen.js";

describe("listen host", () => {
  it("defaults to 127.0.0.1", () => {
    assert.equal(resolveListenHost({}, {}), "127.0.0.1");
  });

  it("prefers a saved house address over env", () => {
    assert.equal(
      resolveListenHost({ house: { server: { host: "0.0.0.0" } } }, { HOST: "127.0.0.1" }),
      "0.0.0.0",
    );
  });

  it("accepts IPs and localhost, and normalizes localhost", () => {
    assert.equal(isAllowedListenHost("127.0.0.1"), true);
    assert.equal(isAllowedListenHost("0.0.0.0"), true);
    assert.equal(isAllowedListenHost("::"), true);
    assert.equal(isAllowedListenHost("localhost"), true);
    assert.equal(normalizeListenHost("localhost"), "127.0.0.1");
    assert.equal(isAllowedListenHost("example.com"), false);
    assert.equal(isAllowedListenHost("not an ip"), false);
    assert.equal(resolveListenHost({ house: { server: { host: "evil.example" } } }, { HOST: "127.0.0.1" }), "127.0.0.1");
  });

  it("marks a restart when the runtime host differs", () => {
    const status = listenStatus(
      { house: { server: { host: "0.0.0.0" } } },
      { runtimeHost: "127.0.0.1", runtimePort: 8787 },
    );
    assert.equal(status.host, "0.0.0.0");
    assert.equal(status.restartRequired, true);
  });
});
