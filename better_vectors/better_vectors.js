// Developed by: Petar Mijailovic (leptr)
// GitHub: https://github.com/leptr
// Repo: https://github.com/leptr/bedrock-libs

function sqr(value) {
  return value * value;
}

/** Like clamp in utility.js, but the maximum wins when the bounds cross. */
function clampAxis(value, minimum, maximum) {
  if (value >= maximum) {
    return maximum;
  }
  if (value <= minimum) {
    return minimum;
  }
  return value;
}

/** Quarter-turn angle constant in degrees. */
export const RIGHT_ANGLE = 90;

/** Half-turn angle constant in degrees. */
export const HALF_CIRCLE = 180;

/** Full-turn angle constant in degrees. */
export const FULL_CIRCLE = 360;

/**
 * Divides a BVector2 or BVector3 in place, a missing scalar counting as 1.
 * @param {BVector2|BVector3} vector
 * @param {Number} scalar
 */
function divideVector(vector, scalar) {
  if (scalar === undefined) {
    scalar = 1;
  }
  scalar = 1 / scalar;
  vector.multiply(scalar);
}

/**
 * Rotates the x and y of a BVector2 or BVector3 in place by `angle` degrees
 * (about the z axis for a BVector3).
 * @param {BVector2|BVector3} vector
 * @param {Number} angle
 */
function rotateInXYPlane(vector, angle) {
  angle = (angle * Math.PI) / HALF_CIRCLE;
  const previousX = vector.x;
  const previousY = vector.y;

  vector.x = Math.cos(angle) * previousX - Math.sin(angle) * previousY;
  vector.y = Math.sin(angle) * previousX + Math.cos(angle) * previousY;
}

/**
 * Clamps the magnitude of a BVector2 or BVector3 in place. Given one bound,
 * that bound is the maximum; given two, they are the minimum and maximum.
 * @param {BVector2|BVector3} vector
 * @param {Number} minMag
 * @param {Number} maxMag
 */
function limitMagnitude(vector, minMag, maxMag) {
  let maxM = minMag;
  let minM;

  if (maxMag) {
    maxM = maxMag;
    minM = minMag;
  }

  if (minM && vector.magnitude() < minM) {
    vector.setMagnitude(minM);
  }
  if (vector.magnitude() > maxM) {
    vector.setMagnitude(maxM);
  }
}

/**
 * Mutable 2D vector helper with instance and static arithmetic utilities.
 * Angles are expressed in degrees unless stated otherwise.
 * Methods that change the vector return it, so calls can be chained. Static
 * methods leave their arguments unchanged, return a new vector, and accept any
 * object with `x` and `y`.
 * Methods throw a TypeError when a required argument is missing.
 */
