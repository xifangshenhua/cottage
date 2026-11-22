import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { characters, statusStatChips } from "./world.js";

describe("statusStatChips", () => {
  it("shows 熟悉 and 亲密 from viewer relations and drops the composite bond chip", () => {
    const focused = {
      id: "qingqing",
      name: "青青",
      stats: { energy: 74.4, hunger: 66.2, clean: 82, mood: 71, bond: 18 },
    };
    const chips = statusStatChips(focused, {
      qingqing: { familiarity: 18.4, closeness: 19.6, stance: "companion" },
    });
    const labels = chips.map((c) => c.label);
    assert.deepEqual(labels, ["精力", "饱食", "整洁", "心情", "熟悉", "亲密"]);
    assert.equal(chips.find((c) => c.key === "energy").value, 74);
    assert.equal(chips.find((c) => c.key === "familiarity").value, 18);
    assert.equal(chips.find((c) => c.key === "closeness").value, 20);
    assert.equal(chips.some((c) => c.key === "bond" || c.label === "熟悉度"), false);
  });

  it("falls back to a single 关系 chip when relations are missing", () => {
    const focused = { ...characters.qingqing, id: "qingqing" };
    const chips = statusStatChips(focused, undefined);
    const bond = chips.find((c) => c.key === "bond");
    assert.ok(bond);
    assert.equal(bond.label, "关系");
    assert.equal(bond.value, focused.stats.bond);
    assert.equal(chips.some((c) => c.label === "熟悉度" || c.key === "familiarity"), false);
  });
});
