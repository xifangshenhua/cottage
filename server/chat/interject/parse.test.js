import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { config } from "./config.js";
import { parse } from "./parse.js";
import { formatLineLabel } from "./label.js";

describe("interject parse", () => {
  it("keeps valid lines and drops unknown, duplicate, and empty ones", () => {
    const result = parse({
      interjections: [
        { characterId: "linxia", reason: "在场被问到", line: "我有点饿了。" },
        { characterId: "ghost", reason: "invented", line: "不该出现" },
        { characterId: "linxia", reason: "dup", line: "重复" },
        { characterId: "xiaonan", reason: "ok", line: "   " },
        { characterId: "xiaonan", reason: "also", line: "我也还没吃。" },
      ],
    }, { eligibleIds: ["linxia", "xiaonan"], cfg: config });
    assert.equal(result.ok, true);
    assert.deepEqual(result.interjections, [
      { characterId: "linxia", reason: "在场被问到", line: "我有点饿了。" },
      { characterId: "xiaonan", reason: "also", line: "我也还没吃。" },
    ]);
  });

  it("returns an empty list when the model says nobody should speak", () => {
    const empty = parse({ interjections: [] }, { eligibleIds: ["linxia"], cfg: config });
    assert.equal(empty.ok, true);
    assert.deepEqual(empty.interjections, []);
    const missing = parse({ characterId: "linxia", line: "嗯。" }, { eligibleIds: ["linxia"], cfg: config });
    assert.equal(missing.ok, true);
    assert.deepEqual(missing.interjections, []);
  });

  it("rejects unparsable input, accepts fenced JSON, and truncates long lines", () => {
    assert.equal(parse("not-json", { eligibleIds: ["linxia"], cfg: config }).ok, false);
    const fenced = parse("```json\n{\"interjections\":[{\"characterId\":\"linxia\",\"reason\":\"r\",\"line\":\"你好。\"}]}\n```", {
      eligibleIds: ["linxia"],
      cfg: { ...config, maxReplyChars: 2 },
    });
    assert.equal(fenced.ok, true);
    assert.equal(fenced.interjections[0].line, "你好");
  });

  it("keeps at most maxPerMessage items in model order after filtering", () => {
    const result = parse({
      interjections: [
        { characterId: "nope", line: "x" },
        { characterId: "linxia", line: "一" },
        { characterId: "xiaonan", line: "二" },
        { characterId: "qingqing", line: "三" },
      ],
    }, { eligibleIds: ["linxia", "xiaonan", "qingqing"], cfg: { ...config, maxPerMessage: 2 } });
    assert.deepEqual(result.interjections.map((item) => item.characterId), ["linxia", "xiaonan"]);
  });
});

describe("interject line label", () => {
  it("uses 插话说 for interjections and 对你说 for a primary viewer line", () => {
    assert.equal(formatLineLabel({
      name: "青青",
      line: "吃了一点。",
      lineTo: "viewer",
      lineToName: "你",
    }), "青青对你说：吃了一点。");
    assert.equal(formatLineLabel({
      name: "林夏",
      line: "我还没吃。",
      lineTo: "viewer",
      lineToName: "你",
      lineKind: "interject",
    }), "林夏插话说：我还没吃。");
    assert.equal(formatLineLabel({
      name: "林夏",
      line: "这本书不错。",
      lineTo: "qingqing",
      lineToName: "青青",
    }), "林夏对青青说：这本书不错。");
  });
});
