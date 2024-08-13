class Boundary {
  constructor(x, y, z, w, h, d) {
    this.x = x;
    this.y = y;
    this.z = z;
    this.w = w;
    this.h = h;
    this.d = d;
  }

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

class QuadTree {
  constructor(boundary, capacity) {
    this.boundary = boundary;
    this.capacity = capacity;
    this.elements = [];
    this.divided = false;
  }

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
    let neu = new Boundary(
      this.boundary.x + this.boundary.w / 2,
      this.boundary.y - this.boundary.h / 2,
      this.boundary.z + this.boundary.d / 2,
      this.boundary.w / 2,
      this.boundary.h / 2,
      this.boundary.d / 2
    );
    let nwu = new Boundary(
      this.boundary.x - this.boundary.w / 2,
      this.boundary.y - this.boundary.h / 2,
      this.boundary.z + this.boundary.d / 2,
      this.boundary.w / 2,
      this.boundary.h / 2,
      this.boundary.d / 2
    );
    let seu = new Boundary(
      this.boundary.x + this.boundary.w / 2,
      this.boundary.y + this.boundary.h / 2,
      this.boundary.z + this.boundary.d / 2,
      this.boundary.w / 2,
      this.boundary.h / 2,
      this.boundary.d / 2
    );
    let swu = new Boundary(
      this.boundary.x - this.boundary.w / 2,
      this.boundary.y + this.boundary.h / 2,
      this.boundary.z + this.boundary.d / 2,
      this.boundary.w / 2,
      this.boundary.h / 2,
      this.boundary.d / 2
    );
    let ned = new Boundary(
      this.boundary.x + this.boundary.w / 2,
      this.boundary.y - this.boundary.h / 2,
      this.boundary.z - this.boundary.d / 2,
      this.boundary.w / 2,
      this.boundary.h / 2,
      this.boundary.d / 2
    );
    let nwd = new Boundary(
      this.boundary.x - this.boundary.w / 2,
      this.boundary.y - this.boundary.h / 2,
      this.boundary.z - this.boundary.d / 2,
      this.boundary.w / 2,
      this.boundary.h / 2,
      this.boundary.d / 2
    );
    let sed = new Boundary(
      this.boundary.x + this.boundary.w / 2,
      this.boundary.y + this.boundary.h / 2,
      this.boundary.z - this.boundary.d / 2,
      this.boundary.w / 2,
      this.boundary.h / 2,
      this.boundary.d / 2
    );
    let swd = new Boundary(
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
