// Developed by: Petar Mijailovic (leptr)
// GitHub: https://github.com/leptr
// Repo: https://github.com/leptr/bedrock-libs

/**
 * General rows-by-columns matrix. Elements are read and written as
 * `m[row][col]`, or with `get(row, col)` and `set(row, col, value)`.
 * Operations between two matrices throw a RangeError when their sizes do not fit.
 *
 * The values live in `data`, an array of rows. The numbered properties
 * (`m[0]`, `m[1]`, ...) point at the same rows and are hidden from
 * `Object.keys` and `JSON.stringify`, so a matrix has exactly three visible
 * properties: `rows`, `cols` and `data`.
 */
export class Matrix {
  /**
   *
   * @param {Number} rows
   * @param {Number} cols
   */
  constructor(rows, cols) {
    this.rows = rows;
    this.cols = cols;
    /** @type {number[][]} */
    this.data = [];
    for (let i = 0; i < this.rows; i++) {
      const row = Array(this.cols).fill(0);
      this.data.push(row);
      Object.defineProperty(this, i, { value: row, enumerable: false });
    }
  }

  /**
   * Read one element.
   * @param {Number} row
   * @param {Number} col
   * @returns {Number}
   */
  get(row, col) {
    return this.data[row][col];
  }

  /**
   * Write one element.
   * @param {Number} row
   * @param {Number} col
   * @param {Number} value
   * @returns {Matrix} This matrix.
   */
  set(row, col, value) {
    this.data[row][col] = value;
    return this;
  }

  copy() {
    let m = new Matrix(this.rows, this.cols);
    for (let i = 0; i < this.rows; i++) {
      for (let j = 0; j < this.cols; j++) {
        m[i][j] = this[i][j];
      }
    }
    return m;
  }

  /**
   *
   * @param {Array} arr
   */
  static fromArray(arr) {
    return new Matrix(arr.length, 1).map((e, i) => arr[i]);
  }

  /**
   *
   * @param {Matrix} a
   * @param {Matrix} b
   */
  static subtract(a, b) {
    if (a.rows !== b.rows || a.cols !== b.cols) {
      throw new RangeError(
        "Columns and Rows of A must match Columns and Rows of B.",
      );
    }

    return new Matrix(a.rows, a.cols).map((_, i, j) => a[i][j] - b[i][j]);
  }

  toArray() {
    let arr = [];
    for (let i = 0; i < this.rows; i++) {
      for (let j = 0; j < this.cols; j++) {
        arr.push(this[i][j]);
      }
    }
    return arr;
  }

  /**
   *
   * @param {Number} n
   */
  getRow(n) {
    let arr = [];
    for (let j = 0; j < this.cols; j++) {
      arr.push(this[n][j]);
    }
    return arr;
  }

  /**
   *
   * @param {Number} n
   */
  getColumn(n) {
    let arr = [];
    for (let i = 0; i < this.rows; i++) {
      arr.push(this[i][n]);
    }
    return arr;
  }

  /**
   *
   * @param {Number} n
   * @param {Array} arr
   */
  setRow(n, arr) {
    for (let j = 0; j < this.cols; j++) {
      this[n][j] = arr[j];
    }
  }

  /**
   *
   * @param {Number} n
   * @param {Array} arr
   */
  setColumn(n, arr) {
    for (let i = 0; i < this.rows; i++) {
      this[i][n] = arr[i];
    }
  }

  /**
   *
   * @param {Number} n
   * @param {Number} num
   */
  addRow(n, num) {
    for (let j = 0; j < this.cols; j++) {
      this[n][j] += num;
    }
  }

  /**
   *
   * @param {Number} n
   * @param {Number} num
   */
  addColumn(n, num) {
    for (let i = 0; i < this.rows; i++) {
      this[i][n] += num;
    }
  }

