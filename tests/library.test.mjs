// Developed by: Petar Mijailovic (leptr)
// GitHub: https://github.com/leptr
// Repo: https://github.com/leptr/bedrock-libs

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import * as stub from "./minecraft_server_stub.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SECTIONS = [
  "better_vectors",
  "matrix",
  "utils",
  "toolkit",
  "camera_system",
  "attack_system",
];
function listFiles(directory, extension, out = []) {
  for (const name of fs.readdirSync(directory)) {
    if (name === "node_modules" || name === ".git") {
      continue;
    }
    const full = path.join(directory, name);
    if (fs.statSync(full).isDirectory()) {
      listFiles(full, extension, out);
    } else if (name.endsWith(extension)) {
      out.push(full);
    }
  }
  return out;
}

const libraryFiles = listFiles(root, ".js");
const load = file => import(pathToFileURL(file).href);

test("the stand-in exports everything the libraries import from the game", () => {
  for (const file of libraryFiles) {
    const source = fs.readFileSync(file, "utf8");
    // Only real import statements: type imports inside comments do not count.
    const pattern = /^import\s*\{([^}]*)\}\s*from\s*"@minecraft\/server"/gm;
    for (const match of source.matchAll(pattern)) {
      for (const part of match[1].split(",")) {
        const name = part.trim().split(/\s+as\s+/)[0];
        if (name) {
          assert.ok(name in stub, `${name} (imported by ${file})`);
        }
      }
    }
  }
});

test("every file loads and does no work while loading", async () => {
  for (const file of libraryFiles) {
    await load(file);
  }
  assert.deepEqual(stub.nativeCalls, []);
});

test("no export is lost in the index files", async () => {
  const rootModule = await load(path.join(root, "index.js"));
  for (const section of SECTIONS) {
    const index = path.join(root, section, "index.js");
    const sectionModule = await load(index);
    const source = fs.readFileSync(index, "utf8");
    for (const match of source.matchAll(/export \* from "(.+?)"/g)) {
      const fileModule = await load(path.join(root, section, match[1]));
      for (const name of Object.keys(fileModule)) {
        assert.ok(name in sectionModule, `${name} missing from ${section}`);
        assert.ok(name in rootModule, `${name} missing from the root index`);
      }
    }
  }
});

test("library files never import from an index file", () => {
  for (const file of libraryFiles) {
    if (path.basename(file) === "index.js") {
      continue;
    }
    const source = fs.readFileSync(file, "utf8");
    // Only statements: usage examples inside comments do not count.
    assert.doesNotMatch(
      source,
      /^(import|export|\})[^\n]* from "[^"]*index\.js"/m,
      file,
    );
  }
});

test("settings are built from the namespace and changed in place", async () => {
  const { SETTINGS, configureLibrary, getSettingsVersion } = await load(
    path.join(root, "game_settings.js"),
  );
  const defaults = SETTINGS.attack_system.defaults;
  const versionBefore = getSettingsVersion();

  configureLibrary({
    namespace: "test_pack",
    settings: {
      attack_system: { defaults: { range: 9 } },
      entities: { boss: { id: "test_pack:boss", xp_reward: 80 } },
    },
  });

  assert.equal(SETTINGS.general.namespace, "test_pack");
  assert.equal(SETTINGS.entities.global_properties.state, "test_pack:state");
  assert.equal(
    SETTINGS.entities.global_properties.owner_id,
    "test_pack:owner_id",
  );
  assert.notEqual(
    SETTINGS.entities.global_properties.owner_id,
    SETTINGS.entities.global_properties.target_id,
  );
  assert.equal(SETTINGS.attack_system.defaults, defaults);
  assert.equal(defaults.range, 9);
  assert.equal(SETTINGS.entities.boss.xp_reward, 80);
  assert.equal(getSettingsVersion(), versionBefore + 1);
  assert.throws(() => configureLibrary({ namespace: "" }), TypeError);
});

test("entity settings lookups follow configureLibrary", async () => {
  const { configureLibrary } = await load(path.join(root, "game_settings.js"));
  const { getEntitySettingsConfig, usesLegacyRotation } = await load(
    path.join(root, "toolkit", "index.js"),
  );

  assert.equal(getEntitySettingsConfig("test_pack:late"), undefined);
  configureLibrary({
    settings: {
      entities: { late: { id: "test_pack:late", uses_legacy_rotation: true } },
    },
  });
  const config = getEntitySettingsConfig("test_pack:late");
  assert.equal(config.id, "test_pack:late");
  assert.equal(usesLegacyRotation(config), true);
  assert.equal(usesLegacyRotation({ usesLegacyRotation: true }), true);
  assert.equal(usesLegacyRotation({}), false);
});

test("the attack system hooks and registries", async () => {
  const attack = await load(path.join(root, "attack_system", "index.js"));

  let removed = 0;
  attack.registerLifecycleHook("entityRemove", () => {
    removed += 1;
  });
  attack.onEntityRemove({ removedEntityId: "1" });
  assert.equal(removed, 1);
  assert.throws(
    () => attack.registerLifecycleHook("unknown", () => {}),
    TypeError,
  );
  assert.throws(
    () => attack.registerLifecycleHook("entityRemove", "nope"),
    TypeError,
  );

  assert.equal(attack.isHandledDataDrivenEventId("test_pack:death"), true);
  assert.equal(attack.isHandledDataDrivenEventId("test_pack:other"), false);
  attack.registerHandledDataDrivenEventId("test_pack:other");
  assert.equal(attack.isHandledDataDrivenEventId("test_pack:other"), true);

  attack.registerEntityHandlers("test_pack:boss", {
    onEvent: { "test_pack:roar": () => {} },
  });
  assert.equal(attack.isHandledDataDrivenEventId("test_pack:roar"), true);
  assert.deepEqual(attack.getRegistryStats().registeredEntities, [
    "test_pack:boss",
  ]);
});

