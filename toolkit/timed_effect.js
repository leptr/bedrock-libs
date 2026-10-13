// Developed by: Petar Mijailovic (leptr)
// GitHub: https://github.com/leptr
// Repo: https://github.com/leptr/bedrock-libs

import { system, TicksPerSecond } from "@minecraft/server";

function normalizeSecondsToTicks(value, fallback, minimum = 0) {
  const resolved = Number(value);
  if (!Number.isFinite(resolved)) {
    return fallback;
  }

  return Math.max(minimum, Math.round(resolved * TicksPerSecond));
}

export function getTimedEffectWindow(config) {
  if (!config || typeof config !== "object") {
    return undefined;
  }

  const hasDelayAlias = config.delay !== undefined;
  const hasTimingWindow =
    hasDelayAlias ||
    config.startTime !== undefined ||
    config.endTime !== undefined ||
    config.interval !== undefined;

  if (!hasTimingWindow) {
    return undefined;
  }

  const rawStartTime = hasDelayAlias ? config.delay : config.startTime;
  const startTime = normalizeSecondsToTicks(rawStartTime, 0, 0);
  const endTime = normalizeSecondsToTicks(config.endTime, startTime, startTime);
  const interval = normalizeSecondsToTicks(config.interval, 1, 1);

  return {
    startTime,
    endTime,
    interval,
  };
}

export function applyTimedHitEffect(config, applyEffect, shouldContinue) {
  if (typeof applyEffect !== "function") {
    return false;
  }

  const canContinue =
    typeof shouldContinue === "function" ? shouldContinue : () => true;
  const timingWindow = getTimedEffectWindow(config);

  const runEffect = () => {
    if (!canContinue()) {
      return false;
    }

    applyEffect();
    return true;
  };

  if (!timingWindow) {
    runEffect();
    return true;
  }

  const startInterval = startTime => {
    if (timingWindow.endTime <= startTime) {
      return;
    }

    let elapsedTicks = startTime;
    const intervalHandle = system.runInterval(() => {
      elapsedTicks += timingWindow.interval;

      if (elapsedTicks > timingWindow.endTime || !canContinue()) {
        system.clearRun(intervalHandle);
        return;
      }

      applyEffect();

      if (elapsedTicks >= timingWindow.endTime) {
        system.clearRun(intervalHandle);
      }
    }, timingWindow.interval);
  };

  if (timingWindow.startTime > 0) {
    system.runTimeout(() => {
      if (!runEffect()) {
        return;
      }

      startInterval(timingWindow.startTime);
    }, timingWindow.startTime);
    return true;
  }

  if (!runEffect()) {
    return false;
  }

  startInterval(0);
  return true;
}
