// Developed by: Petar Mijailovic (leptr)
// GitHub: https://github.com/leptr
// Repo: https://github.com/leptr/bedrock-libs

/**
 * Registers authored timeline definitions with the camera system.
 */

import { CameraSystem } from "../camera_system.js";
import { CAMERA_TIMELINES } from "./camera_timelines.js";

/**
 * Register all entries from `CAMERA_TIMELINES` with `CameraSystem`.
 * Call once during startup.
 */
export function registerCameraTimelines() {
  for (const timeline of Object.values(CAMERA_TIMELINES)) {
    CameraSystem.createTimeline(timeline);
  }
}
