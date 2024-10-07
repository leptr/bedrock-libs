// Developed by: leptr
// GitHub: https://github.com/leptr
// Repo: https://github.com/leptr/bedrock-libs

import * as mc from "@minecraft/server";

function sqr(num) {
  return num * num;
}

export class bVector2 {
  constructor(x, y) {
    // Prepare basic vector variables
    this.x = 0;
    this.y = 0;

    if (x !== undefined) this.x = x;
    if (y !== undefined) this.y = y;
  }

  // set method allows the user to update the vector coordinates
  set(x, y) {
    if (x === undefined || y === undefined) {
      // Handle bad arguments
      console.error("No value has been passed to the bVector2 set function");
    } else {
      // Update the vector coordinates based on the provided arguments
      this.x = x;
      this.y = y;
    }
  }

  // add method allows the user to perform addition with the provided vector
  add(vec2) {
    if (vec2 === undefined) {
      // Handle bad arguments
      console.error("No vector has been passed to the bVector2 add function");
    } else {
      // Add the provided vector
      this.x += vec2.x;
      this.y += vec2.y;
    }
  }

  // add method allows the user to perform addition with the provided vector
  static add(vec1, vec2) {
    if (vec1 === undefined || vec2 === undefined) {
      // Handle bad arguments
      console.error("No vector has been passed to the bVector2 add function");
      return null;
    } else {
      let newVec = vec1.copy();
      // Add the provided vector
      newVec.x += vec2.x;
      newVec.y += vec2.y;
      return newVec;
    }
  }

  // subtract method allows the user to perform subtraction with the provided vector
  subtract(vec2) {
    if (vec2 === undefined) {
      // Handle bad arguments
      console.error("No vector has been passed to the bVector2 subtract function");
    } else {
      // Subtract the provided vector
      this.x -= vec2.x;
      this.y -= vec2.y;
    }
  }

  // subtract method allows the user to perform subtraction with the provided vector
  static subtract(vec1, vec2) {
    if (vec1 === undefined || vec2 === undefined) {
      // Handle bad arguments
      console.error("No vector has been passed to the bVector2 subtract function");
      return null;
    } else {
      let newVec = vec1.copy();
      // Subtract the provided vector
      newVec.x -= vec2.x;
      newVec.y -= vec2.y;
      return newVec;
    }
  }

  // multiply method allows the user to perform multiplication with the provided vector
  multiply(num) {
    if (num === undefined) num = 1;
    this.x *= num;
    this.y *= num;
  }

  // multiply method allows the user to perform multiplication with the provided vector
  static multiply(vec, num) {
    if (vec === undefined) {
      // Handle bad arguments
      console.error("No vector has been passed to the bVector2 multiply function");
      return null;
    } else {
      let newVec = vec.copy();
      if (num === undefined) num = 1;
      newVec.x *= num;
      newVec.y *= num;
      return vec;
    }
  }

  // divide method allows the user to perform division with the provided vector
  divide(num) {
    if (num === undefined) num = 1;
    num = 1 / num;
    this.multiply(num);
  }

  // multiply method allows the user to perform multiplication with the provided vector
  static divide(vec, num) {
    if (vec === undefined) {
      // Handle bad arguments
      console.error("No vector has been passed to the bVector2 divide function");
      return null;
    } else {
      let newVec = vec.copy();
      if (num === undefined) num = 1;
      newVec.x /= num;
      newVec.y /= num;
      return vec;
    }
  }

  // angle method allows the user to get the angle of the vector
  angle() {
    return (Math.atan(this.y / this.x) * 180) / Math.PI;
  }

