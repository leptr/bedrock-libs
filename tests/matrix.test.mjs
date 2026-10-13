// Developed by: Petar Mijailovic (leptr)
// GitHub: https://github.com/leptr
// Repo: https://github.com/leptr/bedrock-libs

import assert from "node:assert/strict";
import { test } from "node:test";
import { Matrix } from "../matrix/index.js";

function matrix2x2(values) {
  const m = new Matrix(2, 2);
  m.setRow(0, values.slice(0, 2));
  m.setRow(1, values.slice(2, 4));
  return m;
}

test("elements can be read and written both ways", () => {
  const m = new Matrix(2, 3);
  m[1][2] = 7;
  assert.equal(m.get(1, 2), 7);
  assert.equal(m.set(0, 0, 4), m);
  assert.equal(m[0][0], 4);
});

test("a matrix shows only rows, cols and data", () => {
  const m = new Matrix(2, 2);
  assert.deepEqual(Object.keys(m), ["rows", "cols", "data"]);
});

test("rows and columns swap", () => {
  const m = matrix2x2([1, 2, 3, 4]);
  m.swapRows(0, 1);
  assert.deepEqual(m.toArray(), [3, 4, 1, 2]);
  m.swapColumns(0, 1);
  assert.deepEqual(m.toArray(), [4, 3, 2, 1]);
});

test("serialize and deserialize round-trip", () => {
  const m = matrix2x2([1, 2, 3, 4]);
  const copy = Matrix.deserialize(m.serialize());
  assert.ok(copy instanceof Matrix);
  assert.deepEqual(copy.toArray(), [1, 2, 3, 4]);
  copy.swapRows(0, 1);
  assert.deepEqual(m.toArray(), [1, 2, 3, 4]);
});

test("deserialize reads the older format", () => {
  const older = JSON.stringify({ 0: [1, 2], 1: [3, 4], rows: 2, cols: 2 });
  assert.deepEqual(Matrix.deserialize(older).toArray(), [1, 2, 3, 4]);
});

test("the matrix product multiplies rows by columns", () => {
  const product = Matrix.multiply(
    matrix2x2([1, 2, 3, 4]),
    matrix2x2([5, 6, 7, 8]),
  );
  assert.deepEqual(product.toArray(), [19, 22, 43, 50]);
});

test("copy is independent of the original", () => {
  const m = matrix2x2([1, 2, 3, 4]);
  const copy = m.copy();
  copy[0][0] = 99;
  assert.equal(m[0][0], 1);
});

test("sizes that do not fit throw a RangeError", () => {
  const a = new Matrix(2, 2);
  const b = new Matrix(3, 2);
  assert.throws(() => a.add(b), RangeError);
  assert.throws(() => a.multiply(b), RangeError);
  assert.throws(() => Matrix.subtract(a, b), RangeError);
  assert.throws(() => Matrix.multiply(a, b), RangeError);
  assert.equal(Matrix.multiply(b, a).rows, 3);
});