export class BVector2 {
  /**
   *
   * @param {BVector2} vec1
   * @param {BVector2} vec2
   */
  static add(vec1, vec2) {
    if (vec1 === undefined || vec2 === undefined) {
      throw new TypeError(
        "No vector has been passed to the BVector2 add function",
      );
    }
    const newVec = BVector2.from(vec1);
    newVec.x += vec2.x;
    newVec.y += vec2.y;
    return newVec;
  }
  /**
   *
   * @param {BVector2} vec1
   * @param {BVector2} vec2
   */
  static subtract(vec1, vec2) {
    if (vec1 === undefined || vec2 === undefined) {
      throw new TypeError(
        "No vector has been passed to the BVector2 subtract function",
      );
    }
    const newVec = BVector2.from(vec1);
    newVec.x -= vec2.x;
    newVec.y -= vec2.y;
    return newVec;
  }
  /**
   *
   * @param {BVector2} vec
   * @param {Number} scalar
   */
  static multiply(vec, scalar) {
    if (vec === undefined) {
      throw new TypeError(
        "No vector has been passed to the BVector2 multiply function",
      );
    }
    const newVec = BVector2.from(vec);
    if (scalar === undefined) {
      scalar = 1;
    }
    newVec.x *= scalar;
    newVec.y *= scalar;
    return newVec;
  }
  /**
   *
   * @param {BVector2} vec
   * @param {Number} scalar
   */
  static divide(vec, scalar) {
    if (vec === undefined) {
      throw new TypeError(
        "No vector has been passed to the BVector2 divide function",
      );
    }
    const newVec = BVector2.from(vec);
    if (scalar === undefined) {
      scalar = 1;
    }
    newVec.x /= scalar;
    newVec.y /= scalar;
    return newVec;
  }
  /**
   *
   * @param {BVector2} vec1
   * @param {BVector2} vec2
   */
  static distance(vec1, vec2) {
    if (vec1 === undefined || vec2 === undefined) {
      throw new TypeError(
        "BVector2 distance method expects two instances of BVector2",
      );
    }
    return Math.sqrt(sqr(vec1.x - vec2.x) + sqr(vec1.y - vec2.y));
  }
  /**
   *
   * @param {BVector2} vec1
   * @param {BVector2} vec2
   * @param {Number} step
   */
  static lerp(vec1, vec2, step) {
    if (vec1 === undefined || vec2 === undefined || step === undefined) {
      throw new TypeError("Invalid arguments for the BVector2 lerp method");
    }
    const newVec = BVector2.from(vec1);
    newVec.x = (1 - step) * newVec.x + step * vec2.x;
    newVec.y = (1 - step) * newVec.y + step * vec2.y;
    return newVec;
  }
  /**
   *
   * @param {{x: number, y: number}} vec2
   */
  static from(vec2) {
    return new BVector2(vec2.x, vec2.y);
  }

