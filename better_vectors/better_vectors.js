// Developed by: Petar Mijailovic (leptr)
// GitHub: https://github.com/leptr
// Repo: https://github.com/leptr/bedrock-libs

/**
 *
 * @param {Number} num
 */
function sqr(num) {
  return num * num;
}

export const HALF_CIRCLE = 180;
export const FULL_CIRCLE = 360;

export class BVector2 {
  /**
   *
   * @param {Number} x
   * @param {Number} y
   */
  constructor(x, y) {
    // Prepare basic vector variables
    this.x = 0;
    this.y = 0;

    if (x !== undefined) {
      this.x = x;
    }
    if (y !== undefined) {
      this.y = y;
    }
  }

  // set method allows the user to update the vector coordinates
  /**
   *
   * @param {Number} x
   * @param {Number} y
   */
  set(x, y) {
    if (x === undefined || y === undefined) {
      // Handle bad arguments
      console.error("No value has been passed to the BVector2 set function");
    } else {
      // Update the vector coordinates based on the provided arguments
      this.x = x;
      this.y = y;
    }
  }

  // add method allows the user to perform addition with the provided vector
  /**
   *
   * @param {BVector2} vec2
   */
  add(vec2) {
    if (vec2 === undefined) {
      // Handle bad arguments
      console.error("No vector has been passed to the BVector2 add function");
    } else {
      // Add the provided vector
      this.x += vec2.x;
      this.y += vec2.y;
    }
  }

  // add method allows the user to perform addition with the provided vector
  /**
   *
   * @param {BVector2} vec1
   * @param {BVector2} vec2
   */
  static add(vec1, vec2) {
    if (vec1 === undefined || vec2 === undefined) {
      // Handle bad arguments
      console.error("No vector has been passed to the BVector2 add function");
      return undefined;
    } else {
      const newVec = vec1.copy();
      // Add the provided vector
      newVec.x += vec2.x;
      newVec.y += vec2.y;
      return newVec;
    }
  }

  // subtract method allows the user to perform subtraction with the provided vector
  /**
   *
   * @param {BVector2} vec2
   */
  subtract(vec2) {
    if (vec2 === undefined) {
      // Handle bad arguments
      console.error(
        "No vector has been passed to the BVector2 subtract function",
      );
    } else {
      // Subtract the provided vector
      this.x -= vec2.x;
      this.y -= vec2.y;
    }
  }

  // subtract method allows the user to perform subtraction with the provided vector
  /**
   *
   * @param {BVector2} vec1
   * @param {BVector2} vec2
   */
  static subtract(vec1, vec2) {
    if (vec1 === undefined || vec2 === undefined) {
      // Handle bad arguments
      console.error(
        "No vector has been passed to the BVector2 subtract function",
      );
      return undefined;
    } else {
      const newVec = vec1.copy();
      // Subtract the provided vector
      newVec.x -= vec2.x;
      newVec.y -= vec2.y;
      return newVec;
    }
  }

  // multiply method allows the user to perform multiplication with the provided vector
  /**
   *
   * @param {Number} num
   */
  multiply(num) {
    if (num === undefined) {
      num = 1;
    }
    this.x *= num;
    this.y *= num;
  }

  // multiply method allows the user to perform multiplication with the provided vector
  /**
   *
   * @param {BVector2} vec
   * @param {Number} num
   */
  static multiply(vec, num) {
    if (vec === undefined) {
      // Handle bad arguments
      console.error(
        "No vector has been passed to the BVector2 multiply function",
      );
      return undefined;
    } else {
      const newVec = vec.copy();
      if (num === undefined) {
        num = 1;
      }
      newVec.x *= num;
      newVec.y *= num;
      return vec;
    }
  }

  // divide method allows the user to perform division with the provided vector
  /**
   *
   * @param {Number} num
   */
  divide(num) {
    if (num === undefined) {
      num = 1;
    }
    num = 1 / num;
    this.multiply(num);
  }