  // rotate method allows the user to rotate the vector by the given angle
  rotate(angle) {
    let previousX = this.x;
    let previousY = this.y;

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
  setMagnitude(newMag) {
    let mag = Math.sqrt(sqr(this.x) + sqr(this.y));
    let ratio = newMag / mag;

    this.x *= ratio;
    this.y *= ratio;
  }

  // limit method allows the user to set the maximum magnitude for the vector
  limit(minMag, maxMag) {
    let maxM = minMag;
    let minM = null;

    if (maxMag) {
      maxM = maxMag;
      minM = minMag;
    }

    if (minM && this.magnitude() < minM) this.setMagnitude(minM);
    if (this.magnitude() > maxM) this.setMagnitude(maxM);
  }

  // copy method allows the user to get a copy of the vector
  copy() {
    return new bVector2(this.x, this.y);
  }

  // normalize method allows the user to normalize the vector/set its magnitude to 1
  normalize() {
    let tmp = new bVector2(this.x, this.y);

    let mag = Math.sqrt(sqr(tmp.x) + sqr(tmp.y));

    tmp.x = tmp.x / mag;
    tmp.y = tmp.y / mag;

    this.previousX = this.x;
    this.previousY = this.y;

    this.x = tmp.x;
    this.y = tmp.y;
  }

  // distance method allows the user to get the distance to another vector
  distance(vec2) {
    // Handle bad arguments
    if (vec2 === undefined) console.error("You need to pass another bVector2 instance to the bVector2 distance method");
    else return Math.sqrt(sqr(this.x - vec2.x) + sqr(this.y - vec2.y));
  }

  // distance method allows the user to get the distance to another vector
  static distance(vec1, vec2) {
    // Handle bad arguments
    if (vec2 === undefined) console.error("bVector2 distance method expects two instances of bVector2");
    else return Math.sqrt(sqr(vec1.x - vec2.x) + sqr(vec1.y - vec2.y));
  }

  // lerp method allows the user to lerp the vector towards another vector over time
  lerp(vec2, step) {
    // Handle bad arguments
    if (vec2 === undefined || step === undefined) console.error("Invalid arguments for the bVector2 lerp method");
    else {
      this.x = (1 - step) * this.x + step * vec2.x;
      this.y = (1 - step) * this.y + step * vec2.y;
    }
  }

  // lerp method allows the user to lerp the vector towards another vector over time
  static lerp(vec1, vec2, step) {
    // Handle bad arguments
    if (vec1 === undefined || vec2 === undefined || step === undefined) {
      console.error("Invalid arguments for the bVector2 lerp method");
      return null;
    } else {
      let newVec = vec1.copy();
      newVec.x = (1 - step) * newVec.x + step * vec2.x;
      newVec.y = (1 - step) * newVec.y + step * vec2.y;
      return newVec;
    }
  }

  // clamp method allows the user to constrain the method between the set coordinates
  clamp(minX, maxX, minY, maxY) {
    if (this.x >= maxX) this.x = maxX;
    else if (this.x <= minX) this.x = minX;
    if (this.y >= maxY) this.y = maxY;
    else if (this.y <= minY) this.y = minY;
  }

  // fromVector2 method returns a bVector2 from a Vector2
  static fromVector2(vec2) {
    return new bVector2(vec2.x, vec2.y);
  }

  // fromAngle method returns a bVector3 from the provided angle
  static fromAngle(angle) {
    return new bVector2(cos(angle), sin(angle));
  }

  // Generate a random bVector3
  static random() {
    let x = Math.random();
    let z = Math.random();
    return new bVector2(x, y);
  }

  // angleOffset method returns the difference in angles between this vector and the provided vector
  angleOffset(vec2) {
    return (Math.atan2(vec2.y * this.x - vec2.x * this.y, vec2.x * this.x + vec2.y * this.y) * 180) / Math.PI;
  }

  // crossProduct method returns the cross product of this vector and the provided vector
  crossProduct(vec2) {
    return this.x * vec2.y - vec2.x * this.y;
  }

  // crossProduct method returns the cross product of this vector and the provided vector
  static crossProduct(vec1, vec2) {
    if (vec1 === undefined || vec2 === undefined) {
      console.error("No valid arguments provided to the bVector2 crossProduct method");
      return null;
    }
    return vec1.x * vec2.y - vec2.x * vec1.y;
  }

  // dotProduct method returns the dot product of two vectors
  dotProduct(vec2) {
    return this.x * vec2.x + this.y * vec2.y;
  }

  // dotProduct method returns the dot product of two vectors
  static dotProduct(vec1, vec2) {
    if (vec1 === undefined || vec2 === undefined) {
      console.error("No valid arguments provided to the bVector2 dotProduct method");
      return null;
    }
    return vec1.x * vec2.x + vec1.y * vec2.y;
  }
}

export class bVector3 {
  constructor(x, y, z) {
    // Prepare basic vector variables
    this.x = 0;
    this.y = 0;
    this.z = 0;

    if (x !== undefined) this.x = x;
    if (y !== undefined) this.y = y;
    if (z !== undefined) this.z = z;
  }

