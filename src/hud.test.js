import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  actorsViewSignature,
  roomNavSignature,
  statusSignature,
  stylesCacheKey,
  targetOptionsSignature,
} from "./hud.js";

const rooms = [
  { id: "living", name: "客厅", icon: "home" },
  { id: "dining", name: "餐厅", icon: "dining" },
];

describe("roomNavSignature", () => {
  it("stays the same when only the active room would change", () => {
    assert.equal(roomNavSignature(rooms), roomNavSignature([...rooms]));
  });

  it("changes when a room name or the list changes", () => {
    const renamed = rooms.map((room) => room.id === "living" ? { ...room, name: "大厅" } : room);
    assert.notEqual(roomNavSignature(rooms), roomNavSignature(renamed));
    assert.notEqual(roomNavSignature(rooms), roomNavSignature(rooms.slice(0, 1)));
  });
});

describe("targetOptionsSignature", () => {
  const people = [
    { id: "linxia", name: "林夏" },
    { id: "qingqing", name: "青青" },
  ];

  it("stays the same for the same id and name list", () => {
    assert.equal(targetOptionsSignature(people), targetOptionsSignature(people.slice()));
  });

  it("changes when a name is added or renamed, so the select can be rebuilt", () => {
    assert.notEqual(
      targetOptionsSignature(people),
      targetOptionsSignature([...people, { id: "xiaonan", name: "小南" }]),
    );
    assert.notEqual(
      targetOptionsSignature(people),
      targetOptionsSignature([{ id: "linxia", name: "林夏" }, { id: "qingqing", name: "青青姐" }]),
    );
  });
});

describe("actorsViewSignature", () => {
  const base = {
    roomId: "living",
    focusedId: "qingqing",
    theme: "day",
    viewport: { width: 1280, height: 720 },
    occupants: [
      { id: "qingqing", name: "青青", action: "sit", stats: { energy: 80 } },
      { id: "linxia", name: "林夏", action: "sit", stats: { energy: 70 } },
    ],
  };

  it("ignores changing need stats so actors are not relaid out every tick", () => {
    const later = {
      ...base,
      occupants: base.occupants.map((p) => ({ ...p, stats: { energy: 79 } })),
    };
    assert.equal(actorsViewSignature(base), actorsViewSignature(later));
  });

  it("changes when a pose, focus, room, or viewport changes", () => {
    assert.notEqual(
      actorsViewSignature(base),
      actorsViewSignature({ ...base, occupants: [{ ...base.occupants[0], action: "talk" }, base.occupants[1]] }),
    );
    assert.notEqual(actorsViewSignature(base), actorsViewSignature({ ...base, focusedId: "linxia" }));
    assert.notEqual(actorsViewSignature(base), actorsViewSignature({ ...base, roomId: "dining" }));
    assert.notEqual(
      actorsViewSignature(base),
      actorsViewSignature({ ...base, viewport: { width: 800, height: 720 } }),
    );
  });
});

describe("stylesCacheKey", () => {
  it("uses a house key when no character is selected", () => {
    assert.equal(stylesCacheKey(""), "__house__");
    assert.equal(stylesCacheKey("qingqing"), "qingqing");
  });
});

describe("statusSignature", () => {
  const people = [
    { id: "qingqing", name: "青青" },
    { id: "linxia", name: "林夏" },
  ];
  const chips = [
    { key: "energy", label: "精力", value: 80 },
    { key: "familiarity", label: "熟悉", value: 12 },
    { key: "closeness", label: "亲密", value: 8 },
  ];

  it("stays the same when only the clock would change", () => {
    const base = statusSignature({ people, focusedName: "青青", chips });
    assert.equal(base, statusSignature({ people: people.slice(), focusedName: "青青", chips: chips.slice() }));
  });

  it("changes when names, focus, or rounded 熟悉 / 亲密 chips change", () => {
    const base = statusSignature({ people, focusedName: "青青", chips });
    assert.notEqual(base, statusSignature({ people, focusedName: "林夏", chips }));
    assert.notEqual(
      base,
      statusSignature({ people, focusedName: "青青", chips: chips.map((c) => c.key === "closeness" ? { ...c, value: 9 } : c) }),
    );
    assert.notEqual(
      base,
      statusSignature({ people: [people[0]], focusedName: "青青", chips }),
    );
  });
});
