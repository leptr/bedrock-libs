// Developed by: leptr
// GitHub: https://github.com/leptr
// Repo: https://github.com/leptr/bedrock-libs

export class Matrix {
  constructor(rows, cols) {
    this.rows = rows;
    this.cols = cols;
    for (let i = 0; i < this.rows; i++) this[i] = Array(this.cols).fill(0);
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

  static fromArray(arr) {
    return new Matrix(arr.length, 1).map((e, i) => arr[i]);
  }

  static subtract(a, b) {
    if (a.rows !== b.rows || a.cols !== b.cols) {
      console.log("Columns and Rows of A must match Columns and Rows of B.");
      return;
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

  getRow(n) {
    let arr = [];
    for (let j = 0; j < this.cols; j++) {
      arr.push(this[n][j]);
    }
    return arr;
  }

  getColumn(n) {
    let arr = [];
    for (let i = 0; i < this.rows; i++) {
      arr.push(this[i][n]);
    }
    return arr;
  }

  setRow(n, arr) {
    for (let j = 0; j < this.cols; j++) {
      this[n][j] = arr[j];
    }
  }

  setColumn(n, arr) {
    for (let i = 0; i < this.rows; i++) {
      this[i][n] = arr[i];
    }
  }

  addRow(n, num) {
    for (let j = 0; j < this.cols; j++) {
      this[n][j] += num;
    }
  }

  addColumn(n, num) {
    for (let i = 0; i < this.rows; i++) {
      this[i][n] += num;
    }
  }

  subtractRow(n, num) {
    for (let j = 0; j < this.cols; j++) {
      this[n][j] -= num;
    }
  }

  subtractColumn(n, num) {
    for (let i = 0; i < this.rows; i++) {
      this[i][n] -= num;
    }
  }

  multiplyRow(n, num) {
    for (let j = 0; j < this.cols; j++) {
      this[n][j] *= num;
    }
  }

  multiplyColumn(n, num) {
    for (let i = 0; i < this.rows; i++) {
      this[i][n] *= num;
    }
  }

  divideRow(n, num) {
    for (let j = 0; j < this.cols; j++) {
      this[n][j] /= num;
    }
  }

  divideColumn(n, num) {
    for (let i = 0; i < this.rows; i++) {
      this[i][n] /= num;
    }
  }

  swapRows(r1, r2) {
    let temp1 = [];
    let temp2 = [];
    for (let j = 0; j < this.cols; j++) {
      temp1.push(this[r1][j]);
      temp2.push(this[r2][j]);
    }
    for (let j = 0; j < this.cols; j++) {
      this[r1][j] = temp1[j];
      this[r2][j] = temp2[j];
    }
  }

  swapColumns(c1, c2) {
    let temp1 = [];
    let temp2 = [];
    for (let i = 0; i < this.rows; i++) {
      temp1.push(this[i][c1]);
      temp2.push(this[i][c2]);
    }
    for (let i = 0; i < this.rows; i++) {
      this[i][c1] = temp1[i];
      this[i][c2] = temp2[i];
    }
  }

  randomize() {
    return this.map((e) => Math.random() * 2 - 1);
  }

  add(n) {
    if (n instanceof Matrix) {
      if (this.rows !== n.rows || this.cols !== n.cols) {
        console.log("Columns and Rows of A must match Columns and Rows of B.");
        return;
      }
      return this.map((e, i, j) => e + n[i][j]);
    } else {
      return this.map((e) => e + n);
    }
  }

  static transpose(matrix) {
    return new Matrix(matrix.cols, matrix.rows).map((_, i, j) => matrix[j][i]);
  }

  static multiply(a, b) {
    // Matrix product
    if (a.cols !== b.rows) {
      console.log("Columns of A must match rows of B.");
      return;
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

  multiply(n) {
    if (n instanceof Matrix) {
      if (this.rows !== n.rows || this.cols !== n.cols) {
        console.log("Columns and Rows of A must match Columns and Rows of B.");
        return;
      }

      // hadamard product
      return this.map((e, i, j) => e * n[i][j]);
    } else {
      // Scalar product
      return this.map((e) => e * n);
    }
  }

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

  static map(matrix, func) {
    // Apply a function to every element of matrix
    return new Matrix(matrix.rows, matrix.cols).map((e, i, j) => func(matrix[i][j], i, j));
  }

  serialize() {
    return JSON.stringify(this);
  }

  static deserialize(data) {
    if (typeof data == "string") {
      data = JSON.parse(data);
    }
    let matrix = new Matrix(data.rows, data.cols);
    matrix = data;
    return matrix;
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

  maxRow(n) {
    let max = -Infinity;
    for (let j = 0; j < this.cols; j++) {
      if (this[n][j] > max) max = this[n][j];
    }
    return max;
  }

  minRow(n) {
    let min = Infinity;
    for (let j = 0; j < this.cols; j++) {
      if (this[n][j] < min) min = this[n][j];
    }
    return min;
  }

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

  maxColumn(n) {
    let max = -Infinity;
    for (let i = 0; i < this.rows; i++) {
      if (this[i][n] > max) max = this[i][n];
    }
    return max;
  }

  minColumn(n) {
    let min = Infinity;
    for (let i = 0; i < this.rows; i++) {
      if (this[i][n] < min) min = this[i][n];
    }
    return min;
  }

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