  /** Backward-compatible alias of `from`. */
  static fromVector2(vec2) {
    return BVector2.from(vec2);
  }
  /**
   *
   * @param {Number} angle
   */
  static fromAngle(angle) {
    angle = (angle * Math.PI) / HALF_CIRCLE;
    return new BVector2(Math.cos(angle), Math.sin(angle));
  }
  /** Random vector with each component in the range [-1, 1). */
  static random() {
    const x = Math.random() * 2 - 1;
    const y = Math.random() * 2 - 1;
    return new BVector2(x, y);
  }
  /**
   *
   * @param {BVector2} vec1
   * @param {BVector2} vec2
   */
  static angleOffset(vec1, vec2) {
    const dot = BVector2.dotProduct(vec1, vec2);
    const mags =
      BVector2.from(vec1).magnitude() * BVector2.from(vec2).magnitude();
    if (mags === 0) {
      return 0;
    }
    const cosine = Math.max(-1, Math.min(1, dot / mags));
    return (Math.acos(cosine) * HALF_CIRCLE) / Math.PI;
  }
  /**
   *
   * @param {BVector2} vec1
   * @param {BVector2} vec2
   */
  static crossProduct(vec1, vec2) {
    if (vec1 === undefined || vec2 === undefined) {
      throw new TypeError(
        "No valid arguments provided to the BVector2 crossProduct method",
      );
    }
    return vec1.x * vec2.y - vec2.x * vec1.y;
  }
  /**
   *
   * @param {BVector2} vec1
   * @param {BVector2} vec2
   */
  static dotProduct(vec1, vec2) {
    if (vec1 === undefined || vec2 === undefined) {
      throw new TypeError(
        "No valid arguments provided to the BVector2 dotProduct method",
      );
    }
    return vec1.x * vec2.x + vec1.y * vec2.y;
  }
  x = 0;
  y = 0;
  /**
   *
   * @param {Number} x
   * @param {Number} y
   */
  constructor(x, y) {
    if (x !== undefined) {
      this.x = x;
    }
    if (y !== undefined) {
      this.y = y;
    }
  }
  /**
   *
   * @param {Number} x
   * @param {Number} y
   */
  set(x, y) {
    if (x === undefined || y === undefined) {
      throw new TypeError(
        "No value has been passed to the BVector2 set function",
      );
    }
    this.x = x;
    this.y = y;
    return this;
  }
  /**
   *
   * @param {BVector2} vec2
   */
  add(vec2) {
    if (vec2 === undefined) {
      throw new TypeError(
        "No vector has been passed to the BVector2 add function",
      );
    }
    this.x += vec2.x;
    this.y += vec2.y;
    return this;
  }
  /**
   *
   * @param {BVector2} vec2
   */
  subtract(vec2) {
    if (vec2 === undefined) {
      throw new TypeError(
        "No vector has been passed to the BVector2 subtract function",
      );
    }
    this.x -= vec2.x;
    this.y -= vec2.y;
    return this;
  }
  /**
   *
   * @param {Number} scalar
   */
  multiply(scalar) {
    if (scalar === undefined) {
      scalar = 1;
    }
    this.x *= scalar;
    this.y *= scalar;
    return this;
  }
  /**
   *
   * @param {Number} scalar
   */
  divide(scalar) {
    divideVector(this, scalar);
    return this;
  }
  /**
   * Angle of the vector in degrees, measured from the positive x axis.
   * Covers the full circle: the result is in the range (-180, 180].
   */
  angle() {
    return (Math.atan2(this.y, this.x) * HALF_CIRCLE) / Math.PI;
  }
  /**
   *
   * @param {Number} angle
   */
  rotate(angle) {
    rotateInXYPlane(this, angle);
    return this;
  }
  magnitude() {
    return Math.sqrt(sqr(this.x) + sqr(this.y));
  }
  magnitudeSqr() {
    return sqr(this.x) + sqr(this.y);
  }
  /**
   *
   * @param {Number} newMag
   */
  setMagnitude(newMag) {
    const mag = Math.sqrt(sqr(this.x) + sqr(this.y));
    if (mag === 0) {
      return this;
    }
    const ratio = newMag / mag;

    this.x *= ratio;
    this.y *= ratio;
    return this;
  }
  /**
   *
   * @param {Number} minMag
   * @param {Number} maxMag
   */
  limit(minMag, maxMag) {
    limitMagnitude(this, minMag, maxMag);
    return this;
  }
  copy() {
    return new BVector2(this.x, this.y);
  }
  normalize() {
    const mag = Math.sqrt(sqr(this.x) + sqr(this.y));

    if (mag === 0) {
      return this;
    }

    this.x /= mag;
    this.y /= mag;
    return this;
  }
  /**
   *
   * @param {BVector2} vec2
   */
  distance(vec2) {
    if (vec2 === undefined) {
      throw new TypeError(
        "You need to pass another BVector2 instance to the BVector2 distance method",
      );
    }
    return Math.sqrt(sqr(this.x - vec2.x) + sqr(this.y - vec2.y));
  }
  /**
   *
   * @param {BVector2} vec2
   * @param {Number} step
   */
  lerp(vec2, step) {
    if (vec2 === undefined || step === undefined) {
      throw new TypeError("Invalid arguments for the BVector2 lerp method");
    }
    this.x = (1 - step) * this.x + step * vec2.x;
    this.y = (1 - step) * this.y + step * vec2.y;
    return this;
  }
  /**
   *
   * @param {Number} minX
   * @param {Number} maxX
   * @param {Number} minY
   * @param {Number} maxY
   */
  clamp(minX, maxX, minY, maxY) {
    this.x = clampAxis(this.x, minX, maxX);
    this.y = clampAxis(this.y, minY, maxY);
    return this;
  }
  toVector2() {
    return { x: this.x, y: this.y };
  }
  stringify() {
    return `${this.x} ${this.y}`;
  }
  /**
   *
   * @param {BVector2} vec2
   */
  angleOffset(vec2) {
    const dot = BVector2.dotProduct(this, vec2);
    const mags = this.magnitude() * vec2.magnitude();
    if (mags === 0) {
      return 0;
    }
    const cosine = Math.max(-1, Math.min(1, dot / mags));
    return (Math.acos(cosine) * HALF_CIRCLE) / Math.PI;
  }
  /**
   *
   * @param {BVector2} vec2
   */
  crossProduct(vec2) {
    return this.x * vec2.y - vec2.x * this.y;
  }
  /**
   *
   * @param {BVector2} vec2
   */
  dotProduct(vec2) {
    return this.x * vec2.x + this.y * vec2.y;
  }
}