  // multiply method allows the user to perform multiplication with the provided vector
  /**
   *
   * @param {BVector2} vec
   * @param {Number} num
   */
  static divide(vec, num) {
    if (vec === undefined) {
      // Handle bad arguments
      console.error(
        "No vector has been passed to the BVector2 divide function",
      );
      return undefined;
    } else {
      const newVec = vec.copy();
      if (num === undefined) {
        num = 1;
      }
      newVec.x /= num;
      newVec.y /= num;
      return vec;
    }
  }

  // angle method allows the user to get the angle of the vector
  angle() {
    return (Math.atan(this.y / this.x) * HALF_CIRCLE) / Math.PI;
  }

  // rotate method allows the user to rotate the vector by the given angle
  /**
   *
   * @param {Number} angle
   */
  rotate(angle) {
    angle = (angle * Math.PI) / HALF_CIRCLE;
    const previousX = this.x;
    const previousY = this.y;

    this.x = Math.cos(angle) * previousX - Math.sin(angle) * previousY;
    this.y = Math.sin(angle) * previousX + Math.cos(angle) * previousY;
  }

  // magnitude method allows the user to get the magnitude of the vector
  magnitude() {
    return Math.sqrt(sqr(this.x) + sqr(this.y));
  }

  // magnitudeSqr method allows the user to get the squared magnitude of the vector
  magnitudeSqr() {
    return sqr(this.x) + sqr(this.y);
  }

  // setMagnitude method allows the user to update the vector magnitude
  /**
   *
   * @param {Number} newMag
   */
  setMagnitude(newMag) {
    const mag = Math.sqrt(sqr(this.x) + sqr(this.y));
    const ratio = newMag / mag;

    this.x *= ratio;
    this.y *= ratio;
  }

  // limit method allows the user to set the maximum magnitude for the vector
  /**
   *
   * @param {Number} minMag
   * @param {Number} maxMag
   */
  limit(minMag, maxMag) {
    let maxM = minMag;
    let minM = null;

    if (maxMag) {
      maxM = maxMag;
      minM = minMag;
    }

    if (minM && this.magnitude() < minM) {
      this.setMagnitude(minM);
    }
    if (this.magnitude() > maxM) {
      this.setMagnitude(maxM);
    }
  }

  // copy method allows the user to get a copy of the vector
  copy() {
    return new BVector2(this.x, this.y);
  }

  // normalize method allows the user to normalize the vector/set its magnitude to 1
  normalize() {
    const tmp = new BVector2(this.x, this.y);

    const mag = Math.sqrt(sqr(tmp.x) + sqr(tmp.y));

    tmp.x = tmp.x / mag;
    tmp.y = tmp.y / mag;

    this.previousX = this.x;
    this.previousY = this.y;

    this.x = tmp.x;
    this.y = tmp.y;
  }

  // distance method allows the user to get the distance to another vector
  /**
   *
   * @param {BVector2} vec2
   */
  distance(vec2) {
    // Handle bad arguments
    if (vec2 === undefined) {
      console.error(
        "You need to pass another BVector2 instance to the BVector2 distance method",
      );
    } else {
      return Math.sqrt(sqr(this.x - vec2.x) + sqr(this.y - vec2.y));
    }
  }

  // distance method allows the user to get the distance to another vector
  /**
   *
   * @param {BVector2} vec1
   * @param {BVector2} vec2
   */
  static distance(vec1, vec2) {
    // Handle bad arguments
    if (vec2 === undefined) {
      console.error(
        "BVector2 distance method expects two instances of BVector2",
      );
    } else {
      return Math.sqrt(sqr(vec1.x - vec2.x) + sqr(vec1.y - vec2.y));
    }
  }

  // lerp method allows the user to lerp the vector towards another vector over time
  /**
   *
   * @param {BVector2} vec2
   * @param {Number} step
   */
  lerp(vec2, step) {
    // Handle bad arguments
    if (vec2 === undefined || step === undefined) {
      console.error("Invalid arguments for the BVector2 lerp method");
    } else {
      this.x = (1 - step) * this.x + step * vec2.x;
      this.y = (1 - step) * this.y + step * vec2.y;
    }
  }

