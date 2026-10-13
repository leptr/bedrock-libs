// Developed by: Petar Mijailovic (leptr)
// GitHub: https://github.com/leptr
// Repo: https://github.com/leptr/bedrock-libs

/**
 * Copyable starter timeline definitions for common cutscene patterns.
 */

import { CAMERA_PRESET_IDS } from "./constants.js";

/** Reusable timeline templates keyed by template name. */
export const CAMERA_TEMPLATES = {
  intro: {
    id: "intro_template",
    keyframes: {
      0: { camera: { preset: CAMERA_PRESET_IDS.FREE } },
      1.5: { camera: { preset: CAMERA_PRESET_IDS.FREE } },
    },
  },
  reveal: {
    id: "reveal_template",
    keyframes: {
      0: {
        camera: {
          preset: CAMERA_PRESET_IDS.FREE,
          fade: {
            fadeColor: { red: 0, green: 0, blue: 0 },
            fadeTime: { fadeInTime: 0.4, holdTime: 0.2, fadeOutTime: 0.4 },
          },
        },
      },
      1.2: { camera: { preset: CAMERA_PRESET_IDS.FREE } },
    },
  },
  bossEntrance: {
    id: "boss_entrance_template",
    keyframes: {
      0: { camera: { preset: CAMERA_PRESET_IDS.FREE } },
      2: { camera: { preset: CAMERA_PRESET_IDS.FREE } },
      3: {
        effects: {
          soundEffects: [{ id: "random.explode", pitch: 0.8, volume: 1.2 }],
        },
      },
    },
  },
  cutaway: {
    id: "cutaway_template",
    keyframes: {
      0: { camera: { preset: CAMERA_PRESET_IDS.FREE } },
      0.8: { camera: { preset: CAMERA_PRESET_IDS.FREE } },
    },
  },
};