  // set method allows the user to update the vector coordinates
  set(x, y, z) {
    if (x === undefined || y === undefined || z === undefined) {
      // Handle bad arguments
      console.error("No value has been passed to the bVector3 set function");
    } else {
      // Update the vector coordinates based on the provided arguments
      this.x = x;
      this.y = y;
      this.z = z;
    }
  }

  // add method allows the user to perform addition with the provided vector
  add(vec2) {
    if (vec2 === undefined) {
      // Handle bad arguments
      console.error("No vector has been passed to the bVector3 add function");
    } else {
      // Add the provided vector
      this.x += vec2.x;
      this.y += vec2.y;
      this.z += vec2.z;
    }
  }

  // add method allows the user to perform addition with the provided vector
  static add(vec1, vec2) {
    if (vec1 === undefined || vec2 === undefined) {
      // Handle bad arguments
      console.error("No vector has been passed to the bVector3 add function");
      return null;
    } else {
      let newVec = vec1.copy();
      // Add the provided vector
      newVec.x += vec2.x;
      newVec.y += vec2.y;
      newVec.z += vec2.z;
      return newVec;
    }
  }

  // subtract method allows the user to perform subtraction with the provided vector
  subtract(vec2) {
    if (vec2 === undefined) {
      // Handle bad arguments
      console.error("No vector has been passed to the bVector3 subtract function");
    } else {
      // Subtract the provided vector
      this.x -= vec2.x;
      this.y -= vec2.y;
      this.z -= vec2.z;
    }
  }

  // subtract method allows the user to perform subtraction with the provided vector
  static subtract(vec1, vec2) {
    if (vec1 === undefined || vec2 === undefined) {
      // Handle bad arguments
      console.error("No vector has been passed to the bVector3 subtract function");
      return null;
    } else {
      let newVec = vec1.copy();
      // Subtract the provided vector
      newVec.x -= vec2.x;
      newVec.y -= vec2.y;
      newVec.z -= vec2.z;
      return newVec;
    }
  }

  // multiply method allows the user to perform multiplication with the provided vector
  multiply(num) {
    if (num === undefined) num = 1;
    this.x *= num;
    this.y *= num;
    this.z *= num;
  }

  // multiply method allows the user to perform multiplication with the provided vector
  static multiply(vec, num) {
    if (vec === undefined) {
      // Handle bad arguments
      console.error("No vector has been passed to the bVector3 multiply function");
      return null;
    } else {
      let newVec = vec.copy();
      if (num === undefined) num = 1;
      newVec.x *= num;
      newVec.y *= num;
      newVec.z *= num;
      return newVec;
    }
  }

  // divide method allows the user to perform division with the provided vector
  divide(num) {
    if (num === undefined) num = 1;
    num = 1 / num;
    this.multiply(num);
  }