  // lerp method allows the user to lerp the vector towards another vector over time
  /**
   *
   * @param {BVector2} vec1
   * @param {BVector2} vec2
   * @param {Number} step
   */
  static lerp(vec1, vec2, step) {
    // Handle bad arguments
    if (vec1 === undefined || vec2 === undefined || step === undefined) {
      console.error("Invalid arguments for the BVector2 lerp method");
      return undefined;
    } else {
      const newVec = vec1.copy();
      newVec.x = (1 - step) * newVec.x + step * vec2.x;
      newVec.y = (1 - step) * newVec.y + step * vec2.y;
      return newVec;
    }
  }

  // clamp method allows the user to constrain the method between the set coordinates
  /**
   *
   * @param {Number} minX
   * @param {Number} maxX
   * @param {Number} maxY
   * @param {Number} maxY
   */
  clamp(minX, maxX, minY, maxY) {
    if (this.x >= maxX) {
      this.x = maxX;
    } else if (this.x <= minX) {
      this.x = minX;
    } else {
      // do nothing
    }
    if (this.y >= maxY) {
      this.y = maxY;
    } else if (this.y <= minY) {
      this.y = minY;
    } else {
      // do nothing
    }
  }

  // from method returns a BVector2 from a Vector2
  /**
   *
   * @param {mc.Vector2} vec2
   */
  static from(vec2) {
    return new BVector2(vec2.x, vec2.y);
  }

  // toVector2 method returns a Vector2 from the BVector2
  toVector2() {
    return { x: this.x, y: this.y };
  }

  // stringify method returns a string containing the vector XYZ values
  stringify() {
    return `${this.x} ${this.y}`;
  }

  // fromAngle method returns a BVector2 from the provided angle
  /**
   *
   * @param {Number} angle
   */
  static fromAngle(angle) {
    angle = (angle * Math.PI) / HALF_CIRCLE;
    return new BVector2(Math.cos(angle), Math.sin(angle));
  }

  // Generate a random BVector2
  static random() {
    const x = Math.random();
    const y = Math.random();
    return new BVector2(x, y);
  }

  // angleOffset method returns the difference in angles between this vector and the provided vector
  /**
   *
   * @param {BVector2} vec2
   */
  angleOffset(vec2) {
    const dot = BVector2.dotProduct(this, vec2);
    const mags = this.magnitude() * vec2.magnitude();
    return (Math.acos(dot / mags) * HALF_CIRCLE) / Math.PI;
  }

  // angleOffset method returns the difference in angles between this vector and the provided vector
  /**
   *
   * @param {BVector2} vec1
   * @param {BVector2} vec2
   */
  static angleOffset(vec1, vec2) {
    const dot = BVector2.dotProduct(vec1, vec2);
    const mags = vec1.magnitude() * vec2.magnitude();
    return (Math.acos(dot / mags) * HALF_CIRCLE) / Math.PI;
  }

  // crossProduct method returns the cross product of this vector and the provided vector
  /**
   *
   * @param {BVector2} vec2
   */
  crossProduct(vec2) {
    return this.x * vec2.y - vec2.x * this.y;
  }

  // crossProduct method returns the cross product of this vector and the provided vector
  /**
   *
   * @param {BVector2} vec1
   * @param {BVector2} vec2
   */
  static crossProduct(vec1, vec2) {
    if (vec1 === undefined || vec2 === undefined) {
      console.error(
        "No valid arguments provided to the BVector2 crossProduct method",
      );
      return undefined;
    }
    return vec1.x * vec2.y - vec2.x * vec1.y;
  }

  // dotProduct method returns the dot product of two vectors
  /**
   *
   * @param {BVector2} vec2
   */
  dotProduct(vec2) {
    return this.x * vec2.x + this.y * vec2.y;
  }

  // dotProduct method returns the dot product of two vectors
  /**
   *
   * @param {BVector2} vec1
   * @param {BVector2} vec2
   */
  static dotProduct(vec1, vec2) {
    if (vec1 === undefined || vec2 === undefined) {
      console.error(
        "No valid arguments provided to the BVector2 dotProduct method",
      );
      return undefined;
    }
    return vec1.x * vec2.x + vec1.y * vec2.y;
  }
}