  /**
   *
   * @param {Number} n
   * @param {Number} num
   */
  subtractRow(n, num) {
    for (let j = 0; j < this.cols; j++) {
      this[n][j] -= num;
    }
  }

  /**
   *
   * @param {Number} n
   * @param {Number} num
   */
  subtractColumn(n, num) {
    for (let i = 0; i < this.rows; i++) {
      this[i][n] -= num;
    }
  }

  /**
   *
   * @param {Number} n
   * @param {Number} num
   */
  multiplyRow(n, num) {
    for (let j = 0; j < this.cols; j++) {
      this[n][j] *= num;
    }
  }

  /**
   *
   * @param {Number} n
   * @param {Number} num
   */
  multiplyColumn(n, num) {
    for (let i = 0; i < this.rows; i++) {
      this[i][n] *= num;
    }
  }

  /**
   *
   * @param {Number} n
   * @param {Number} num
   */
  divideRow(n, num) {
    for (let j = 0; j < this.cols; j++) {
      this[n][j] /= num;
    }
  }

  /**
   *
   * @param {Number} n
   * @param {Number} num
   */
  divideColumn(n, num) {
    for (let i = 0; i < this.rows; i++) {
      this[i][n] /= num;
    }
  }

  /**
   *
   * @param {Number} r1
   * @param {Number} r2
   */
  swapRows(r1, r2) {
    for (let j = 0; j < this.cols; j++) {
      const temp = this[r1][j];
      this[r1][j] = this[r2][j];
      this[r2][j] = temp;
    }
  }

  /**
   *
   * @param {Number} c1
   * @param {Number} c2
   */
  swapColumns(c1, c2) {
    for (let i = 0; i < this.rows; i++) {
      const temp = this[i][c1];
      this[i][c1] = this[i][c2];
      this[i][c2] = temp;
    }
  }

  randomize() {
    return this.map(e => Math.random() * 2 - 1);
  }

  /**
   *
   * @param {Number|Matrix} n A number to add to every element, or a matrix of the same size.
   */
  add(n) {
    if (n instanceof Matrix) {
      if (this.rows !== n.rows || this.cols !== n.cols) {
        throw new RangeError(
          "Columns and Rows of A must match Columns and Rows of B.",
        );
      }
      return this.map((e, i, j) => e + n[i][j]);
    } else {
      return this.map(e => e + n);
    }
  }

  /**
   *
   * @param {Matrix} matrix
   */
  static transpose(matrix) {
    return new Matrix(matrix.cols, matrix.rows).map((_, i, j) => matrix[j][i]);
  }

  /**
   *
   * @param {Matrix} a
   * @param {Matrix} b
   */
  static multiply(a, b) {
    // Matrix product
    if (a.cols !== b.rows) {
      throw new RangeError("Columns of A must match rows of B.");
    }

    return new Matrix(a.rows, b.cols).map((e, i, j) => {
      // Dot product of values in col
      let sum = 0;
      for (let k = 0; k < a.cols; k++) {
        sum += a[i][k] * b[k][j];
      }
      return sum;
    });
  }

  /**
   *
   * @param {Number|Matrix} n A number to scale by, or a matrix of the same size for the element-wise product.
   */
  multiply(n) {
    if (n instanceof Matrix) {
      if (this.rows !== n.rows || this.cols !== n.cols) {
        throw new RangeError(
          "Columns and Rows of A must match Columns and Rows of B.",
        );
      }

      // hadamard product
      return this.map((e, i, j) => e * n[i][j]);
    } else {
      // Scalar product
      return this.map(e => e * n);
    }
  }

  /**
   *
   * @param {function} func
   */
  map(func) {
    // Apply a function to every element of matrix
    for (let i = 0; i < this.rows; i++) {
      for (let j = 0; j < this.cols; j++) {
        let val = this[i][j];
        this[i][j] = func(val, i, j);
      }
    }
    return this;
  }

