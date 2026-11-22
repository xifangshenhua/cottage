import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { config as defaults, mergePresentation } from "./config.js";
import { assignSlots, mapAnchorToScreen, resolvePose } from "./layout.js";

const livingAnchors = defaults.rooms.living.anchors;
const diningAnchors = defaults.rooms.dining.anchors;
const bathroomAnchors = defaults.rooms.bathroom.anchors;
const ART = { width: defaults.artWidth, height: defaults.artHeight };

describe("mapAnchorToScreen cover-fit", () => {
  it("maps 1:1 when the viewport matches the art size", () => {
    const mid = mapAnchorToScreen({ x: 0.5, y: 0.5 }, { width: 1280, height: 720 }, ART, "cover");
    assert.equal(mid.x, 640);
    assert.equal(mid.y, 360);
    assert.equal(mid.coverScale, 1);
    const origin = mapAnchorToScreen({ x: 0, y: 0 }, { width: 1280, height: 720 }, ART, "cover");
    assert.equal(origin.x, 0);
    assert.equal(origin.y, 0);
  });

  it("crops the sides of a 16:9 still in a square viewport (known crop)", () => {
    // scale = max(720/1280, 720/720) = 1; 280px cropped on each side
    const viewport = { width: 720, height: 720 };
    const mid = mapAnchorToScreen({ x: 0.5, y: 0.5 }, viewport, ART, "cover");
    assert.equal(mid.x, 360);
    assert.equal(mid.y, 360);
    assert.equal(mid.coverScale, 1);
    const leftVisible = mapAnchorToScreen({ x: 280 / 1280, y: 0.5 }, viewport, ART, "cover");
    assert.equal(leftVisible.x, 0);
    const rightVisible = mapAnchorToScreen({ x: 1000 / 1280, y: 0.5 }, viewport, ART, "cover");
    assert.equal(rightVisible.x, 720);
    const artLeft = mapAnchorToScreen({ x: 0, y: 0.5 }, viewport, ART, "cover");
    assert.equal(artLeft.x, -280);
  });

  it("crops the top and bottom of a 16:9 still in a wider viewport", () => {
    // scale = max(1920/1280, 720/720) = 1.5; displayed 1920×1080, 180px cropped top/bottom
    const viewport = { width: 1920, height: 720 };
    const mid = mapAnchorToScreen({ x: 0.5, y: 0.5 }, viewport, ART, "cover");
    assert.equal(mid.x, 960);
    assert.equal(mid.y, 360);
    assert.equal(mid.coverScale, 1.5);
    // 180 display px cropped top/bottom = 120 art px; visible art y is [120, 600]
    const topVisible = mapAnchorToScreen({ x: 0.5, y: 120 / 720 }, viewport, ART, "cover");
    assert.equal(topVisible.y, 0);
    const bottomVisible = mapAnchorToScreen({ x: 0.5, y: 600 / 720 }, viewport, ART, "cover");
    assert.equal(bottomVisible.y, 720);
  });
});

describe("resolvePose", () => {
  it("aliases talk to sit and uses the character sit file when present", () => {
    const result = resolvePose("talk", { id: "qingqing", dir: "qingqing" }, defaults, {
      available: { character: ["sit"], fallback: ["sit", "eat", "wash", "sleep"] },
    });
    assert.equal(result.pose, "sit");
    assert.equal(result.logical, "sit");
    assert.equal(result.source, "character");
    assert.equal(result.url, "/assets/characters/v1/qingqing/sit.png");
  });

  it("falls back to the silhouette when the character pose file is missing", () => {
    const result = resolvePose("eat", { id: "qingqing", dir: "qingqing" }, defaults, {
      available: { character: [], fallback: ["sit", "eat", "wash", "sleep"] },
    });
    assert.equal(result.pose, "eat");
    assert.equal(result.source, "fallback");
    assert.equal(result.url, "/assets/characters/v1/fallback/eat.png");
  });

  it("walks the alias chain to sit, then to the fallback silhouette, and never throws", () => {
    const missingTalk = resolvePose("talk", { id: "linxia" }, defaults, {
      available: { character: [], fallback: ["sit", "eat", "wash", "sleep"] },
    });
    assert.equal(missingTalk.pose, "sit");
    assert.equal(missingTalk.source, "fallback");
    assert.equal(missingTalk.url, "/assets/characters/v1/fallback/sit.png");

    const nothing = resolvePose("dance", { id: "linxia" }, defaults, {
      exists: () => false,
    });
    assert.equal(nothing.pose, "sit");
    assert.equal(nothing.source, "fallback");
    assert.equal(nothing.url, "/assets/characters/v1/fallback/sit.png");
  });
});