export class BVector3 {
  /**
   *
   * @param {number} x
   * @param {number} y
   * @param {number} z
   */
  constructor(x, y, z) {
    // Prepare basic vector variables
    this.x = 0;
    this.y = 0;
    this.z = 0;

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

  // set method allows the user to update the vector coordinates
  /**
   *
   * @param {number} x
   * @param {number} y
   * @param {number} z
   */
  set(x, y, z) {
    if (x === undefined || y === undefined || z === undefined) {
      // Handle bad arguments
      console.error("No value has been passed to the BVector3 set function");
    } else {
      // Update the vector coordinates based on the provided arguments
      this.x = x;
      this.y = y;
      this.z = z;
    }
  }

  // add method allows the user to perform addition with the provided vector
  /**
   *
   * @param {BVector3} vec2
   */
  add(vec2) {
    if (vec2 === undefined) {
      // Handle bad arguments
      console.error("No vector has been passed to the BVector3 add function");
    } else {
      // Add the provided vector
      this.x += vec2.x;
      this.y += vec2.y;
      this.z += vec2.z;
    }
  }

  // add method allows the user to perform addition with the provided vector
  /**
   *
   * @param {BVector3} vec1
   * @param {BVector3} vec2
   */
  static add(vec1, vec2) {
    if (vec1 === undefined || vec2 === undefined) {
      // Handle bad arguments
      console.error("No vector has been passed to the BVector3 add function");
      return undefined;
    } else {
      const newVec = vec1.copy();
      // Add the provided vector
      newVec.x += vec2.x;
      newVec.y += vec2.y;
      newVec.z += vec2.z;
      return newVec;
    }
  }

  // subtract method allows the user to perform subtraction with the provided vector
  /**
   *
   * @param {BVector3} vec2
   */
  subtract(vec2) {
    if (vec2 === undefined) {
      // Handle bad arguments
      console.error(
        "No vector has been passed to the BVector3 subtract function",
      );
    } else {
      // Subtract the provided vector
      this.x -= vec2.x;
      this.y -= vec2.y;
      this.z -= vec2.z;
    }
  }

  // subtract method allows the user to perform subtraction with the provided vector
  /**
   *
   * @param {BVector3} vec1
   * @param {BVector3} vec2
   */
  static subtract(vec1, vec2) {
    if (vec1 === undefined || vec2 === undefined) {
      // Handle bad arguments
      console.error(
        "No vector has been passed to the BVector3 subtract function",
      );
      return undefined;
    } else {
      const newVec = vec1.copy();
      // Subtract the provided vector
      newVec.x -= vec2.x;
      newVec.y -= vec2.y;
      newVec.z -= vec2.z;
      return newVec;
    }
  }

  // multiply method allows the user to perform multiplication with the provided vector
  /**
   *
   * @param {Number} num
   */
  multiply(num) {
    if (num === undefined) {
      num = 1;
    }
    this.x *= num;
    this.y *= num;
    this.z *= num;
  }

  // multiply method allows the user to perform multiplication with the provided vector
  /**
   *
   * @param {BVector3} vec
   * @param {Number} num
   */
  static multiply(vec, num) {
    if (vec === undefined) {
      // Handle bad arguments
      console.error(
        "No vector has been passed to the BVector3 multiply function",
      );
      return undefined;
    } else {
      const newVec = vec.copy();
      if (num === undefined) {
        num = 1;
      }
      newVec.x *= num;
      newVec.y *= num;
      newVec.z *= num;
      return newVec;
    }
  }

  // divide method allows the user to perform division with the provided vector
  /**
   *
   * @param {Number} num
   */
  divide(num) {
    if (num === undefined) {
      num = 1;
    }
    num = 1 / num;
    this.multiply(num);
  }

  // multiply method allows the user to perform multiplication with the provided vector
  /**
   *
   * @param {BVector3} vec
   * @param {Number} num
   */
  static divide(vec, num) {
    if (vec === undefined) {
      // Handle bad arguments
      console.error(
        "No vector has been passed to the BVector3 divide function",
      );
      return undefined;
    } else {
      const newVec = vec.copy();
      if (num === undefined) {
        num = 1;
      }
      newVec.x /= num;
      newVec.y /= num;
      newVec.z /= num;
      return newVec;
    }
  }

  // angle method allows the user to get the angle of the vector
  angles() {
    const theta = (Math.atan2(this.x, this.z) * -HALF_CIRCLE) / Math.PI;
    const phi =
      (Math.atan(this.y / Math.sqrt(sqr(this.x) + sqr(this.z))) * HALF_CIRCLE) /
      Math.PI;
    return { theta, phi };
  }

  // rotateX method allows the user to rotate the vector on the X axis by the given angle
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
  }

