// Developed by: Petar Mijailovic (leptr)
// GitHub: https://github.com/leptr
// Repo: https://github.com/leptr/bedrock-libs

/**
 * Default values shared by every library that applies effects.
 * This module imports nothing.
 */

/** Camera shake values used when an effect leaves them out. */
export const CAMERA_SHAKE_DEFAULTS = {
  radius: 30,
  intensity: 0.5,
  duration: 10,
  shakeType: "positional",
  playerIntensity: 0.2,
  playerDuration: 0.3,
};