/**
 * Mutable 3D vector helper with geometry, rotation, and direction utilities.
 * Angles are expressed in degrees unless stated otherwise.
 * Methods that change the vector return it, so calls can be chained. Static
 * methods leave their arguments unchanged, return a new vector, and accept any
 * object with `x`, `y` and `z`.
 * Methods throw a TypeError when a required argument is missing.
 */
export class BVector3 {
  /**
   *
   * @param {BVector3} vec1
   * @param {BVector3} vec2
   */
  static add(vec1, vec2) {
    if (vec1 === undefined || vec2 === undefined) {
      throw new TypeError(
        "No vector has been passed to the BVector3 add function",
      );
    }
    const newVec = BVector3.from(vec1);
    newVec.x += vec2.x;
    newVec.y += vec2.y;
    newVec.z += vec2.z;
    return newVec;
  }
  /**
   *
   * @param {BVector3} vec1
   * @param {BVector3} vec2
   */
  static subtract(vec1, vec2) {
    if (vec1 === undefined || vec2 === undefined) {
      throw new TypeError(
        "No vector has been passed to the BVector3 subtract function",
      );
    }
    const newVec = BVector3.from(vec1);
    newVec.x -= vec2.x;
    newVec.y -= vec2.y;
    newVec.z -= vec2.z;
    return newVec;
  }
  /**
   *
   * @param {BVector3} vec
   * @param {Number} scalar
   */
  static multiply(vec, scalar) {
    if (vec === undefined) {
      throw new TypeError(
        "No vector has been passed to the BVector3 multiply function",
      );
    }
    const newVec = BVector3.from(vec);
    if (scalar === undefined) {
      scalar = 1;
    }
    newVec.x *= scalar;
    newVec.y *= scalar;
    newVec.z *= scalar;
    return newVec;
  }
  /**
   *
   * @param {BVector3} vec
   * @param {Number} scalar
   */
  static divide(vec, scalar) {
    if (vec === undefined) {
      throw new TypeError(
        "No vector has been passed to the BVector3 divide function",
      );
    }
    const newVec = BVector3.from(vec);
    if (scalar === undefined) {
      scalar = 1;
    }
    newVec.x /= scalar;
    newVec.y /= scalar;
    newVec.z /= scalar;
    return newVec;
  }
  /**
   *
   * @param {BVector3} vec1
   * @param {BVector3} vec2
   */
  static distance(vec1, vec2) {
    if (vec1 === undefined || vec2 === undefined) {
      throw new TypeError(
        "BVector3 distance method expects two instances of BVector3",
      );
    }
    return Math.sqrt(
      sqr(vec1.x - vec2.x) + sqr(vec1.y - vec2.y) + sqr(vec1.z - vec2.z),
    );
  }
  /**
   *
   * @param {BVector3} vec1
   * @param {BVector3} vec2
   * @param {Number} step
   */
  static lerp(vec1, vec2, step) {
    if (vec1 === undefined || vec2 === undefined || step === undefined) {
      throw new TypeError("Invalid arguments for the BVector3 lerp method");
    }
    const newVec = BVector3.from(vec1);
    newVec.x = (1 - step) * newVec.x + step * vec2.x;
    newVec.y = (1 - step) * newVec.y + step * vec2.y;
    newVec.z = (1 - step) * newVec.z + step * vec2.z;
    return newVec;
  }
  /**
   *
   * @param {{x: number, y: number, z: number}} vec3
   */
  static from(vec3) {
    return new BVector3(vec3.x, vec3.y, vec3.z);
  }

