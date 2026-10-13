// Developed by: Petar Mijailovic (leptr)
// GitHub: https://github.com/leptr
// Repo: https://github.com/leptr/bedrock-libs

/**
 * Camera preset helpers for authoring reusable rig fragments.
 */

const CAMERA_PRESET_DEFAULTS = Object.freeze({
  orbit: {
    radius: 6,
    height: 2,
    angle: 0,
  },
  dollyOffset: { x: 0, y: 0, z: -6 },
  craneOffset: { x: 0, y: 4, z: -6 },
  handheldOffset: { x: 0, y: 1.6, z: -2 },
});

/** Preset helpers that return partial keyframe camera configs. */
export const CAMERA_PRESETS = {
  orbit: parameters => ({
    rig: {
      type: "orbit",
      targetKey: parameters?.targetKey,
      radius: parameters?.radius ?? CAMERA_PRESET_DEFAULTS.orbit.radius,
      height: parameters?.height ?? CAMERA_PRESET_DEFAULTS.orbit.height,
      angle: parameters?.angle ?? CAMERA_PRESET_DEFAULTS.orbit.angle,
      lookAt: parameters?.lookAt ?? true,
    },
  }),
  dolly: parameters => ({
    rig: {
      type: "dolly",
      targetKey: parameters?.targetKey,
      offset: parameters?.offset ?? CAMERA_PRESET_DEFAULTS.dollyOffset,
      lookAt: parameters?.lookAt ?? true,
    },
  }),
  crane: parameters => ({
    rig: {
      type: "crane",
      targetKey: parameters?.targetKey,
      offset: parameters?.offset ?? CAMERA_PRESET_DEFAULTS.craneOffset,
      lookAt: parameters?.lookAt ?? true,
    },
  }),
  handheld: parameters => ({
    rig: {
      type: "handheld",
      targetKey: parameters?.targetKey,
      offset: parameters?.offset ?? CAMERA_PRESET_DEFAULTS.handheldOffset,
      lookAt: parameters?.lookAt ?? true,
    },
  }),
};
