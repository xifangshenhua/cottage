import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  getPresentationCatalog,
  invalidatePresentationCatalog,
} from "./catalog.js";

const baseOpts = {
  root: "",
  settings: { characters: {}, root: "" },
  config: { pack: "v1", presenter: "html", rooms: {}, assets: {} },
};

describe("presentation catalog cache", () => {
  it("reuses the built catalog until it is invalidated", () => {
    invalidatePresentationCatalog();
    const first = getPresentationCatalog(baseOpts);
    const second = getPresentationCatalog({
      ...baseOpts,
      config: { ...baseOpts.config, pack: "v2" },
    });
    assert.equal(second, first);
    assert.equal(first.pack, "v1");
    invalidatePresentationCatalog();
    const third = getPresentationCatalog({
      ...baseOpts,
      config: { ...baseOpts.config, pack: "v2" },
    });
    assert.notEqual(third, first);
    assert.equal(third.pack, "v2");
    invalidatePresentationCatalog();
  });
});
