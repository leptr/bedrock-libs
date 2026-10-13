// Developed by: Petar Mijailovic (leptr)
// GitHub: https://github.com/leptr
// Repo: https://github.com/leptr/bedrock-libs

/**
 * Loaded before the tests (see the "test" script in package.json).
 * The game provides "@minecraft/server" at run time, and the npm package of
 * that name only contains type definitions, so the tests swap in a stand-in.
 */
import { register } from "node:module";

register("./hooks.mjs", import.meta.url);
