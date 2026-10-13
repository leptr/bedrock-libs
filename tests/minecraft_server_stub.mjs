// Developed by: Petar Mijailovic (leptr)
// GitHub: https://github.com/leptr
// Repo: https://github.com/leptr/bedrock-libs

/**
 * Stand-in for "@minecraft/server" used by the tests.
 *
 * Every export the libraries import must be listed here; the test in
 * library.test.mjs fails when one is missing. Calls made on the stand-ins are
 * recorded in `nativeCalls`, so a test can check that loading a file does no
 * work by itself.
 */

/** Names of the stand-in functions that have been called. */
export const nativeCalls = [];

function standIn(label) {
  return new Proxy(function () {}, {
    get(target, key) {
      if (key === "then" || typeof key === "symbol") {
        return undefined;
      }
      return standIn(`${label}.${String(key)}`);
    },
    apply() {
      nativeCalls.push(label);
      return standIn(`${label}()`);
    },
  });
}

export const TicksPerSecond = 20;

export const Difficulty = {
  Peaceful: "Peaceful",
  Easy: "Easy",
  Normal: "Normal",
  Hard: "Hard",
};

export const EquipmentSlot = {
  Head: "Head",
  Chest: "Chest",
  Legs: "Legs",
  Feet: "Feet",
  Mainhand: "Mainhand",
  Offhand: "Offhand",
};

export const InputPermissionCategory = { Camera: 1, Movement: 2 };

export const EasingType = standIn("EasingType");
export const EntityComponentTypes = standIn("EntityComponentTypes");
export const EntityDamageCause = standIn("EntityDamageCause");
export const HudElement = standIn("HudElement");
export const HudVisibility = standIn("HudVisibility");
export const system = standIn("system");
export const world = standIn("world");
