# bedrock-libs

A collection of JavaScript libraries for Minecraft Bedrock development. The repository is meant to be added to a pack as a git submodule inside its `scripts` folder.

Changes between versions are listed in [CHANGELOG.md](CHANGELOG.md).

## Libraries

| Folder | What it contains |
|---|---|
| `better_vectors/` | `BVector2` and `BVector3`, mutable 2D and 3D vectors. Angles are in degrees. |
| `matrix/` | `Matrix`, a general rows-by-columns matrix. |
| `utils/` | Math helpers (`clamp`, `lerp`, `remap`, `random`, `randInt`, `triangle`, degree-based trigonometry, tick conversion) and the shared `logger`. |
| `toolkit/` | Entity, block and player helpers, offset descriptors, effect payload classes, the shared effect registry, and the per-tick entity scan. |
| `camera_system/` | Timeline cutscenes, the free follow camera and the vanilla camera bridge. `camera_system/examples/` holds sample timelines and a sample gameplay camera to copy into a pack. |
| `attack_system/` | Data-driven entity attacks: attack factory, target finding, damage, projectiles, attack selection, and the entity event registry. |
| `game_settings.js` | The shared `SETTINGS` object and `configureLibrary`. |

## Setup

Create a setup file in your pack and import it **first** in `main.js`, before anything else that uses the libraries:

```javascript
// scripts/library_setup.js
import { configureLibrary } from "./bedrock-libs/game_settings.js";

configureLibrary({
  namespace: "my_pack",
  settings: {
    attack_system: { defaults: { range: 6 } },
  },
});
```

```javascript
// scripts/main.js
import "./library_setup.js";
import { registerAttackSystemEvents } from "./bedrock-libs/attack_system/index.js";

registerAttackSystemEvents();
```

`configureLibrary` builds every id the libraries use (entity properties, events, tags, script events) from your namespace. Anything in `settings` overrides or extends the defaults. See `game_settings.js` for the full list.

Add entries to `SETTINGS.entities` through `configureLibrary` too. Entity settings lookups are cached, and `configureLibrary` is what refreshes them.

## Importing

Each library folder has an `index.js` that exports everything in it:

```javascript
import { BVector3 } from "./bedrock-libs/better_vectors/index.js";
import { AttackFactory, registerEntityHandlers } from "./bedrock-libs/attack_system/index.js";
```

The root `index.js` exports all libraries at once:

```javascript
import { BVector3, AttackFactory, CameraSystem } from "./bedrock-libs/index.js";
```

The root file loads every library, including the ones you do not use. Prefer the folder `index.js` files when a pack only needs part of the collection.

Inside the libraries, files import each other directly and never through an `index.js`.

## Units and conventions

- **Angles** are in degrees.
- **Yaw and pitch** follow Bedrock: yaw 0 is south, 90 is west, and a positive pitch looks down. Use `BVector3.fromYawPitch` and `toYawPitch` to convert.
- **Durations** written in attack configs, effect payloads and camera timelines are in seconds.
- **East is `+X`**, south is `+Z`, up is `+Y`.

## Errors

Vector and matrix methods, `lerp` and `randInt` throw when a required argument is missing or, for matrices, when sizes do not fit. They do not log and carry on.

The libraries guard many game API calls that fail in ordinary situations, such as an unloaded chunk or an entity that was just removed. Those errors are dropped by default. To see them while hunting a bug:

```javascript
import { setIgnoredErrorLogging } from "./bedrock-libs/utils/index.js";

setIgnoredErrorLogging(true);
```

Each one is then written to the Content Log file with the file and function it came from.

## Project hooks

The libraries contain no project-specific code. A pack plugs its own behaviour in through:

- `registerEntityHandlers(typeId, handlers)` for per-entity event handlers.
- `registerLifecycleHook(name, handler)` and the other registries in `attack_system/special_handler.js` for behaviour that applies to every entity.
- `setCustomEffectHandler(handler)` for effects marked `isCustom`.
- `registerScannedDimensionId(id)` for custom dimensions the per-tick entity scan should cover.

A pack that uses `getPlayerPositions`, `findNearestPlayerTo` or `findPlayerLookingAt` must call `invalidatePlayerPositions()` when a player joins, leaves or changes dimension.

## Development

```bash
npm install
```

```bash
npm run check
```

```bash
npm test
```

- `npm run check` type checks every file against the official Minecraft API definitions, using the documentation comments in the code. It should report nothing.
- `npm test` runs the tests in `tests/`. It needs Node 20.6 or newer and does not need the game or `npm install`.
- `npm run format` applies the code style.

Run these in a clone of this repository, not inside a pack's submodule copy: `npm install` creates a `node_modules` folder that must not end up in a pack.

Conventions the code follows:

- Every `if / else if` chain ends with an `else`, even when it has nothing to do.
- `console` is only used in `utils/logger.js`.
- An empty `catch` reports to `logIgnoredError` with its file and function.
- Every file starts with the author credit.