  // multiply method allows the user to perform multiplication with the provided vector
  static divide(vec, num) {
    if (vec === undefined) {
      // Handle bad arguments
      console.error("No vector has been passed to the bVector3 divide function");
      return null;
    } else {
      let newVec = vec.copy();
      if (num === undefined) num = 1;
      newVec.x /= num;
      newVec.y /= num;
      newVec.z /= num;
      return newVec;
    }
  }

  // angle method allows the user to get the angle of the vector
  angles(degrees) {
    if (degrees != undefined) {
      let theta = (Math.atan2(this.x, this.z) * -180) / Math.PI;
      let phi = (Math.atan(this.y / Math.sqrt(sqr(this.x) + sqr(this.z))) * 180) / Math.PI;
      return { theta, phi };
    }

    let theta = Math.atan(this.z / this.x);
    let phi = Math.atan(this.y / Math.sqrt(sqr(this.x) + sqr(this.z)));
    return { theta, phi };
  }

  // rotateX method allows the user to rotate the vector on the X axis by the given angle
  rotateX(angle) {
    let previousX = this.x;
    let previousY = this.y;
    let previousZ = this.z;

    this.y = cos(angle) * previousY - sin(angle) * previousZ;
    this.z = sin(angle) * previousY + cos(angle) * previousZ;
  }

  // rotateY method allows the user to rotate the vector on the X axis by the given angle
  rotateY(angle) {
    let previousX = this.x;
    let previousY = this.y;
    let previousZ = this.z;

    this.x = cos(angle) * previousX + sin(angle) * previousZ;
    this.z = sin(angle) * -previousX + cos(angle) * previousZ;
  }