  /** Backward-compatible alias of `from`. */
  static fromVector3(vec3) {
    return BVector3.from(vec3);
  }
  /**
   * Unit vector from a horizontal angle and an elevation, in the usual maths
   * convention: `theta` 0 points along +X and 90 along +Z, and a positive
   * `phi` points up. This is not Bedrock's yaw and pitch; for those use
   * `fromYawPitch`.
   * @param {Number} theta
   * @param {Number} phi
   */
  static fromAngles(theta, phi) {
    theta = (theta * Math.PI) / HALF_CIRCLE;
    phi = (phi * Math.PI) / HALF_CIRCLE;
    const x = Math.cos(theta) * Math.cos(phi);
    const z = Math.sin(theta) * Math.cos(phi);
    const y = Math.sin(phi);
    return new BVector3(x, y, z);
  }
  /**
   * Unit vector pointing where an entity with this rotation is looking.
   * Uses Bedrock's convention: yaw 0 is south (+Z), 90 is west (-X), and a
   * positive pitch looks down. This is the same pair `entity.getRotation()`
   * returns, as `{ x: pitch, y: yaw }`.
   * @param {Number} yaw Yaw in degrees.
   * @param {Number} [pitch] Pitch in degrees. Defaults to 0.
   * @returns {BVector3}
   */
  static fromYawPitch(yaw, pitch = 0) {
    const yawRadians = (yaw * Math.PI) / HALF_CIRCLE;
    const pitchRadians = (pitch * Math.PI) / HALF_CIRCLE;
    return new BVector3(
      -Math.sin(yawRadians) * Math.cos(pitchRadians),
      -Math.sin(pitchRadians),
      Math.cos(yawRadians) * Math.cos(pitchRadians),
    );
  }
  /** Random vector with each component in the range [-1, 1). */
  static random() {
    const x = Math.random() * 2 - 1;
    const z = Math.random() * 2 - 1;
    const y = Math.random() * 2 - 1;
    return new BVector3(x, y, z);
  }
  /**
   *
   * @param {BVector3} vec1
   * @param {BVector3} vec2
   */
  static angleOffset(vec1, vec2) {
    const dot = BVector3.dotProduct(vec1, vec2);
    const mags =
      BVector3.from(vec1).magnitude() * BVector3.from(vec2).magnitude();
    if (mags === 0) {
      return 0;
    }
    const cosine = Math.max(-1, Math.min(1, dot / mags));
    return (Math.acos(cosine) * HALF_CIRCLE) / Math.PI;
  }
  /**
   *
   * @param {{x: number, y: number, z: number}} vec1
   * @param {{x: number, y: number, z: number}} vec2
   */
  static crossProduct(vec1, vec2) {
    if (vec1 === undefined || vec2 === undefined) {
      throw new TypeError(
        "No valid argument provided to the BVector3 crossProduct method",
      );
    }
    const x = vec1.y * vec2.z - vec1.z * vec2.y;
    const y = vec1.z * vec2.x - vec1.x * vec2.z;
    const z = vec1.x * vec2.y - vec1.y * vec2.x;
    return new BVector3(x, y, z);
  }
  /**
   *
   * @param {{x: number, y: number, z: number}} vec1
   * @param {{x: number, y: number, z: number}} vec2
   */
  static dotProduct(vec1, vec2) {
    if (vec1 === undefined || vec2 === undefined) {
      throw new TypeError(
        "No valid argument provided to the BVector3 dotProduct method",
      );
    }
    return vec1.x * vec2.x + vec1.y * vec2.y + vec1.z * vec2.z;
  }
  /**
   *
   * @param {String} blockFace
   */
  static fromBlockFace(blockFace) {
    switch (blockFace) {
      case "Up": {
        return BVector3.up();
      }
      case "Down": {
        return BVector3.down();
      }
      case "North": {
        return BVector3.north();
      }
      case "South": {
        return BVector3.south();
      }
      case "East": {
        return BVector3.east();
      }
      case "West": {
        return BVector3.west();
      }
      default: {
        return BVector3.south();
      }
    }
  }
  /**
   *
   * @param {String} blockRotation
   */
  static fromBlockRotation(blockRotation) {
    switch (blockRotation) {
      case "north": {
        return BVector3.south();
      }
      case "south": {
        return BVector3.north();
      }
      case "east": {
        return BVector3.west();
      }
      case "west": {
        return BVector3.east();
      }
      default: {
        return BVector3.north();
      }
    }
  }

  static up() {
    return new BVector3(0, 1, 0);
  }

  static down() {
    return new BVector3(0, -1, 0);
  }

  static north() {
    return new BVector3(0, 0, -1);
  }

