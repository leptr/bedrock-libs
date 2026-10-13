# Changelog

Changes that matter to a pack using these libraries. Newest first.

Entries marked **Breaking** need a change in the pack.

## Unreleased

### Added

- **Attack system** (`attack_system/`): data-driven entity attacks, target finding, damage, projectiles, attack selection with cooldowns, and the entity event registry.
- **Shared settings** (`game_settings.js`): `SETTINGS`, `configureLibrary({ namespace, settings })` and `getSettingsVersion()`.
- **Export files**: an `index.js` in every library folder and one for the whole repository.
- **Shared logger** (`utils/logger.js`): `logger`, `setMinimumLogSeverity`, and `setIgnoredErrorLogging` to show errors the libraries normally ignore.
- **Toolkit**
  - `EffectRegistry`, `applyTimedHitEffect`, `setCustomEffectHandler` and `CAMERA_SHAKE_DEFAULTS`, shared by the attack and camera systems.
  - Per-tick entity scan cache: `getEntityScan`, `getEntitiesOfType`, `getPlayerPositions`, `findNearestPlayerTo`, `findPlayerLookingAt`.
  - `registerScannedDimensionId` for custom dimensions.
  - `isPlayer`, `usesLegacyRotation`, `invalidateEntitySettingsCache`, `AngleOffset.from`, `DirectionalOffset.from`.
- **Vectors**: `BVector3.fromYawPitch`, `toYawPitch`. Methods that change a vector return it, so calls can be chained. Static methods accept plain `{x, y, z}` objects.
- **Matrix**: `get(row, col)` and `set(row, col, value)`.
- **Utils**: `remap`, `triangle`, `sinDegrees`, `cosDegrees`, `degreesToRadians`, `radiansToDegrees`.
- **Camera system**
  - Free camera options `alignYawToVelocity` and `velocityYawMinSpeed`.
  - The timeline validator warns about keyframe keys the runtime does not read.
  - Type definitions for timelines and keyframes in `camera_system/types.js`.
- **Development**: `npm run check` (type check), `npm test`, `npm run format`.

### Changed

- **Breaking: bad input throws.** Vector and matrix methods, `lerp` and `randInt` throw instead of logging and returning nothing.
- **Breaking: `BVector3.east()` and `west()` are swapped** to match Bedrock (east is `+X`).
- **Breaking: camera timeline effect durations are in seconds**, as in the attack system. They were in ticks.
- **Breaking: `utils.map` is now `remap`**, and `sin` and `cos` are now `sinDegrees` and `cosDegrees`.
- **Breaking: `rotationRelativeOffset` is exported from the toolkit only**, no longer from utils.
- **Breaking: the vanilla camera override tag is built from the namespace.** It was the fixed text `ptr_vanilla_camera`. Set `camera_system.vanilla_override_tag` to keep the old tag.
- **Breaking: an entity's owner is stored under `<namespace>:owner_id`.** It used to share the property of the target id.
- `ticksToSeconds` no longer rounds to whole seconds.
- `randInt` picks every value in its range with the same chance.
- `BVector2.angle()` covers the full circle.
- Player input is locked and unlocked through the script API instead of the `/inputpermission` command.
- Camera functions that take a player check that it is one, and report it when it is not.
- A matrix stores its values in `data`. Matrices saved in the older format still load.
- The camera example files moved to `camera_system/examples/`.

### Fixed

- Files imported each other from folders that did not exist.
- `BVector2.multiply` and `divide` (static) returned their input unchanged.
- `Matrix.swapRows` and `swapColumns` did nothing, and `deserialize` did not return a matrix.
- `unstuckEntity` never searched up or down.
- `getNearestPlayer` checked line of sight in the wrong direction.
- Line attacks with no width never hit.
- A camera shake without all its values produced a broken command.
- Cutscenes ignored the timeline `origin` while blending between keyframes.
- The camera script-event help text showed broken colour codes.

### Removed

- **Breaking: the quad tree library.**
- **Breaking: the class-based attacks** (`SingleHitAttack`, `MultiHitAttack`, `ContinuousAttack`, `RangedAttack`, `MultiRangedAttack` and their variants) and `AttackData`. Use `AttackFactory.createAttack`.
- **Breaking: aliases of built-in `Math` functions** in utils (`floor`, `ceil`, `round`, `pow`, `sqrt`, `abs`, `acos`, `asin`, `tan`, `atan`, `atan2`, `exp`, `log`, `min`, `max`) and `write`.
- The camera system's own effect registry. It uses the shared one in the toolkit.