  // rotateZ method allows the user to rotate the vector on the X axis by the given angle
  rotateZ(angle) {
    let previousX = this.x;
    let previousY = this.y;
    let previousZ = this.z;

    this.x = cos(angle) * previousX - sin(angle) * previousY;
    this.y = sin(angle) * previousX + cos(angle) * previousY;
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
  setMagnitude(newMag) {
    let mag = Math.sqrt(sqr(this.x) + sqr(this.y) + sqr(this.z));
    let ratio = newMag / mag;

    this.x *= ratio;
    this.y *= ratio;
    this.z *= ratio;
  }

  // limit method allows the user to set the maximum magnitude for the vector
  limit(minMag, maxMag) {
    let maxM = minMag;
    let minM = null;

    if (maxMag) {
      maxM = maxMag;
      minM = minMag;
    }

    if (minM && this.magnitude() < minM) this.setMagnitude(minM);
    if (this.magnitude() > maxM) this.setMagnitude(maxM);
  }

  // copy method allows the user to get a copy of the vector
  copy() {
    return new bVector3(this.x, this.y, this.z);
  }

  // normalize method allows the user to normalize the vector/set its magnitude to 1
  normalize() {
    let mag = this.magnitude();
    let temp = this.copy();
    this.x = temp.x / mag;
    this.y = temp.y / mag;
    this.z = temp.z / mag;
  }

  // distance method allows the user to get the distance to another vector
  distance(vec2) {
    // Handle bad arguments
    if (vec2 === undefined) console.error("You need to pass another bVector3 instance to the bVector3 distance method");
    else return Math.sqrt(sqr(this.x - vec2.x) + sqr(this.y - vec2.y) + sqr(this.z - vec2.z));
  }

  // distance method allows the user to get the distance to another vector
  static distance(vec1, vec2) {
    // Handle bad arguments
    if (vec1 === undefined) console.error("bVector3 distance method expects two instances of bVector2");
    else return Math.sqrt(sqr(vec1.x - vec2.x) + sqr(vec1.y - vec2.y) + sqr(vec1.z - vec2.z));
  }

  // lerp method allows the user to lerp the vector towards another vector over time
  lerp(vec2, step) {
    // Handle bad arguments
    if (vec2 === undefined || step === undefined) {
      console.error("Invalid arguments for the bVector3 lerp method");
      return null;
    } else {
      this.x = (1 - step) * this.x + step * vec2.x;
      this.y = (1 - step) * this.y + step * vec2.y;
      this.z = (1 - step) * this.z + step * vec2.z;
    }
  }

  // lerp method allows the user to lerp the vector towards another vector over time
  static lerp(vec1, vec2, step) {
    // Handle bad arguments
    if (vec1 === undefined || vec2 === undefined || step === undefined) {
      console.error("Invalid arguments for the bVector3 lerp method");
      return null;
    } else {
      let newVec = vec1.copy();
      newVec.x = (1 - step) * newVec.x + step * vec2.x;
      newVec.y = (1 - step) * newVec.y + step * vec2.y;
      newVec.z = (1 - step) * newVec.z + step * vec2.z;
      return newVec;
    }
  }

  // clamp method allows the user to constrain the method between the set coordinates
  clamp(minX, maxX, minY, maxY, minZ, maxZ) {
    if (this.x >= maxX) this.x = maxX;
    else if (this.x <= minX) this.x = minX;
    if (this.y >= maxY) this.y = maxY;
    else if (this.y <= minY) this.y = minY;
    if (this.z >= maxZ) this.z = maxZ;
    else if (this.z <= minZ) this.z = minZ;
  }

  // fromVector3 method returns a bVector3 from the provided Vector3
  static fromVector3(vec2) {
    return new bVector3(vec2.x, vec2.y, vec2.z);
  }

  // toVector3 method returns a Vector3 from the bVector3
  toVector3() {
    return { x: this.x, y: this.y, z: this.z };
  }

  // fromAngles method returns a bVector3 from 2 provided angles
  static fromAngles(alpha, beta) {
    let x = Math.cos(alpha) * Math.cos(beta);
    let z = Math.sin(alpha) * Math.cos(beta);
    let y = Math.sin(beta);
    return new bVector3(x, y, z);
  }

  // random method returns a random bVector3
  static random() {
    let x = Math.random();
    let z = Math.random();
    let y = Math.random();
    return new bVector3(x, y, z);
  }

  // angleOffset method returns the difference in angles between this vector and the provided vector
  angleOffset(vec2) {
    let off1 = (Math.atan2(vec2.y * this.x - vec2.x * this.y, vec2.x * this.x + vec2.y * this.y) * 180) / Math.PI;
    let off2 = (Math.atan2(vec2.z * this.x - vec2.x * this.z, vec2.x * this.x + vec2.z * this.z) * 180) / Math.PI;
    return [off1, off2];
  }

  // crossProduct method returns the cross product of two vectors
  crossProduct(vec2) {
    let x = this.y * vec2.z - this.z * vec2.y;
    let y = this.z * vec2.x - this.x * vec2.z;
    let z = this.x * vec2.y - this.y * vec2.x;
    return new bVector3(x, y, z);
  }

  // crossProduct method returns the cross product of two vectors
  static crossProduct(vec1, vec2) {
    if (vec1 === undefined || vec2 === undefined) {
      console.error("No valid argument provided to the bVector3 crossProduct method");
      return null;
    }
    let x = vec1.y * vec2.z - vec1.z * vec2.y;
    let y = vec1.z * vec2.x - vec1.x * vec2.z;
    let z = vec1.x * vec2.y - vec1.y * vec2.x;
    return new bVector3(x, y, z);
  }

  // dotProduct method returns the dot product of two vectors
  dotProduct(vec2) {
    return this.x * vec2.x + this.y * vec2.y + this.z * vec2.z;
  }

  // dotProduct method returns the dot product of two vectors
  static dotProduct(vec1, vec2) {
    if (vec1 === undefined || vec2 === undefined) {
      console.error("No valid argument provided to the bVector3 dotProduct method");
      return null;
    }
    return vec1.x * vec2.x + vec1.y * vec2.y + vec1.z * vec2.z;
  }
}
