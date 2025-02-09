// Developed by: Petar Mijailovic (leptr)
// GitHub: https://github.com/leptr
// Repo: https://github.com/leptr/bedrock-libs

// clamp function constrains the given number between the given min and max values
export function clamp(num, min, max) {
  if (num < min) return min;
  if (num > max) return max;
  return num;
}

// lerp function stands for linear interpolation; it slowly brings the first value to the second over time with the given step size
export function lerp(value1, value2, step) {
  // Handle bad arguments
  if (value1 === undefined || value2 === undefined || step === undefined) error("Invalid arguments for lerp function");
  else {
    return (1 - step) * value1 + step * value2;
  }
}

// map function maps the given value ranging from a to b to a new value ranging from c to d
export function map(num, a, b, c, d) {
  return ((num - a) / (b - a)) * (d - c) + c;
}

// random function returns a random number or element from an array if provided with one
export function random(num1, num2) {
  // Return a number between 0 and 1 if no arguments are provided
  if (num1 === undefined && num2 === undefined) return Math.random();
  else {
    // Return a random array element if one is provided
    if (num1.constructor === Array) {
      let i = Math.floor(Math.random() * num1.length);
      return num1[i];
    }
    // Return a random number between the two provided numbers if two numbers are provided
    if (num2 !== undefined) return Math.random() * (num2 - num1) + num1;
    // Return a random number between 0 and the provided number if only one is provided
    else return Math.random() * num1;
  }
}

// randInt function returns a random integer between the given values
export function randInt(num1, num2) {
  // Handle bad arguments
  if (num1 === undefined && num2 === undefined) error("At least one argument is needed for the randInt function");
  // Return a random integer between the two numbers if two numbers are provided
  else if (num2 !== undefined) return Math.floor(Math.random() * (num2 - num1) + num1);
  // Return a random interger between 0 and the provided number if only one number is provided
  else return Math.floor(Math.random() * num1);
}

// floor function rounds the provided number down to the next integer
export function floor(num) {
  return Math.floor(num);
}

// ceil function rounds the provided number up to the next integer
export function ceil(num) {
  return Math.ceil(num);
}

// round function rounds the provided number to the closest integer
export function round(num) {
  return Math.round(num);
}

// pow function returns the value of the provided number to the provided power
export function pow(num, pow) {
  return Math.pow(num, pow);
}

// sqrt function returns the square root of the provided number
export function sqrt(num) {
  return Math.sqrt(num);
}

// sqr function returns the square of the given number
export function sqr(num) {
  return num * num;
}

// abs function returns the absolute value of the provided number
export function abs(num) {
  return Math.abs(num);
}

// sin function returns the sine value of the provided angle
export function sin(angle) {
  return Math.sin((angle * Math.PI) / 180);
}

// cos function returns the cosine value of the provided angle
export function cos(angle) {
  return Math.cos((angle * Math.PI) / 180);
}

// acos function returns the arc cosine value of the provided angle
export function acos() {
  return Math.acos.apply(null, arguments);
}

// asin function returns the arc sine value of the provided angle
export function asin() {
  return Math.asin.apply(null, arguments);
}

// tan function returns the tangent of the given number in radians
export function tan() {
  return Math.tan.apply(null, arguments);
}

// atan function returns the arc tangent of the given number in radians
export function atan() {
  return Math.atan.apply(null, arguments);
}

// atan2 function returns the angle in the plane (in radians) between the positive x-axis and the ray from (0, 0) to the point
export function atan2() {
  return Math.atan2.apply(null, arguments);
}

// exp function returns e raised to the power of the provided number
export function exp() {
  return Math.exp.apply(null, arguments);
}

// log function returns the natural logarithm base e of the given number
export function log() {
  return Math.log.apply(null, arguments);
}

// min function returns the smallest number in the provided list of numbers
export function min() {
  return Math.min.apply(null, arguments);
}

// max function returns the biggest number in the provided list of numbers
export function max() {
  return Math.max.apply(null, arguments);
}

// write function writes a line of text to the DOM
export function write() {
  document.write.apply(null, arguments);
}

// print function writes the text to the console
export function print() {
  console.log.apply(null, arguments);
}

// table function prints an array or matrix as a table to the console
export function table() {
  console.table.apply(null, arguments);
}

// error function writes an error to the console
export function error() {
  console.error.apply(null, arguments);
}