  /**
   *
   * @param {Matrix} matrix
   * @param {function} func
   */
  static map(matrix, func) {
    // Apply a function to every element of matrix
    return new Matrix(matrix.rows, matrix.cols).map((e, i, j) =>
      func(matrix[i][j], i, j),
    );
  }

  serialize() {
    return JSON.stringify(this);
  }

  /**
   *
   * @param {String|Object} data Output of serialize(), as a string or already parsed.
   * @returns {Matrix}
   */
  static deserialize(data) {
    if (typeof data == "string") {
      data = JSON.parse(data);
    }
    // Matrices saved before `data` existed stored each row under its index.
    const rows = data.data ?? data;
    return new Matrix(data.rows, data.cols).map((_, i, j) => rows[i][j]);
  }

  max() {
    let max = -Infinity;
    for (let i = 0; i < this.rows; i++) {
      for (let j = 0; j < this.cols; j++) {
        if (this[i][j] > max) max = this[i][j];
      }
    }
    return max;
  }

  min() {
    let min = Infinity;
    for (let i = 0; i < this.rows; i++) {
      for (let j = 0; j < this.cols; j++) {
        if (this[i][j] < min) min = this[i][j];
      }
    }
    return min;
  }

  maxIndex() {
    let max = -Infinity;
    let index = [0, 0];
    for (let i = 0; i < this.rows; i++) {
      for (let j = 0; j < this.cols; j++) {
        if (this[i][j] > max) {
          max = this[i][j];
          index = [i, j];
        }
      }
    }
    return index;
  }

  minIndex() {
    let min = Infinity;
    let index = [0, 0];
    for (let i = 0; i < this.rows; i++) {
      for (let j = 0; j < this.cols; j++) {
        if (this[i][j] < min) {
          min = this[i][j];
          index = [i, j];
        }
      }
    }
    return index;
  }

  /**
   *
   * @param {Number} n
   */
  maxRow(n) {
    let max = -Infinity;
    for (let j = 0; j < this.cols; j++) {
      if (this[n][j] > max) max = this[n][j];
    }
    return max;
  }

  /**
   *
   * @param {Number} n
   */
  minRow(n) {
    let min = Infinity;
    for (let j = 0; j < this.cols; j++) {
      if (this[n][j] < min) min = this[n][j];
    }
    return min;
  }

  /**
   *
   * @param {Number} n
   */
  maxRowIndex(n) {
    let max = -Infinity;
    let index = 0;
    for (let j = 0; j < this.cols; j++) {
      if (this[n][j] > max) {
        max = this[n][j];
        index = j;
      }
    }
    return index;
  }

  /**
   *
   * @param {Number} n
   */
  minRowIndex(n) {
    let min = Infinity;
    let index = 0;
    for (let j = 0; j < this.cols; j++) {
      if (this[n][j] < min) {
        min = this[n][j];
        index = j;
      }
    }
    return index;
  }

  /**
   *
   * @param {Number} n
   */
  maxColumn(n) {
    let max = -Infinity;
    for (let i = 0; i < this.rows; i++) {
      if (this[i][n] > max) max = this[i][n];
    }
    return max;
  }

  /**
   *
   * @param {Number} n
   */
  minColumn(n) {
    let min = Infinity;
    for (let i = 0; i < this.rows; i++) {
      if (this[i][n] < min) min = this[i][n];
    }
    return min;
  }

  /**
   *
   * @param {Number} n
   */
  maxColumnIndex(n) {
    let max = -Infinity;
    let index = 0;
    for (let i = 0; i < this.rows; i++) {
      if (this[i][n] > max) {
        max = this[i][n];
        index = i;
      }
    }
    return index;
  }

  /**
   *
   * @param {Number} n
   */
  minColumnIndex(n) {
    let min = Infinity;
    let index = 0;
    for (let i = 0; i < this.rows; i++) {
      if (this[i][n] < min) {
        min = this[i][n];
        index = i;
      }
    }
    return index;
  }
}
