// Developed by: Petar Mijailovic (leptr)
// GitHub: https://github.com/leptr
// Repo: https://github.com/leptr/bedrock-libs

/**
 * Authored camera timeline definitions available for registration.
 *
 * USAGE (in main.js):
 * ```javascript
 * import { CameraSystem } from "./bedrock-libs/camera_system/index.js";
 * import { CAMERA_TIMELINES } from "./my_camera_timelines.js";
 *
 * for (const timeline of Object.values(CAMERA_TIMELINES)) {
 *   CameraSystem.createTimeline(timeline);
 * }
 * ```
 *
 * TRIGGERING A CUTSCENE:
 * ```javascript
 * CameraSystem.triggerCutscene("intro_example", {
 *   player1: playerEntity,
 *   entity1: bossEntity,
 *   entity2: allyEntity,
 * });
 * ```
 *
 * KEYFRAME DATA FORMAT
 * - keyframes are key-value pairs keyed by seconds from cutscene start.
 * - each keyframe can define camera and entity actions.
 * - each keyframe is the camera state at that exact time in the timeline.
 * - ease time is derived from the current -> next keyframe spacing by default.
 *   - `toCurrent` (default): the next keyframe defines the transition into its state
 *   - `toNext`: the current keyframe defines the transition toward the next state
 *
 * CAMERA SUPPORT (maps to @minecraft/server Camera methods):
 * - camera.clear -> Camera.clear()
 * - camera.fade -> Camera.fade(CameraFadeOptions)
 * - camera.fov -> Camera.setFov(CameraFovOptions)
 * - camera.preset + camera.setOptions -> Camera.setCamera(preset, setOptions)
 * - camera.setDefault + camera.preset -> Camera.setDefaultCamera(preset, easeOptions)
 * - defaultCameraPreset defaults to minecraft:free if omitted
 */

import {
  EntityEffect,
  ParticleEffect,
  SoundEffect,
} from "../../toolkit/toolkit.js";
import {
  CAMERA_EASE_MODES,
  CAMERA_EASE_TYPES,
  CAMERA_PRESET_IDS,
} from "../constants.js";

const INTRO_EXAMPLE_MARKERS = Object.freeze({
  intro: 0,
  reveal: 2,
  waitForTrigger: 2.6,
  fadeOut: 3.2,
  finalOrbit: 3.6,
});

const INTRO_EXAMPLE_CAMERA_SHOTS = Object.freeze({
  opening: {
    location: { x: 12, y: 65, z: -8 },
    rotation: { x: 10, y: 45 },
  },
  reveal: {
    location: { x: 6, y: 66, z: -2 },
    rotation: { x: 5, y: 90 },
    fovRamp: {
      from: 70,
      to: 55,
      durationSeconds: 1.2,
    },
  },
  fade: {
    fadeInTime: 0.3,
    holdTime: 0.3,
    fadeOutTime: 0.3,
  },
  finale: {
    location: { x: 3, y: 68, z: 4 },
    rotation: { x: 15, y: 135 },
    orbitRadius: 5,
    orbitHeight: 2,
    orbitAngle: 90,
  },
});

const INTRO_EXAMPLE_ENTITY_POSITIONS = Object.freeze({
  entity1Intro: { x: 10, y: 64, z: -5 },
});

const INTRO_EXAMPLE_EFFECT_DEFAULTS = Object.freeze({
  animationBlendOutTime: 0.1,
  // Effect durations are in seconds.
  slownessDuration: 2,
  slownessAmplifier: 1,
});

