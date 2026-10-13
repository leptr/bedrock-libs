// Developed by: Petar Mijailovic (leptr)
// GitHub: https://github.com/leptr
// Repo: https://github.com/leptr/bedrock-libs

/**
 * Everything the library exports, in one place.
 *
 * ```javascript
 * import { BVector3, AttackFactory, CameraSystem } from "./bedrock-libs/index.js";
 * ```
 *
 * Importing from this file loads every library, because Bedrock runs scripts
 * as written and cannot leave out the parts a pack does not use. A pack that
 * only needs one library can import that library's own index.js instead, for
 * example "./bedrock-libs/better_vectors/index.js".
 *
 * Files inside the libraries must never import from this file or from their
 * own section's index.js. They import the file they need directly, otherwise
 * the modules end up importing each other in a circle.
 */

export * from "./game_settings.js";
export * from "./utils/index.js";
export * from "./better_vectors/index.js";
export * from "./matrix/index.js";
export * from "./toolkit/index.js";
export * from "./camera_system/index.js";
export * from "./attack_system/index.js";
