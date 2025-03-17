// Developed by: Petar Mijailovic (leptr)
// GitHub: https://github.com/leptr
// Repo: https://github.com/leptr/bedrock-libs

import * as mc from "@minecraft/server";

class Area {
  /**
   *
   * @param {Number} x
   * @param {Number} y
   * @param {Number} z
   */
  constructor(x, y, z) {
    this.x = x;
    this.y = y;
    this.z = z;
  }
}

class CubeArea extends Area {
  /**
   *
   * @param {Number} x
   * @param {Number} y
   * @param {Number} z
   * @param {Number} width
   * @param {Number} height
   * @param {Number} depth
   */
  constructor(x, y, z, width, height, depth) {
    this.x = x;
    this.y = y;
    this.z = z;
    this.w = width;
    this.h = height;
    this.d = depth;
  }

  /**
   *
   * @param {mc.Vector3} element
   */
  contains(element) {
    return (
      element.x >= this.x - this.w &&
      element.x <= this.x + this.w &&
      element.y >= this.y - this.h &&
      element.y <= this.y + this.h &&
      element.z >= this.z - this.d &&
      element.z <= this.z + this.d
    );
  }

  /**
   *
   * @param {Area} range
   */
  intersects(range) {
    return !(
      range.x - range.w > this.x + this.w ||
      range.x + range.w < this.x - this.w ||
      range.y - range.h > this.y + this.h ||
      range.y + range.h < this.y - this.h ||
      range.z - range.d > this.z + this.d ||
      range.z + range.d < this.z - this.d
    );
  }
}

class SphericalArea extends Area {
  constructor(x, y, z, r) {
    this.x = x;
    this.y = y;
    this.z = z;
    this.r = r;
    this.rSquared = this.r * this.r;
  }

  /**
   *
   * @param {mc.Vector3} point
   */
  contains(point) {
    let d = Math.pow(point.x - this.x, 2) + Math.pow(point.y - this.y, 2) + Math.pow(point.z - this.z, 2);
    return d <= this.rSquared;
  }

  /**
   *
   * @param {Area} range
   */
  intersects(range) {
    let xDist = Math.abs(range.x - this.x);
    let yDist = Math.abs(range.y - this.y);
    let zDist = Math.abs(range.z - this.z);

    let r = this.r;

    let w = range.w / 2;
    let h = range.h / 2;
    let d = range.d / 2;

    let edges = Math.pow(xDist - w, 2) + Math.pow(yDist - h, 2) + Math.pow(zDist - h, 2);

    if (xDist > r + w || yDist > r + h || zDist > r + d) return false;

    if (xDist <= w || yDist <= h || zDist <= d) return true;

    return edges <= this.rSquared;
  }
}

class QuadTree {
  /**
   *
   * @param {Area} boundary
   * @param {Number} capacity
   */
  constructor(boundary, capacity) {
    this.boundary = boundary;
    this.capacity = capacity;
    this.elements = [];
    this.divided = false;
  }

  /**
   *
   * @param {mc.Vector3} newElement
   */
  insert(newElement) {
    if (!this.boundary.contains(newElement)) return false;

    if (this.elements.length < this.capacity) {
      this.elements.push(newElement);
      return true;
    } else {
      if (!this.divided) this.subdivide();
      if (this.ne.insert(newElement)) return true;
      else if (this.nw.insert(newElement)) return true;
      else if (this.se.insert(newElement)) return true;
      else if (this.sw.insert(newElement)) return true;
    }
  }

  subdivide() {
    let neu = new CubeArea(
      this.boundary.x + this.boundary.w / 2,
      this.boundary.y - this.boundary.h / 2,
      this.boundary.z + this.boundary.d / 2,
      this.boundary.w / 2,
      this.boundary.h / 2,
      this.boundary.d / 2
    );
    let nwu = new CubeArea(
      this.boundary.x - this.boundary.w / 2,
      this.boundary.y - this.boundary.h / 2,
      this.boundary.z + this.boundary.d / 2,
      this.boundary.w / 2,
      this.boundary.h / 2,
      this.boundary.d / 2
    );
    let seu = new CubeArea(
      this.boundary.x + this.boundary.w / 2,
      this.boundary.y + this.boundary.h / 2,
      this.boundary.z + this.boundary.d / 2,
      this.boundary.w / 2,
      this.boundary.h / 2,
      this.boundary.d / 2
    );
    let swu = new CubeArea(
      this.boundary.x - this.boundary.w / 2,
      this.boundary.y + this.boundary.h / 2,
      this.boundary.z + this.boundary.d / 2,
      this.boundary.w / 2,
      this.boundary.h / 2,
      this.boundary.d / 2
    );
    let ned = new CubeArea(
      this.boundary.x + this.boundary.w / 2,
      this.boundary.y - this.boundary.h / 2,
      this.boundary.z - this.boundary.d / 2,
      this.boundary.w / 2,
      this.boundary.h / 2,
      this.boundary.d / 2
    );
    let nwd = new CubeArea(
      this.boundary.x - this.boundary.w / 2,
      this.boundary.y - this.boundary.h / 2,
      this.boundary.z - this.boundary.d / 2,
      this.boundary.w / 2,
      this.boundary.h / 2,
      this.boundary.d / 2
    );
    let sed = new CubeArea(
      this.boundary.x + this.boundary.w / 2,
      this.boundary.y + this.boundary.h / 2,
      this.boundary.z - this.boundary.d / 2,
      this.boundary.w / 2,
      this.boundary.h / 2,
      this.boundary.d / 2
    );
    let swd = new CubeArea(
      this.boundary.x - this.boundary.w / 2,
      this.boundary.y + this.boundary.h / 2,
      this.boundary.z - this.boundary.d / 2,
      this.boundary.w / 2,
      this.boundary.h / 2,
      this.boundary.d / 2
    );
    this.neu = new QuadTree(neu, this.capacity);
    this.nwu = new QuadTree(nwu, this.capacity);
    this.seu = new QuadTree(seu, this.capacity);
    this.swu = new QuadTree(swu, this.capacity);
    this.ned = new QuadTree(ned, this.capacity);
    this.nwd = new QuadTree(nwd, this.capacity);
    this.sed = new QuadTree(sed, this.capacity);
    this.swd = new QuadTree(swd, this.capacity);

    this.divided = true;
  }

  /**
   *
   * @param {Area} range
   * @param {Array} results
   */
  query(range, results) {
    if (!results) results = [];
    if (!this.boundary.intersects(range)) {
      return results;
    }
    for (let i = 0; i < this.elements.length; i++) {
      if (range.contains(this.elements[i])) results.push(this.elements[i]);
    }

    if (this.divided) {
      this.ne.query(range, results);
      this.nw.query(range, results);
      this.se.query(range, results);
      this.sw.query(range, results);
    }

    return results;
  }

  clear() {
    this.elements = [];
    this.neu = undefined;
    this.nwu = undefined;
    this.seu = undefined;
    this.swu = undefined;
    this.ned = undefined;
    this.nwd = undefined;
    this.sed = undefined;
    this.swd = undefined;
    this.divided = false;
  }
}