  static south() {
    return new BVector3(0, 0, 1);
  }

  /** East is +X in Bedrock. */
  static east() {
    return new BVector3(1, 0, 0);
  }

  /** West is -X in Bedrock. */
  static west() {
    return new BVector3(-1, 0, 0);
  }
  x = 0;
  y = 0;
  z = 0;
  /**
   *
   * @param {number} x
   * @param {number} y
   * @param {number} z
   */
  constructor(x, y, z) {
    if (x !== undefined) {
      this.x = x;
    }
    if (y !== undefined) {
      this.y = y;
    }
    if (z !== undefined) {
      this.z = z;
    }
  }
  /**
   *
   * @param {number} x
   * @param {number} y
   * @param {number} z
   */
  set(x, y, z) {
    if (x === undefined || y === undefined || z === undefined) {
      throw new TypeError(
        "No value has been passed to the BVector3 set function",
      );
    }
    this.x = x;
    this.y = y;
    this.z = z;
    return this;
  }
  /**
   *
   * @param {BVector3} vec2
   */
  add(vec2) {
    if (vec2 === undefined) {
      throw new TypeError(
        "No vector has been passed to the BVector3 add function",
      );
    }
    this.x += vec2.x;
    this.y += vec2.y;
    this.z += vec2.z;
    return this;
  }
  /**
   *
   * @param {BVector3} vec2
   */
  subtract(vec2) {
    if (vec2 === undefined) {
      throw new TypeError(
        "No vector has been passed to the BVector3 subtract function",
      );
    }
    this.x -= vec2.x;
    this.y -= vec2.y;
    this.z -= vec2.z;
    return this;
  }
  /**
   *
   * @param {Number} scalar
   */
  multiply(scalar) {
    if (scalar === undefined) {
      scalar = 1;
    }
    this.x *= scalar;
    this.y *= scalar;
    this.z *= scalar;
    return this;
  }
  /**
   *
   * @param {Number} scalar
   */
  divide(scalar) {
    divideVector(this, scalar);
    return this;
  }
  /**
   * Yaw and pitch of this direction in degrees, in Bedrock's convention.
   * The opposite of `BVector3.fromYawPitch`. A zero-length vector gives 0, 0.
   * @returns {{yaw: number, pitch: number}}
   */
  toYawPitch() {
    const horizontal = Math.hypot(this.x, this.z);
    if (horizontal === 0 && this.y === 0) {
      return { yaw: 0, pitch: 0 };
    }
    return {
      yaw: (Math.atan2(-this.x, this.z) * HALF_CIRCLE) / Math.PI,
      pitch: (Math.atan2(-this.y, horizontal) * HALF_CIRCLE) / Math.PI,
    };
  }
  /**
   * Horizontal angle `theta` and elevation `phi` of this vector in degrees.
   * `theta` is the Bedrock yaw. `phi` is positive when the vector points up,
   * which is the opposite sign of Bedrock's pitch; see `toYawPitch`.
   * @returns {{theta: number, phi: number}}
   */
  angles() {
    const theta = (Math.atan2(this.x, this.z) * -HALF_CIRCLE) / Math.PI;
    const phi =
      (Math.atan(this.y / Math.sqrt(sqr(this.x) + sqr(this.z))) * HALF_CIRCLE) /
      Math.PI;
    return { theta, phi };
  }
  /**
   *
   * @param {Number} angle
   */
  rotateX(angle) {
    angle = (angle * Math.PI) / HALF_CIRCLE;
    const previousY = this.y;
    const previousZ = this.z;

    this.y = Math.cos(angle) * previousY - Math.sin(angle) * previousZ;
    this.z = Math.sin(angle) * previousY + Math.cos(angle) * previousZ;
    return this;
  }
  /**
   *
   * @param {Number} angle
   */
  rotateY(angle) {
    angle = (angle * Math.PI) / HALF_CIRCLE;
    const previousX = this.x;
    const previousZ = this.z;

    this.x = Math.cos(angle) * previousX + Math.sin(angle) * previousZ;
    this.z = Math.sin(angle) * -previousX + Math.cos(angle) * previousZ;
    return this;
  }
  /**
   *
   * @param {Number} angle
   */
  rotateZ(angle) {
    rotateInXYPlane(this, angle);
    return this;
  }
  cancelVertical() {
    const preservedMagniture = this.magnitude();
    this.y = 0;
    this.setMagnitude(preservedMagniture);
    return this;
  }
  magnitude() {
    return Math.sqrt(sqr(this.x) + sqr(this.y) + sqr(this.z));
  }
  magnitudeSqr() {
    return sqr(this.x) + sqr(this.y) + sqr(this.z);
  }
  /**
   *
   * @param {Number} newMag
   */
  setMagnitude(newMag) {
    const mag = Math.sqrt(sqr(this.x) + sqr(this.y) + sqr(this.z));
    if (mag === 0) {
      return this;
    }
    const ratio = newMag / mag;

    this.x *= ratio;
    this.y *= ratio;
    this.z *= ratio;
    return this;
  }
  /**
   *
   * @param {Number} minMag
   * @param {Number} maxMag
   */
  limit(minMag, maxMag) {
    limitMagnitude(this, minMag, maxMag);
    return this;
  }
  copy() {
    return new BVector3(this.x, this.y, this.z);
  }
  normalize() {
    const mag = this.magnitude();
    if (mag === 0) {
      return this;
    }
    const temporary = this.copy();
    this.x = temporary.x / mag;
    this.y = temporary.y / mag;
    this.z = temporary.z / mag;
    return this;
  }
  /**
   *
   * @param {BVector3} vec2
   */
  distance(vec2) {
    if (vec2 === undefined) {
      throw new TypeError(
        "You need to pass another BVector3 instance to the BVector3 distance method",
      );
    }
    return Math.sqrt(
      sqr(this.x - vec2.x) + sqr(this.y - vec2.y) + sqr(this.z - vec2.z),
    );
  }
  /**
   *
   * @param {BVector3} vec2
   * @param {Number} step
   */
  lerp(vec2, step) {
    if (vec2 === undefined || step === undefined) {
      throw new TypeError("Invalid arguments for the BVector3 lerp method");
    }
    this.x = (1 - step) * this.x + step * vec2.x;
    this.y = (1 - step) * this.y + step * vec2.y;
    this.z = (1 - step) * this.z + step * vec2.z;
    return this;
  }
  /**
   *
   * @param {Number} minX
   * @param {Number} maxX
   * @param {Number} minY
   * @param {Number} maxY
   * @param {Number} minZ
   * @param {Number} maxZ
   */
  clamp(minX, maxX, minY, maxY, minZ, maxZ) {
    this.x = clampAxis(this.x, minX, maxX);
    this.y = clampAxis(this.y, minY, maxY);
    this.z = clampAxis(this.z, minZ, maxZ);
    return this;
  }
  toVector3() {
    return { x: this.x, y: this.y, z: this.z };
  }
  stringify() {
    return `${this.x} ${this.y} ${this.z}`;
  }
  /**
   *
   * @param {BVector3} vec2
   */
  angleOffset(vec2) {
    const dot = BVector3.dotProduct(this, vec2);
    const mags = this.magnitude() * vec2.magnitude();
    if (mags === 0) {
      return 0;
    }
    const cosine = Math.max(-1, Math.min(1, dot / mags));
    return (Math.acos(cosine) * HALF_CIRCLE) / Math.PI;
  }
  /**
   *
   * @param {BVector3} vec2
   */
  crossProduct(vec2) {
    const x = this.y * vec2.z - this.z * vec2.y;
    const y = this.z * vec2.x - this.x * vec2.z;
    const z = this.x * vec2.y - this.y * vec2.x;
    return new BVector3(x, y, z);
  }
  /**
   *
   * @param {BVector3} vec2
   */
  dotProduct(vec2) {
    return this.x * vec2.x + this.y * vec2.y + this.z * vec2.z;
  }
}

// Backward-compatible lowercase aliases used by older gameplay scripts.
export const bVector2 = BVector2;
export const bVector3 = BVector3;