  // rotateY method allows the user to rotate the vector on the X axis by the given angle
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
  }

  // rotateZ method allows the user to rotate the vector on the X axis by the given angle
  /**
   *
   * @param {Number} angle
   */
  rotateZ(angle) {
    angle = (angle * Math.PI) / HALF_CIRCLE;
    const previousX = this.x;
    const previousY = this.y;

    this.x = Math.cos(angle) * previousX - Math.sin(angle) * previousY;
    this.y = Math.sin(angle) * previousX + Math.cos(angle) * previousY;
  }

  // magnitude method allows the user to get the magnitude of the vector
  magnitude() {
    return Math.sqrt(sqr(this.x) + sqr(this.y) + sqr(this.z));
  }

  // magnitudeSqr method allows the user to get the squared magnitude of the vector
  magnitudeSqr() {
    return sqr(this.x) + sqr(this.y) + sqr(this.z);
  }

  // setMagnitude method allows the user to update the vector magnitude
  /**
   *
   * @param {Number} newMag
   */
  setMagnitude(newMag) {
    const mag = Math.sqrt(sqr(this.x) + sqr(this.y) + sqr(this.z));
    const ratio = newMag / mag;

    this.x *= ratio;
    this.y *= ratio;
    this.z *= ratio;
  }

  // limit method allows the user to set the maximum magnitude for the vector
  /**
   *
   * @param {Number} minMag
   * @param {Number} maxMag
   */
  limit(minMag, maxMag) {
    let maxM = minMag;
    let minM = null;

    if (maxMag) {
      maxM = maxMag;
      minM = minMag;
    }

    if (minM && this.magnitude() < minM) {
      this.setMagnitude(minM);
    }
    if (this.magnitude() > maxM) {
      this.setMagnitude(maxM);
    }
  }

  // copy method allows the user to get a copy of the vector
  copy() {
    return new BVector3(this.x, this.y, this.z);
  }

  // normalize method allows the user to normalize the vector/set its magnitude to 1
  normalize() {
    const mag = this.magnitude();
    const temp = this.copy();
    this.x = temp.x / mag;
    this.y = temp.y / mag;
    this.z = temp.z / mag;
  }

  // distance method allows the user to get the distance to another vector
  /**
   *
   * @param {BVector3} vec2
   */
  distance(vec2) {
    // Handle bad arguments
    if (vec2 === undefined) {
      console.error(
        "You need to pass another BVector3 instance to the BVector3 distance method",
      );
    } else {
      return Math.sqrt(
        sqr(this.x - vec2.x) + sqr(this.y - vec2.y) + sqr(this.z - vec2.z),
      );
    }
  }

  // distance method allows the user to get the distance to another vector
  /**
   *
   * @param {BVector3} vec1
   * @param {BVector3} vec2
   */
  static distance(vec1, vec2) {
    // Handle bad arguments
    if (vec1 === undefined) {
      console.error(
        "BVector3 distance method expects two instances of BVector2",
      );
    } else {
      return Math.sqrt(
        sqr(vec1.x - vec2.x) + sqr(vec1.y - vec2.y) + sqr(vec1.z - vec2.z),
      );
    }
  }

  // lerp method allows the user to lerp the vector towards another vector over time
  /**
   *
   * @param {BVector3} vec2
   * @param {Number} step
   */
  lerp(vec2, step) {
    // Handle bad arguments
    if (vec2 === undefined || step === undefined) {
      console.error("Invalid arguments for the BVector3 lerp method");
      return undefined;
    } else {
      this.x = (1 - step) * this.x + step * vec2.x;
      this.y = (1 - step) * this.y + step * vec2.y;
      this.z = (1 - step) * this.z + step * vec2.z;
    }
  }

  // lerp method allows the user to lerp the vector towards another vector over time
  /**
   *
   * @param {BVector3} vec1
   * @param {BVector3} vec2
   * @param {Number} step
   */
  static lerp(vec1, vec2, step) {
    // Handle bad arguments
    if (vec1 === undefined || vec2 === undefined || step === undefined) {
      console.error("Invalid arguments for the BVector3 lerp method");
      return undefined;
    } else {
      const newVec = vec1.copy();
      newVec.x = (1 - step) * newVec.x + step * vec2.x;
      newVec.y = (1 - step) * newVec.y + step * vec2.y;
      newVec.z = (1 - step) * newVec.z + step * vec2.z;
      return newVec;
    }
  }

  // clamp method allows the user to constrain the method between the set coordinates
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
    if (this.x >= maxX) {
      this.x = maxX;
    } else if (this.x <= minX) {
      this.x = minX;
    } else {
      // do nothing
    }
    if (this.y >= maxY) {
      this.y = maxY;
    } else if (this.y <= minY) {
      this.y = minY;
    } else {
      // do nothing
    }
    if (this.z >= maxZ) {
      this.z = maxZ;
    } else if (this.z <= minZ) {
      this.z = minZ;
    } else {
      // do nothing
    }
  }

  // from method returns a BVector3 from the provided Vector3
  /**
   *
   * @param {BVector3} vec2
   */
  static from(vec2) {
    return new BVector3(vec2.x, vec2.y, vec2.z);
  }

  // toVector3 method returns a Vector3 from the BVector3
  toVector3() {
    return { x: this.x, y: this.y, z: this.z };
  }

  // stringify method returns a string containing the vector XYZ values
  stringify() {
    return `${this.x} ${this.y} ${this.z}`;
  }

  // fromAngles method returns a BVector3 from 2 provided angles
  /**
   *
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

  // random method returns a random BVector3
  static random() {
    const x = Math.random();
    const z = Math.random();
    const y = Math.random();
    return new BVector3(x, y, z);
  }

  // angleOffset method returns the difference in angles between this vector and the provided vector
  /**
   *
   * @param {BVector3} vec2
   */
  angleOffset(vec2) {
    const dot = BVector3.dotProduct(this, vec2);
    const mags = this.magnitude() * vec2.magnitude();
    return (Math.acos(dot / mags) * HALF_CIRCLE) / Math.PI;
  }

  // angleOffset method returns the difference in angles between this vector and the provided vector
  /**
   *
   * @param {BVector3} vec1
   * @param {BVector3} vec2
   */
  static angleOffset(vec1, vec2) {
    const dot = BVector3.dotProduct(vec1, vec2);
    const mags = vec1.magnitude() * vec2.magnitude();
    return (Math.acos(dot / mags) * HALF_CIRCLE) / Math.PI;
  }

  // crossProduct method returns the cross product of two vectors
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

  // crossProduct method returns the cross product of two vectors
  /**
   *
   * @param {BVector3} vec1
   * @param {BVector3} vec2
   */
  static crossProduct(vec1, vec2) {
    if (vec1 === undefined || vec2 === undefined) {
      console.error(
        "No valid argument provided to the BVector3 crossProduct method",
      );
      return undefined;
    }
    const x = vec1.y * vec2.z - vec1.z * vec2.y;
    const y = vec1.z * vec2.x - vec1.x * vec2.z;
    const z = vec1.x * vec2.y - vec1.y * vec2.x;
    return new BVector3(x, y, z);
  }

  // dotProduct method returns the dot product of two vectors
  /**
   *
   * @param {BVector3} vec2
   */
  dotProduct(vec2) {
    return this.x * vec2.x + this.y * vec2.y + this.z * vec2.z;
  }

  // dotProduct method returns the dot product of two vectors
  /**
   *
   * @param {BVector3} vec1
   * @param {BVector3} vec2
   */
  static dotProduct(vec1, vec2) {
    if (vec1 === undefined || vec2 === undefined) {
      console.error(
        "No valid argument provided to the BVector3 dotProduct method",
      );
      return undefined;
    }
    return vec1.x * vec2.x + vec1.y * vec2.y + vec1.z * vec2.z;
  }
}
