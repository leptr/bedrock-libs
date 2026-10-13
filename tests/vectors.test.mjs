// Developed by: Petar Mijailovic (leptr)
// GitHub: https://github.com/leptr
// Repo: https://github.com/leptr/bedrock-libs

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  BVector2,
  BVector3,
  bVector2,
  bVector3,
} from "../better_vectors/index.js";

const close = (actual, expected) =>
  assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} is not ${expected}`);

test("directions follow the Bedrock axes", () => {
  assert.deepEqual(BVector3.east().toVector3(), { x: 1, y: 0, z: 0 });
  assert.deepEqual(BVector3.west().toVector3(), { x: -1, y: 0, z: 0 });
  assert.deepEqual(BVector3.north().toVector3(), { x: 0, y: 0, z: -1 });
  assert.deepEqual(BVector3.south().toVector3(), { x: 0, y: 0, z: 1 });
  assert.deepEqual(BVector3.up().toVector3(), { x: 0, y: 1, z: 0 });
  assert.deepEqual(BVector3.down().toVector3(), { x: 0, y: -1, z: 0 });
});

test("static methods return a new vector and leave their arguments alone", () => {
  const a = new BVector2(2, 4);
  assert.deepEqual(BVector2.multiply(a, 3).toVector2(), { x: 6, y: 12 });
  assert.deepEqual(BVector2.divide(a, 2).toVector2(), { x: 1, y: 2 });
  assert.deepEqual(a.toVector2(), { x: 2, y: 4 });

  const b = new BVector3(1, 2, 3);
  assert.deepEqual(BVector3.add(b, b).toVector3(), { x: 2, y: 4, z: 6 });
  assert.deepEqual(b.toVector3(), { x: 1, y: 2, z: 3 });
});

test("static methods accept plain objects", () => {
  const sum = BVector3.add({ x: 1, y: 2, z: 3 }, { x: 1, y: 1, z: 1 });
  assert.ok(sum instanceof BVector3);
  assert.deepEqual(sum.toVector3(), { x: 2, y: 3, z: 4 });
  assert.equal(
    BVector3.distance({ x: 0, y: 0, z: 0 }, { x: 3, y: 4, z: 0 }),
    5,
  );
  close(BVector3.angleOffset({ x: 1, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }), 90);
  assert.deepEqual(
    BVector2.subtract({ x: 5, y: 5 }, { x: 2, y: 1 }).toVector2(),
    { x: 3, y: 4 },
  );
});

test("methods that change the vector can be chained", () => {
  const v = new BVector3(1, 0, 0).add({ x: 1, y: 0, z: 0 }).multiply(2);
  assert.deepEqual(v.toVector3(), { x: 4, y: 0, z: 0 });
  assert.equal(v.normalize(), v);
  assert.deepEqual(v.toVector3(), { x: 1, y: 0, z: 0 });

  const zero = new BVector3(0, 0, 0);
  assert.equal(zero.normalize(), zero);
  assert.equal(zero.setMagnitude(5), zero);

  const w = new BVector2(3, 4).normalize().multiply(10);
  close(w.x, 6);
  close(w.y, 8);
});

test("angle covers the full circle", () => {
  close(new BVector2(1, 0).angle(), 0);
  close(new BVector2(1, 1).angle(), 45);
  close(new BVector2(-1, 0).angle(), 180);
  close(new BVector2(0, -1).angle(), -90);
});

test("yaw and pitch use the Bedrock convention and round-trip", () => {
  const south = BVector3.fromYawPitch(0, 0);
  close(south.x, 0);
  close(south.z, 1);
  const west = BVector3.fromYawPitch(90, 0);
  close(west.x, -1);
  close(west.z, 0);
  close(BVector3.fromYawPitch(0, 90).y, -1);

  for (const [yaw, pitch] of [
    [0, 0],
    [45, 10],
    [-120, -35],
    [170, 60],
  ]) {
    const result = BVector3.fromYawPitch(yaw, pitch).toYawPitch();
    close(result.yaw, yaw);
    close(result.pitch, pitch);
  }
  assert.deepEqual(new BVector3(0, 0, 0).toYawPitch(), { yaw: 0, pitch: 0 });
});

test("fromYawPitch agrees with angles and fromAngles", () => {
  const direction = BVector3.fromYawPitch(30, 20);
  const { theta, phi } = direction.angles();
  close(theta, 30);
  close(phi, -20);
  const viaAngles = BVector3.fromAngles(30 + 90, -20);
  close(viaAngles.x, direction.x);
  close(viaAngles.y, direction.y);
  close(viaAngles.z, direction.z);
});

test("random stays inside -1 to 1 and reaches both halves", () => {
  let hasNegative = false;
  let hasPositive = false;
  for (let index = 0; index < 500; index++) {
    const { x } = BVector3.random();
    assert.ok(x >= -1 && x < 1);
    hasNegative ||= x < 0;
    hasPositive ||= x > 0;
  }
  assert.ok(hasNegative && hasPositive);
});

test("clamp limits each axis", () => {
  const v = new BVector3(5, -5, 0).clamp(-1, 1, -1, 1, -1, 1);
  assert.deepEqual(v.toVector3(), { x: 1, y: -1, z: 0 });
});

test("a missing argument throws a TypeError", () => {
  const v2 = new BVector2(1, 2);
  const v3 = new BVector3(1, 2, 3);
  const cases = [
    () => v2.add(),
    () => v2.subtract(),
    () => v2.set(1),
    () => v2.distance(),
    () => v2.lerp(v2),
    () => BVector2.add(v2),
    () => BVector2.multiply(),
    () => BVector2.distance(v2),
    () => BVector2.crossProduct(v2),
    () => v3.add(),
    () => v3.set(1, 2),
    () => v3.distance(),
    () => BVector3.subtract(v3),
    () => BVector3.divide(),
    () => BVector3.distance(undefined, v3),
    () => BVector3.lerp(v3, v3),
    () => BVector3.dotProduct(v3),
  ];
  for (const run of cases) {
    assert.throws(run, TypeError);
  }
});

test("older names still work", () => {
  assert.equal(bVector2, BVector2);
  assert.equal(bVector3, BVector3);
  assert.deepEqual(BVector3.fromVector3({ x: 1, y: 2, z: 3 }).toVector3(), {
    x: 1,
    y: 2,
    z: 3,
  });
  assert.deepEqual(BVector2.fromVector2({ x: 1, y: 2 }).toVector2(), {
    x: 1,
    y: 2,
  });
});
