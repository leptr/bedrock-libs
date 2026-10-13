// Developed by: Petar Mijailovic (leptr)
// GitHub: https://github.com/leptr
// Repo: https://github.com/leptr/bedrock-libs

/**
 * Registry of dimension ids the libraries' dimension-wide scans cover.
 *
 * The engine has no API to list custom dimensions, so a pack that registers
 * one must also register its id here, before the first tick, for
 * `getAllDimensions()` and the attack system's entity ticking to see the
 * entities in it.
 */

const scannedDimensionIds = ["overworld", "nether", "the_end"];

const scanState = { version: 0 };

/**
 * Add a dimension id to the scanned set. Safe to call more than once.
 * @param {string} dimensionId
 */
export function registerScannedDimensionId(dimensionId) {
  if (scannedDimensionIds.includes(dimensionId)) {
    return;
  }

  scannedDimensionIds.push(dimensionId);
  scanState.version++;
}

/**
 * @returns {string[]} Every dimension id scans should cover.
 */
export function getScannedDimensionIds() {
  return scannedDimensionIds;
}

/**
 * Bumped whenever the id list changes, so consumers can cache resolved
 * Dimension handles and only rebuild them after a registration.
 * @returns {number}
 */
export function getScanDimensionsVersion() {
  return scanState.version;
}