/** Timeline definition map keyed by timeline id. */
export const CAMERA_TIMELINES = {
  intro_example: {
    id: "intro_example",
    playerKey: "player1",
    defaultCameraPreset: CAMERA_PRESET_IDS.FREE,
    easeMode: CAMERA_EASE_MODES.TO_NEXT,
    lockInput: { movement: true, camera: true },
    cameraEvents: {
      entityMovement: {
        on: "minecraft:movement_off",
        off: "minecraft:movement_on",
      },
    },
    markers: {
      intro: INTRO_EXAMPLE_MARKERS.intro,
      reveal: INTRO_EXAMPLE_MARKERS.reveal,
    },
    clearOnEnd: true,
    keyframes: {
      [INTRO_EXAMPLE_MARKERS.intro]: {
        camera: {
          preset: CAMERA_PRESET_IDS.FREE,
          setOptions: {
            location: INTRO_EXAMPLE_CAMERA_SHOTS.opening.location,
            rotation: INTRO_EXAMPLE_CAMERA_SHOTS.opening.rotation,
          },
          easeType: CAMERA_EASE_TYPES.LINEAR,
        },
        entities: {
          entity1: {
            teleport: { location: INTRO_EXAMPLE_ENTITY_POSITIONS.entity1Intro },
          },
        },
      },
      [INTRO_EXAMPLE_MARKERS.reveal]: {
        tracks: {
          camera: {
            preset: CAMERA_PRESET_IDS.FREE,
            setOptions: {
              location: INTRO_EXAMPLE_CAMERA_SHOTS.reveal.location,
              rotation: INTRO_EXAMPLE_CAMERA_SHOTS.reveal.rotation,
            },
            easeType: CAMERA_EASE_TYPES.IN_OUT_SINE,
            fovRamp: {
              from: INTRO_EXAMPLE_CAMERA_SHOTS.reveal.fovRamp.from,
              to: INTRO_EXAMPLE_CAMERA_SHOTS.reveal.fovRamp.to,
              durationSeconds:
                INTRO_EXAMPLE_CAMERA_SHOTS.reveal.fovRamp.durationSeconds,
              easeType: CAMERA_EASE_TYPES.OUT_CUBIC,
            },
          },
          effects: {
            sourceKey: "player1",
            soundEffects: [new SoundEffect({ id: "random.explode" })],
            particleEffects: [
              new ParticleEffect({ id: "minecraft:lava_particle" }),
            ],
          },
          entities: {
            entity1: {
              playAnimation: {
                animation: "animation.my_mob.roar",
                options: {
                  blendOutTime:
                    INTRO_EXAMPLE_EFFECT_DEFAULTS.animationBlendOutTime,
                },
              },
              lockMovement: true,
              soundEffects: [new SoundEffect({ id: "random.explode" })],
              particleEffects: [
                new ParticleEffect({ id: "minecraft:lava_particle" }),
              ],
            },
            player1: {
              entityEffects: [
                new EntityEffect({
                  id: "minecraft:slowness",
                  duration: INTRO_EXAMPLE_EFFECT_DEFAULTS.slownessDuration,
                  amplifier: INTRO_EXAMPLE_EFFECT_DEFAULTS.slownessAmplifier,
                }),
              ],
            },
          },
        },
        conditions: {
          any: [
            { type: "tag", targetKey: "player1", tag: "cutscene_ok" },
            { type: "callback", name: "canPlayIntro" },
          ],
        },
      },
      [INTRO_EXAMPLE_MARKERS.waitForTrigger]: {
        pause: "wait_for_trigger",
      },
      [INTRO_EXAMPLE_MARKERS.fadeOut]: {
        camera: {
          fade: {
            fadeColor: { red: 0, green: 0, blue: 0 },
            fadeTime: {
              fadeInTime: INTRO_EXAMPLE_CAMERA_SHOTS.fade.fadeInTime,
              holdTime: INTRO_EXAMPLE_CAMERA_SHOTS.fade.holdTime,
              fadeOutTime: INTRO_EXAMPLE_CAMERA_SHOTS.fade.fadeOutTime,
            },
          },
        },
      },
      [INTRO_EXAMPLE_MARKERS.finalOrbit]: {
        camera: {
          preset: CAMERA_PRESET_IDS.FREE,
          setOptions: {
            location: INTRO_EXAMPLE_CAMERA_SHOTS.finale.location,
            rotation: INTRO_EXAMPLE_CAMERA_SHOTS.finale.rotation,
          },
          easeType: CAMERA_EASE_TYPES.OUT_CUBIC,
          rig: {
            type: "orbit",
            targetKey: "entity1",
            radius: INTRO_EXAMPLE_CAMERA_SHOTS.finale.orbitRadius,
            height: INTRO_EXAMPLE_CAMERA_SHOTS.finale.orbitHeight,
            angle: INTRO_EXAMPLE_CAMERA_SHOTS.finale.orbitAngle,
            lookAt: true,
          },
        },
        entityGroups: [
          {
            selector: { tags: ["cutscene_actor"] },
            actions: {
              addTag: "cutscene_active",
            },
          },
        ],
        entities: {
          entity2: {
            triggerEvent: "minecraft:entity_spawned",
          },
        },
      },
    },
  },
};