test("custom effects go to the registered handler", async () => {
  const toolkit = await load(path.join(root, "toolkit", "index.js"));
  const originalWarn = console.warn;
  console.warn = () => {};
  try {
    assert.equal(toolkit.applyCustomEffect({}, { id: "burn" }), false);
  } finally {
    console.warn = originalWarn;
  }

  let applied;
  toolkit.setCustomEffectHandler((entity, effect) => {
    applied = effect.id;
  });
  assert.equal(toolkit.applyCustomEffect({}, { id: "burn" }), true);
  assert.equal(applied, "burn");
  toolkit.setCustomEffectHandler(undefined);
});

test("offset helpers", async () => {
  const toolkit = await load(path.join(root, "toolkit", "index.js"));
  assert.equal(toolkit.AngleOffset.from({ theta: 5 }).getTheta(), 5);
  assert.equal(toolkit.DirectionalOffset.from({ front: 2 }).getFront(), 2);
  for (let index = 0; index < 50; index++) {
    const side = new toolkit.DirectionalOffset(0, [1, 2], 0).getSide();
    assert.ok(side >= 1 && side < 2);
  }
  assert.equal(toolkit.isPlayer(undefined), false);
  assert.equal(toolkit.isPlayer({ isValid: true, typeId: "x:y" }), false);
  assert.equal(
    toolkit.isPlayer({ isValid: true, typeId: "minecraft:player" }),
    true,
  );
});

test("scanned dimensions can be extended", async () => {
  const toolkit = await load(path.join(root, "toolkit", "index.js"));
  const versionBefore = toolkit.getScanDimensionsVersion();
  toolkit.registerScannedDimensionId("test_pack:realm");
  toolkit.registerScannedDimensionId("test_pack:realm");
  assert.ok(toolkit.getScannedDimensionIds().includes("test_pack:realm"));
  assert.equal(toolkit.getScanDimensionsVersion(), versionBefore + 1);
});

test("the vanilla camera tag follows the namespace", async () => {
  const { configureLibrary } = await load(path.join(root, "game_settings.js"));
  const camera = await load(path.join(root, "camera_system", "index.js"));
  assert.equal(
    camera.getVanillaCameraOverrideTag(),
    "test_pack_vanilla_camera",
  );
  configureLibrary({
    settings: { camera_system: { vanilla_override_tag: "custom_tag" } },
  });
  assert.equal(camera.getVanillaCameraOverrideTag(), "custom_tag");
});

test("the timeline validator reports problems", async () => {
  const camera = await load(path.join(root, "camera_system", "index.js"));
  const { CameraValidator } = camera;

  assert.equal(CameraValidator.validateTimeline(undefined).valid, false);
  assert.equal(
    CameraValidator.validateTimeline({ keyframes: {} }).valid,
    false,
  );

  const withTypo = CameraValidator.validateTimeline({
    id: "typo",
    keyframes: { 0: { camra: {}, tracks: { musik: {} } } },
  });
  assert.equal(withTypo.valid, true);
  const fields = withTypo.warnings
    .filter(warning => warning.type === "UNKNOWN_KEY")
    .map(warning => warning.field);
  assert.deepEqual(fields, ["keyframes.0.camra", "keyframes.0.tracks.musik"]);

  const negative = CameraValidator.validateTimeline({
    id: "negative",
    keyframes: { "-1": {} },
  });
  assert.equal(negative.valid, false);
});

test("the example timelines are valid and free of warnings", async () => {
  const camera = await load(path.join(root, "camera_system", "index.js"));
  const { CAMERA_TIMELINES } = await load(
    path.join(root, "camera_system", "examples", "camera_timelines.js"),
  );
  for (const timeline of Object.values(CAMERA_TIMELINES)) {
    const result = camera.CameraValidator.validateTimeline(timeline);
    assert.equal(result.valid, true, timeline.id);
    assert.deepEqual(result.warnings, [], timeline.id);
    const built = camera.CameraTimeline.fromObject(timeline);
    assert.ok(built.getDurationSeconds() > 0);
  }
  for (const template of Object.values(camera.CAMERA_TEMPLATES)) {
    const result = camera.CameraValidator.validateTimeline(template);
    assert.deepEqual(result.warnings, [], template.id);
  }
});

test("timed effect windows are read in seconds", async () => {
  const toolkit = await load(path.join(root, "toolkit", "index.js"));
  assert.equal(toolkit.getTimedEffectWindow({ id: "x" }), undefined);
  assert.deepEqual(
    toolkit.getTimedEffectWindow({ startTime: 1, endTime: 2, interval: 0.5 }),
    { startTime: 20, endTime: 40, interval: 10 },
  );
  assert.deepEqual(toolkit.getTimedEffectWindow({ delay: 0.5 }), {
    startTime: 10,
    endTime: 10,
    interval: 1,
  });
});

test("attack configs are validated", async () => {
  const attack = await load(path.join(root, "attack_system", "index.js"));
  const valid = attack.AttackValidator.validate({
    type: attack.ATTACK_TYPES.SINGLE,
    pattern: attack.DAMAGE_PATTERNS.CONE,
    damage: 5,
    range: 4,
    angle: 45,
  });
  assert.equal(valid.valid, true, JSON.stringify(valid.errors));

  const invalid = attack.AttackValidator.validate({
    type: "nonsense",
    pattern: attack.DAMAGE_PATTERNS.CONE,
    damage: 5,
    range: 4,
  });
  assert.equal(invalid.valid, false);
});
