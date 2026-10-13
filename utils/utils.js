// Developed by: Petar Mijailovic (leptr)
// GitHub: https://github.com/leptr
// Repo: https://github.com/leptr/bedrock-libs

import { TicksPerSecond } from "@minecraft/server";
import { logger } from "./logger.js";
import { HALF_CIRCLE } from "../better_vectors/better_vectors.js";

/** Convert seconds to Minecraft ticks, rounded to a whole tick. */
export function secondsToTicks(time) {
  return Math.round(time * TicksPerSecond);
}

/** Convert Minecraft ticks to seconds. The result is not rounded. */
export function ticksToSeconds(time) {
  return time / TicksPerSecond;
}

/** Clamp a number to the inclusive range `[minimum, maximum]`. */
export function clamp(value, minimum, maximum) {
  if (value < minimum) {
    return minimum;
  }
  if (value > maximum) {
    return maximum;
  }
  return value;
}

/**
 * Linearly interpolate between two numeric values.
 * Throws a TypeError when an argument is missing.
 */
export function lerp(value1, value2, step) {
  if (value1 === undefined || value2 === undefined || step === undefined) {
    throw new TypeError("Invalid arguments for lerp function");
  }
  return (1 - step) * value1 + step * value2;
}

/**
 * Remap a value from the range `[a, b]` into the range `[c, d]`.
 * The value is not clamped: one outside `[a, b]` lands outside `[c, d]`.
 */
export function remap(value, a, b, c, d) {
  return ((value - a) / (b - a)) * (d - c) + c;
}

/**
 * Return a random float or a random array element.
 * With no arguments, returns a float in `[0, 1)`.
 */
export function random(number1, number2) {
  if (number1 === undefined && number2 === undefined) {
    return Math.random();
  }
  if (number1.constructor === Array) {
    const index = Math.floor(Math.random() * number1.length);
    return number1[index];
  }
  if (number2 !== undefined) {
    return Math.random() * (number2 - number1) + number1;
  }

  return Math.random() * number1;
}

/**
 * Return a random integer, every value in the range being equally likely.
 * `randInt(max)` covers 0 to max, `randInt(min, max)` covers min to max;
 * both ends are included. Throws a TypeError when called with no arguments.
 */
export function randInt(number1, number2) {
  if (number1 === undefined && number2 === undefined) {
    throw new TypeError(
      "At least one argument is needed for the randInt function",
    );
  }
  const first = number2 === undefined ? 0 : number1;
  const second = number2 === undefined ? number1 : number2;
  const low = Math.ceil(Math.min(first, second));
  const high = Math.floor(Math.max(first, second));
  return Math.floor(Math.random() * (high - low + 1)) + low;
}

/**
 * Sample a triangular distribution, the port of vanilla `RandomSource.triangle`.
 * Subtracting two independent draws biases the result toward `mean` instead of
 * spreading it evenly, which is how vanilla scatters projectiles.
 */
export function triangle(mean, deviation, randomSource = Math.random) {
  // Named rather than inlined so the subtraction is not two identical
  // expressions (sonar javascript:S1764).
  const positive = randomSource();
  const negative = randomSource();
  return mean + deviation * (positive - negative);
}

/** Return the square of a number. */
export function sqr(value) {
  return value * value;
}

/** Convert an angle from degrees to radians. */
export function degreesToRadians(angle) {
  return (angle * Math.PI) / HALF_CIRCLE;
}

/** Convert an angle from radians to degrees. */
export function radiansToDegrees(angle) {
  return (angle * HALF_CIRCLE) / Math.PI;
}

/** Return the sine of an angle expressed in degrees. */
export function sinDegrees(angle) {
  return Math.sin(degreesToRadians(angle));
}

/** Return the cosine of an angle expressed in degrees. */
export function cosDegrees(angle) {
  return Math.cos(degreesToRadians(angle));
}

/** Log values through the shared logger. */
export function print(...messages) {
  logger.debug(...messages);
}

/**
 * Log tabular data. Bedrock's console has no `table` method, so each row is
 * written as JSON instead. A row that cannot be turned into JSON, such as a
 * circular structure, falls back to `String()`, so this never throws.
 */
export function table(...rows) {
  for (const row of rows) {
    let text;
    try {
      text = JSON.stringify(row);
    } catch {
      text = String(row);
    }
    logger.info(text);
  }
}

/** Log errors through the shared logger. */
export function error(...messages) {
  logger.error(...messages);
}
