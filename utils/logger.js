// Developed by: Petar Mijailovic (leptr)
// GitHub: https://github.com/leptr
// Repo: https://github.com/leptr/bedrock-libs

/**
 * Central logging sink for the libraries.
 *
 * Bedrock's script engine only offers `console.log`, `console.info`,
 * `console.warn` and `console.error`. `warn` and `error` reach the in-game
 * Content Log GUI as well as the log file, while `log` and `info` reach the
 * file only, so severity has to map onto those four methods.
 *
 * This module is the single place in the libraries that touches `console`
 * directly, and the only place where rule javascript:S106 is suppressed. S106
 * permits `console.info`, so only the `log`, `warn` and `error` calls below
 * carry `// NOSONAR`.
 *
 * It imports nothing, so any library can use it without creating an import
 * cycle.
 */

/** Severity ranks, least to most important. */
const SEVERITY_RANK = { debug: 0, info: 1, warn: 2, error: 3 };

const loggerState = {
  minimumRank: SEVERITY_RANK.debug,
  isIgnoredErrorLoggingEnabled: false,
};

function isEnabled(severity) {
  return SEVERITY_RANK[severity] >= loggerState.minimumRank;
}

/**
 * Set the lowest severity that is written. Raise it to quieten the content log.
 * @param {"debug"|"info"|"warn"|"error"} severity
 */
export function setMinimumLogSeverity(severity) {
  if (!Object.hasOwn(SEVERITY_RANK, severity)) {
    throw new TypeError(`Unknown log severity: ${String(severity)}`);
  }
  loggerState.minimumRank = SEVERITY_RANK[severity];
}

export const logger = {
  /** Diagnostic detail. Reaches the Content Log file only. */
  debug(...messages) {
    if (isEnabled("debug")) {
      console.log(...messages); // NOSONAR: only console sink
    }
  },

  /** Routine progress. Reaches the Content Log file only. */
  info(...messages) {
    if (isEnabled("info")) {
      console.info(...messages);
    }
  },

  /** Recoverable problem. Reaches the Content Log GUI. */
  warn(...messages) {
    if (isEnabled("warn")) {
      console.warn(...messages); // NOSONAR: only console sink
    }
  },

  /** Failure. Reaches the Content Log GUI. */
  error(...messages) {
    if (isEnabled("error")) {
      console.error(...messages); // NOSONAR: only console sink
    }
  },
};

/**
 * Turn the logging of ignored errors on or off. It is off by default.
 *
 * The libraries guard many game API calls with a `try` whose `catch`
 * deliberately carries on, because the call fails in ordinary situations such
 * as an unloaded chunk or an entity that has just been removed. Those errors
 * are normally dropped. Switch this on while hunting a bug to see every one of
 * them in the Content Log file, with the place it came from.
 * @param {boolean} isEnabled
 */
export function setIgnoredErrorLogging(isEnabled) {
  loggerState.isIgnoredErrorLoggingEnabled = isEnabled === true;
}

/**
 * Report an error that the calling code has chosen to ignore.
 * Does nothing unless `setIgnoredErrorLogging(true)` has been called.
 * @param {string} source Where the error was caught, as `file:function`.
 * @param {unknown} error The caught error.
 */
export function logIgnoredError(source, error) {
  if (loggerState.isIgnoredErrorLoggingEnabled) {
    logger.debug(`[ignored] ${source}:`, error);
  }
}
