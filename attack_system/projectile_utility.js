// Developed by: Petar Mijailovic (leptr)
// GitHub: https://github.com/leptr
// Repo: https://github.com/leptr/bedrock-libs

import { BVector3 } from "../better_vectors/better_vectors.js";

// Above this |y| a direction is too close to vertical to cross with world up.
const NEAR_VERTICAL_Y_THRESHOLD = 0.999;

export function getParallelRayOrigins(center, direction, offset) {
  return getRayOriginsLine(center, direction, offset * 2, 2);
}

export function getRayOriginsLine(center, direction, length, count) {
  const normalizedDirection = direction.copy();
  normalizedDirection.normalize();

  // Choose a stable "up" vector (avoid parallel case)
  const up =
    Math.abs(normalizedDirection.y) < NEAR_VERTICAL_Y_THRESHOLD
      ? { x: 0, y: 1, z: 0 }
      : { x: 1, y: 0, z: 0 };

  // perpendicular vector (right direction)
  const right = BVector3.crossProduct(normalizedDirection, up);
  right.normalize();

  const r = [];

  const offsetFromCentrePerCount = length / count;
  for (
    let offset = -length / 2;
    offset < length / 2;
    offset += offsetFromCentrePerCount
  ) {
    const offsetVec = BVector3.multiply(right, offset);
    r.push(BVector3.add(center, offsetVec));
  }

  return r;
}

export function getParallelRayOriginsRectangle(
  center,
  direction,
  width,
  height,
) {
  const normalizedDirection = direction.copy();
  normalizedDirection.normalize();

  // Identify a stable "up" vector
  const temporaryUp =
    Math.abs(normalizedDirection.y) < NEAR_VERTICAL_Y_THRESHOLD
      ? { x: 0, y: 1, z: 0 }
      : { x: 1, y: 0, z: 0 };

  // Derive the horizontal basis vector (right)
  const right = BVector3.crossProduct(normalizedDirection, temporaryUp);
  right.normalize();

  // Derive the vertical basis vector (top)
  const top = BVector3.crossProduct(normalizedDirection, right);
  top.normalize();

  // Scale basis vectors by the offset
  const rOffset = BVector3.multiply(right, width);
  const tOffset = BVector3.multiply(top, height);

  // Calculate the four corners of the square
  return [
    center, // Centre
    BVector3.add(center, tOffset), // Top
    BVector3.subtract(center, tOffset), // Bottom
    BVector3.add(BVector3.add(center, rOffset), tOffset), // Top-Right
    BVector3.add(BVector3.subtract(center, rOffset), tOffset), // Top-Left
    BVector3.subtract(BVector3.subtract(center, rOffset), tOffset), // Bottom-Left
    BVector3.subtract(BVector3.add(center, rOffset), tOffset), // Bottom-Right
  ];
}

export function getParallelRayOriginsSquare(center, direction, offset) {
  return getParallelRayOriginsRectangle(center, direction, offset, offset);
}
