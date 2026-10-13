// Developed by: Petar Mijailovic (leptr)
// GitHub: https://github.com/leptr
// Repo: https://github.com/leptr/bedrock-libs

/**
 * Shapes of the objects a pack writes for the camera system.
 *
 * This file contains no code. It exists so editors can suggest and check the
 * fields of a timeline while it is being written. Every shape also accepts
 * fields that are not listed here, because the runtime supports aliases and
 * project-specific data.
 */

/**
 * A position in the world.
 * @typedef {{x: number, y: number, z: number}} CameraLocation
 */

/**
 * A camera rotation in degrees. `x` is pitch and `y` is yaw.
 * @typedef {{x: number, y: number}} CameraRotation
 */

/**
 * Camera state at one keyframe.
 * @typedef {Object} CameraKeyframeCameraFields
 * @property {string} [preset] Camera preset id, such as `minecraft:free`.
 * @property {Object} [setOptions] Options passed to `Camera.setCamera`.
 * @property {CameraLocation} [location] Shorthand for `setOptions.location`.
 * @property {CameraLocation|Object} [position] A world position, or a DirectionalOffset resolved relative to `sourceKey`.
 * @property {CameraRotation|Object} [rotation] A rotation, or an AngleOffset applied relative to `sourceKey`.
 * @property {Object} [rotate] AngleOffset applied on top of the resolved rotation.
 * @property {string} [sourceKey] Binding key of the entity that shorthand positions and rotations are relative to.
 * @property {Object} [facingEntity] Entity the camera faces.
 * @property {CameraLocation} [facingLocation] Location the camera faces.
 * @property {boolean} [setDefault] Use `setDefaultCamera` instead of `setCamera`.
 * @property {boolean} [clear] Clear the camera when the keyframe is reached.
 * @property {number|Object} [fov] Field of view, or `CameraFovOptions`.
 * @property {{from: number, to: number, durationSeconds: number, easeType?: string}} [fovRamp] Field of view change over time.
 * @property {Object} [fade] `CameraFadeOptions`.
 * @property {Object} [shake] One camera shake: `intensity`, `duration`, `shakeType`, `radius`.
 * @property {Object[]} [shakes] Several camera shakes.
 * @property {false|Record<string, boolean>} [hud] HUD elements to hide (`true`) or restore (`false`); `{ all: true }` hides all.
 * @property {string} [easeType] Easing name, such as `Linear` or `InOutSine`. See CAMERA_EASE_TYPES.
 * @property {string} [fovEasingType] Easing used only for `fov`.
 * @property {number} [easeTimeSeconds] Overrides the easing duration derived from keyframe spacing.
 * @property {CameraRig} [rig] Camera rig.
 * @property {{targetKey?: string, location?: CameraLocation, weight?: number}} [lookAt] Look-at target.
 * @property {Object} [blend] Blend between two presets or option sets.
 */

/**
 * @typedef {CameraKeyframeCameraFields & Record<string, any>} CameraKeyframeCamera
 */

/**
 * A camera rig.
 * @typedef {Object} CameraRigFields
 * @property {"orbit"|"dolly"|"crane"|"pan"|"truck"|"handheld"} type Rig type.
 * @property {string} [targetKey] Binding key of the entity the rig follows.
 * @property {CameraLocation} [targetLocation] Fixed location the rig follows.
 * @property {CameraLocation} [offset] Offset from the target.
 * @property {number} [radius] Orbit radius.
 * @property {number} [height] Orbit height.
 * @property {number} [angle] Orbit angle in degrees.
 * @property {boolean} [lookAt] Face the target.
 * @property {number} [lookAtWeight] How strongly the rig faces the target, from 0 to 1.
 */

/**
 * @typedef {CameraRigFields & Record<string, any>} CameraRig
 */

/**
 * One text field of a subtitle keyframe.
 * @typedef {Object} CameraSubtitleField
 * @property {string} [text] Plain text.
 * @property {string} [translate] Translation key.
 * @property {Array<string|number>} [with] Values inserted into the translation.
 * @property {boolean} [clear] Clear this field.
 */

/**
 * Subtitles at one keyframe. Top-level `text` and `translate` go to the
 * action bar.
 * @typedef {Object} CameraSubtitlesFields
 * @property {string} [text] Action bar text.
 * @property {string} [translate] Action bar translation key.
 * @property {Array<string|number>} [with] Values inserted into the translation.
 * @property {CameraSubtitleField} [actionbar] Action bar field.
 * @property {CameraSubtitleField} [title] Title field.
 * @property {CameraSubtitleField} [subtitle] Subtitle field.
 * @property {boolean} [clearOtherFields] Clear the fields this keyframe leaves out. Defaults to true.
 */

