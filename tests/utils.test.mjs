// Developed by: Petar Mijailovic (leptr)
// GitHub: https://github.com/leptr
// Repo: https://github.com/leptr/bedrock-libs

import assert from "node:assert/strict";
import { test } from "node:test";
import * as utils from "../utils/index.js";

test("tick conversion", () => {
  assert.equal(utils.secondsToTicks(1.5), 30);
  assert.equal(utils.ticksToSeconds(30), 1.5);
});

test("clamp, lerp and remap", () => {
  assert.equal(utils.clamp(5, 0, 3), 3);
  assert.equal(utils.clamp(-5, 0, 3), 0);
  assert.equal(utils.lerp(0, 10, 0.5), 5);
  assert.equal(utils.remap(5, 0, 10, 0, 100), 50);
  assert.throws(() => utils.lerp(1, 2), TypeError);
});

test("degree helpers", () => {
  assert.ok(Math.abs(utils.sinDegrees(90) - 1) < 1e-9);
  assert.ok(Math.abs(utils.cosDegrees(180) + 1) < 1e-9);
  assert.ok(Math.abs(utils.degreesToRadians(180) - Math.PI) < 1e-9);
  assert.ok(Math.abs(utils.radiansToDegrees(Math.PI) - 180) < 1e-9);
});

test("randInt covers the whole range evenly", () => {
  const counts = { 1: 0, 2: 0, 3: 0 };
  const draws = 60000;
  for (let index = 0; index < draws; index++) {
    counts[utils.randInt(1, 3)] += 1;
  }
  for (const value of [1, 2, 3]) {
    assert.ok(Math.abs(counts[value] - draws / 3) < draws * 0.02);
  }

  const seen = new Set();
  for (let index = 0; index < 500; index++) {
    seen.add(utils.randInt(2));
  }
  assert.deepEqual([...seen].sort(), [0, 1, 2]);
  assert.throws(() => utils.randInt(), TypeError);
});

test("random picks from a range or an array", () => {
  for (let index = 0; index < 200; index++) {
    const value = utils.random(2, 4);
    assert.ok(value >= 2 && value < 4);
  }
  assert.ok(["a", "b"].includes(utils.random(["a", "b"])));
});

test("names of built-in Math functions are not exported", () => {
  for (const name of ["map", "min", "max", "log", "floor", "sin", "cos"]) {
    assert.equal(utils[name], undefined, name);
  }
});

test("ignored errors are logged only when switched on", () => {
  const original = console.log;
  const lines = [];
  console.log = (...messages) => lines.push(messages);
  try {
    utils.logIgnoredError("file:function", new Error("first"));
    assert.equal(lines.length, 0);

    utils.setIgnoredErrorLogging(true);
    utils.logIgnoredError("file:function", new Error("second"));
    assert.equal(lines.length, 1);
    assert.match(lines[0][0], /file:function/);
  } finally {
    utils.setIgnoredErrorLogging(false);
    console.log = original;
  }
});

test("the minimum severity filters messages", () => {
  const original = console.info;
  let count = 0;
  console.info = () => {
    count += 1;
  };
  try {
    utils.setMinimumLogSeverity("warn");
    utils.logger.info("hidden");
    utils.setMinimumLogSeverity("debug");
    utils.logger.info("shown");
    assert.equal(count, 1);
    assert.throws(() => utils.setMinimumLogSeverity("loud"), TypeError);
  } finally {
    utils.setMinimumLogSeverity("debug");
    console.info = original;
  }
});