describe("assignSlots", () => {
  it("honors a preferred anchor when it is free and pose-compatible", () => {
    const slots = assignSlots(
      [
        { id: "qingqing", action: "sit" },
        { id: "linxia", action: "talk" },
      ],
      livingAnchors,
      { qingqing: "sofa-right", linxia: "sofa-left" },
      defaults,
    );
    const byId = Object.fromEntries(slots.map((slot) => [slot.id, slot.anchorId]));
    assert.equal(byId.qingqing, "sofa-right");
    assert.equal(byId.linxia, "sofa-left");
  });

  it("returns the same assignment when called twice with the same occupants", () => {
    const occupants = [
      { id: "xiaonan", action: "sit", closeness: 5 },
      { id: "qingqing", action: "talk", closeness: 18 },
      { id: "linxia", action: "sit", closeness: 16 },
    ];
    const prefs = { qingqing: "sofa-left" };
    const first = assignSlots(occupants, livingAnchors, prefs, defaults);
    const second = assignSlots(occupants, livingAnchors, prefs, defaults);
    assert.deepEqual(
      first.map((slot) => ({ id: slot.id, anchorId: slot.anchorId })),
      second.map((slot) => ({ id: slot.id, anchorId: slot.anchorId })),
    );
    assert.equal(first.find((slot) => slot.id === "qingqing").anchorId, "sofa-left");
  });

  it("fills leftover seats by closeness then id when nobody has a preference", () => {
    const slots = assignSlots(
      [
        { id: "xiaonan", action: "sit", closeness: 10 },
        { id: "linxia", action: "sit", closeness: 16 },
        { id: "qingqing", action: "sit", closeness: 16 },
      ],
      livingAnchors,
      {},
      defaults,
    );
    // Two living seats. linxia and qingqing tie on closeness=16; id order picks linxia then qingqing.
    assert.equal(slots.length, 2);
    const ids = slots.map((slot) => slot.id).sort();
    assert.deepEqual(ids, ["linxia", "qingqing"]);
    const byId = Object.fromEntries(slots.map((slot) => [slot.id, slot.anchorId]));
    // First matching empty slot, processed closeness then id: linxia → sofa-left, qingqing → sofa-right.
    assert.equal(byId.linxia, "sofa-left");
    assert.equal(byId.qingqing, "sofa-right");
    assert.ok(!slots.some((slot) => slot.id === "xiaonan"));
  });

  it("caps visible characters at maxVisiblePerRoom", () => {
    const occupants = [
      { id: "a", action: "eat", closeness: 1 },
      { id: "b", action: "eat", closeness: 3 },
      { id: "c", action: "eat", closeness: 2 },
      { id: "d", action: "eat", closeness: 4 },
    ];
    const slots = assignSlots(occupants, diningAnchors, {}, defaults);
    assert.equal(slots.length, 3);
    assert.deepEqual(slots.map((slot) => slot.id).sort(), ["b", "c", "d"]);
  });

  it("only fills the single bathroom sink", () => {
    const slots = assignSlots(
      [
        { id: "qingqing", action: "wash" },
        { id: "linxia", action: "wash" },
      ],
      bathroomAnchors,
      { linxia: "sink" },
      defaults,
    );
    assert.equal(slots.length, 1);
    assert.equal(slots[0].id, "linxia");
    assert.equal(slots[0].anchorId, "sink");
  });

  it("returns no slots for an unoccupied room", () => {
    assert.deepEqual(assignSlots([], livingAnchors, {}, defaults), []);
    assert.deepEqual(assignSlots(null, livingAnchors, {}, defaults), []);
    assert.deepEqual(assignSlots([{ id: "qingqing", action: "sit" }], [], {}, defaults), []);
  });

  it("z-sorts by anchor y so lower-on-screen characters are in front", () => {
    const slots = assignSlots(
      [
        { id: "qingqing", action: "eat" },
        { id: "linxia", action: "eat" },
      ],
      diningAnchors,
      { qingqing: "seat-far-left", linxia: "seat-near-left" },
      defaults,
    );
    assert.equal(slots.length, 2);
    assert.ok(slots[0].anchor.y < slots[1].anchor.y);
    assert.equal(slots[0].id, "qingqing");
    assert.equal(slots[1].id, "linxia");
    assert.ok(slots[1].z > slots[0].z);
  });
});

describe("mergePresentation", () => {
  it("lets a house overlay change pack and add an isolated room without dropping defaults", () => {
    const merged = mergePresentation(defaults, { pack: "v2", maxVisiblePerRoom: 2 }, {
      rooms: {
        living: {
          anchors: [{ id: "sofa-left", x: 0.25, y: 0.6, scale: 0.32, poses: ["sit", "talk"] }],
        },
      },
    });
    assert.equal(merged.pack, "v2");
    assert.equal(merged.maxVisiblePerRoom, 2);
    assert.equal(merged.presenter, "html");
    assert.equal(merged.rooms.living.anchors.find((a) => a.id === "sofa-left").x, 0.25);
    assert.equal(merged.rooms.living.anchors.find((a) => a.id === "sofa-right").x, 0.55);
    assert.equal(merged.rooms.bathroom.anchors[0].id, "sink");
  });
});