/**
 * @typedef {CameraSubtitlesFields & Record<string, any>} CameraSubtitles
 */

/**
 * Actions for one bound entity at a keyframe.
 * @typedef {Object} CameraEntityActionsFields
 * @property {{location: CameraLocation, options?: Object}} [teleport] Teleport the entity.
 * @property {Object} [safeTeleport] Teleport with `findNearestAir` and `alignGround` options.
 * @property {{animation: string, options?: Object}} [playAnimation] Play an animation.
 * @property {{targetKey?: string, location?: CameraLocation}} [lookAt] Turn the entity towards a target.
 * @property {Record<string, string|number|boolean>} [setProperty] Entity properties to set.
 * @property {string|string[]} [triggerEvent] Entity events to trigger.
 * @property {string|string[]} [addTag] Tags to add.
 * @property {string|string[]} [removeTag] Tags to remove.
 * @property {boolean|{on?: string|boolean, off?: string|boolean}} [lockMovement] Lock or unlock the entity's movement.
 * @property {Object|Object[]} [soundEffects] SoundEffect payloads.
 * @property {Object|Object[]} [particleEffects] ParticleEffect payloads.
 * @property {Object|Object[]} [entityEffects] EntityEffect payloads. Durations are in seconds.
 */

/**
 * @typedef {CameraEntityActionsFields & Record<string, any>} CameraEntityActions
 */

/**
 * Everything that can happen at one keyframe.
 * @typedef {Object} CameraKeyframeFields
 * @property {CameraKeyframeCamera} [camera] Camera state.
 * @property {CameraSubtitles|string|false} [subtitles] Subtitles. An empty object clears all fields.
 * @property {Record<string, CameraEntityActions>} [entities] Entity actions by binding key.
 * @property {Array<{selector: Object, actions: CameraEntityActions}>} [entityGroups] Actions for every entity a selector matches.
 * @property {Object} [effects] Effects not tied to one entity: `sourceKey`, `soundEffects`, `particleEffects`, `entityEffects`.
 * @property {Object} [tracks] The same content grouped by track: `camera`, `subtitles`, `entities`, `effects`, `audio`, `groups`.
 * @property {Object} [conditions] Conditions that must hold for the keyframe to run: `all`, `any`, `callback`.
 * @property {number|string} [goto] Time in seconds, or marker name, to jump to.
 * @property {boolean|string} [pause] Pause the cutscene here. A string is the key `resumeCutscene` must be given.
 * @property {Array<{id: string, bindings?: Object, inheritBindings?: boolean}>} [startTimelines] Other timelines to start.
 * @property {(context: Object) => void} [onEnter] Called when the keyframe is reached.
 * @property {(context: Object) => void} [onExit] Called when the keyframe is left.
 * @property {string} [runCallback] Name of a callback passed to `triggerCutscene`.
 * @property {string[]} [runCallbacks] Names of callbacks passed to `triggerCutscene`.
 * @property {string|string[]|Object} [commands] Commands to run.
 */

/**
 * @typedef {CameraKeyframeFields & Record<string, any>} CameraKeyframe
 */

/**
 * A timeline as a pack writes it.
 * @typedef {Object} CameraTimelineConfig
 * @property {string} id Timeline id.
 * @property {Record<string, CameraKeyframe>} keyframes Keyframes keyed by time in seconds.
 * @property {string} [playerKey] Binding key of the player whose camera is controlled. Defaults to `player1`.
 * @property {string} [defaultCameraPreset] Preset used when a keyframe names none.
 * @property {"toNext"|"toCurrent"} [easeMode] Which keyframe's timing an easing segment uses.
 * @property {{movement?: boolean, camera?: boolean}} [lockInput] Player input locked during the cutscene.
 * @property {{entityMovement?: {on?: string, off?: string}}} [cameraEvents] Default entity events for `lockMovement`.
 * @property {CameraLocation} [origin] World position that origin-relative locations are measured from.
 * @property {Record<string, number>} [markers] Named times, usable with `goto`.
 * @property {string[]} [mutedTracks] Tracks that do not play.
 * @property {boolean} [stopExisting] Stop a running cutscene with the same timeline id first.
 * @property {boolean} [clearOnEnd] Clear the camera when the cutscene ends.
 */

export {};
