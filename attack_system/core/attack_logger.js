// Developed by: Petar Mijailovic (leptr)
// GitHub: https://github.com/leptr
// Repo: https://github.com/leptr/bedrock-libs

/**
 * Attack-system log categorisation, history and statistics.
 * Formats entries, then hands them to the shared sink in common/logger.js.
 */

import { logger } from "../../utils/logger.js";

export class AttackLogger {
  /**
   * Log levels for filtering
   */
  static Levels = {
    DEBUG: 0,
    INFO: 1,
    WARN: 2,
    ERROR: 3,
  };

  /**
   * Log categories for organization
   */
  static Categories = {
    ATTACK: "ATTACK",
    DAMAGE: "DAMAGE",
    TARGET: "TARGET",
    EFFECT: "EFFECT",
    VALIDATION: "VALIDATION",
    CACHE: "CACHE",
    PERFORMANCE: "PERFORMANCE",
    ERROR: "ERROR",
  };

  /**
   * Extracts function name and line number from an Error stack trace.
   * @static
   * @param {Error} error - The Error object
   * @returns {Object} Object with functionName and lineInfo properties
   */
  static extractStackInfo(error) {
    if (!error) {
      return { functionName: "unknown", lineInfo: "" };
    }

    // Try to get stack trace first, then message as fallback
    const stack = error.stack || error.toString();
    if (!stack) {
      return { functionName: "unknown", lineInfo: "" };
    }

    const stackLines = stack.split("\n");

    // Look through stack lines to find the actual caller (skip first few which are the error itself)
    for (let index = 1; index < stackLines.length; index++) {
      const line = stackLines[index].trim();
      if (!line) {
        continue;
      }

      // Try to extract function name and location
      // Formats could be:
      // "at functionName (file.js:123:45)"
      // "functionName@file.js:123:45"
      // "at <anonymous> (file.js:123)"

      let functionName = "unknown";
      let lineInfo = "";

      // Format 1: "at functionName (path:line:col)"
      const atMatch = /at\s+([\w$.<>]+)\s*\(([^)]+):(\d+):(\d+)\)/u.exec(line);
      if (atMatch) {
        const [, matchedName, file, lineNum, col] = atMatch;
        functionName = matchedName;
        const fileName = file.split("/").pop() || file;
        lineInfo = `${fileName}:${lineNum}:${col}`;
        return { functionName, lineInfo };
      }

      // Format 2: "functionName@file.js:line:col"
      const atSymbolMatch = /^([\w$.<>]+)@([^:]+):(\d+):(\d+)/u.exec(line);
      if (atSymbolMatch) {
        const [, matchedName, file, lineNum, col] = atSymbolMatch;
        functionName = matchedName;
        const fileName = file.split("/").pop() || file;
        lineInfo = `${fileName}:${lineNum}:${col}`;
        return { functionName, lineInfo };
      }

      // If we found any line info at all, use it
      if (lineInfo) {
        return { functionName, lineInfo };
      }
    }

    return { functionName: "unknown", lineInfo: "" };
  }

  constructor(config = {}) {
    this.config = {
      level: config.level ?? "info", // 'debug', 'info', 'warn', 'error'
      maxLogs: config.maxLogs ?? 1000,
      enableConsole: config.enableConsole !== false,
      enableHistory: config.enableHistory !== false,
      enableGrouping: config.enableGrouping !== false,
      namespace: config.namespace ?? "Attack",
      ...config,
    };

    this.logs = [];
    this.logGroups = {};
    this.statistics = {
      debug: 0,
      info: 0,
      warn: 0,
      error: 0,
    };
  }

  /**
   * Logs a debug message.
   * @param {string} category - Log category
   * @param {string} message - The message to log
   * @param {any} data - Optional data to include
   */
  debug(category, message, data = undefined) {
    if (this.shouldLog("debug")) {
      this.log("debug", category, message, data);
    }
  }

  /**
   * Logs an info message.
   * @param {string} category - Log category
   * @param {string} message - The message to log
   * @param {any} data - Optional data to include
   */
  info(category, message, data = undefined) {
    if (this.shouldLog("info")) {
      this.log("info", category, message, data);
    }
  }

  /**
   * Logs a warning message.
   * @param {string} category - Log category
   * @param {string} message - The message to log
   * @param {any} data - Optional data to include
   */
  warn(category, message, data = undefined) {
    if (this.shouldLog("warn")) {
      this.log("warn", category, message, data);
    }
  }

  /**
   * Logs an error message.
   * @param {string} category - Log category
   * @param {string} message - The message to log
   * @param {Error|any} error - The error object or data
   */
  error(category, message, error = undefined) {
    this.log("error", category, message, error);
  }

  /**
   * Internal logging method.
   * @private
   */
  log(level, category, message, data) {
    const timestamp = Date.now();
    const logEntry = {
      timestamp,
      level,
      category,
      message,
      data,
      namespace: this.config.namespace,
    };

    // Add to statistics
    this.statistics[level]++;

    if (this.config.enableHistory) {
      this.logs.push(logEntry);

      // Limit history size
      if (this.logs.length > this.config.maxLogs) {
        this.logs.shift();
      }
    }

    // Group logs if enabled
    if (this.config.enableGrouping) {
      this.logGroups[category] ??= [];
      this.logGroups[category].push(logEntry);
    }

    // Output to console
    if (this.config.enableConsole) {
      this.outputToConsole(level, logEntry);
    }
  }

  /**
   * Outputs log entry to console with formatting.
   * @private
   */
  outputToConsole(level, logEntry) {
    const timestamp = new Date(logEntry.timestamp).toISOString();
    const prefix = `[${timestamp}] [${logEntry.namespace}] [${logEntry.category}]`;

    const message =
      logEntry.data !== null && logEntry.data !== undefined
        ? `${logEntry.message} ${JSON.stringify(logEntry.data)}`
        : logEntry.message;

    const fullMessage = `${prefix} ${message}`;

    switch (level) {
      case "debug": {
        logger.debug(fullMessage);
        break;
      }
      case "info": {
        logger.info(fullMessage);
        break;
      }
      case "warn": {
        logger.warn(fullMessage);
        break;
      }
      case "error": {
        if (logEntry.data instanceof Error) {
          logger.error(fullMessage, logEntry.data.stack);
        } else {
          logger.error(fullMessage);
        }
        break;
      }
      default: {
        break;
      }
    }
  }

  /**
   * Checks if a log level should be output.
   * @private
   */
  shouldLog(level) {
    const levels = AttackLogger.Levels;
    const configLevel = levels[this.config.level.toUpperCase()] ?? levels.INFO;
    const messageLevel = levels[level.toUpperCase()] ?? levels.INFO;

    return messageLevel >= configLevel;
  }

  /**
   * Gets all logs.
   * @param {string} category - Optional category filter
   * @param {string} level - Optional level filter
   * @returns {Object[]} Array of log entries
   */
  getLogs(category = undefined, level = undefined) {
    let filtered = [...this.logs];

    if (category) {
      filtered = filtered.filter(log => log.category === category);
    }

    if (level) {
      filtered = filtered.filter(log => log.level === level);
    }

    return filtered;
  }

  /**
   * Gets logs for a specific category.
   * @param {string} category - The category
   * @returns {Object[]} Array of log entries
   */
  getLogsForCategory(category) {
    return this.logGroups[category] || [];
  }

  /**
   * Gets recent logs.
   * @param {number} count - Number of recent logs to return
   * @returns {Object[]} Array of recent log entries
   */
  getRecentLogs(count = 50) {
    return this.logs.slice(-count);
  }

  /**
   * Clears all logs.
   */
  clearLogs() {
    this.logs = [];
    this.logGroups = {};
  }

  /**
   * Gets logging statistics.
   * @returns {Object} Statistics object
   */
  getStats() {
    const total = Object.values(this.statistics).reduce((a, b) => a + b, 0);

    return {
      statistics: this.statistics,
      historySize: this.logs.length,
      maxHistorySize: this.config.maxLogs,
      categories: Object.keys(this.logGroups).length,
      total,
    };
  }

  /**
   * Exports logs in a specific format.
   * @param {string} format - Export format ('json', 'csv', 'text')
   * @returns {string} Exported logs
   */
  exportLogs(format = "json") {
    switch (format) {
      case "json": {
        return JSON.stringify(this.logs, undefined, 2);
      }

      case "csv": {
        const headers = ["timestamp", "level", "category", "message"];
        const rows = this.logs.map(log => [
          log.timestamp,
          log.level,
          log.category,
          `"${log.message}"`,
        ]);

        return [headers, ...rows].map(row => row.join(",")).join("\n");
      }

      default: {
        return this.logs
          .map(log => {
            const timestamp = new Date(log.timestamp).toISOString();
            return `[${timestamp}] [${log.level.toUpperCase()}] [${
              log.category
            }] ${log.message}`;
          })
          .join("\n");
      }
    }
  }

  /**
   * Logs performance data.
   * @param {string} operationName - Name of the operation
   * @param {number} duration - Duration in milliseconds
   * @param {any} metadata - Optional metadata
   */
  logPerformance(operationName, duration, metadata = undefined) {
    const data = { duration: `${duration.toFixed(2)}ms`, ...metadata };

    if (duration > 100) {
      this.warn(
        AttackLogger.Categories.PERFORMANCE,
        `Slow operation: ${operationName}`,
        data,
      );
    } else {
      this.debug(
        AttackLogger.Categories.PERFORMANCE,
        `${operationName} completed`,
        data,
      );
    }
  }

  /**
   * Creates a performance timer.
   * @param {string} operationName - Name of the operation
   * @returns {Function} Timer function to call when done
   */
  createTimer(operationName) {
    const startTime = Date.now();

    return () => {
      const duration = Date.now() - startTime;
      this.logPerformance(operationName, duration);
      return duration;
    };
  }

  /**
   * Summarizes all logs by category.
   * @returns {Object} Summary object
   */
  summarize() {
    const summary = {};

    for (const [category, logs] of Object.entries(this.logGroups)) {
      const levelCounts = { debug: 0, info: 0, warn: 0, error: 0 };

      for (const log of logs) {
        levelCounts[log.level]++;
      }

      summary[category] = {
        total: logs.length,
        ...levelCounts,
      };
    }

    return summary;
  }
}

/**
 * Global logger instance
 */
export const globalAttackLogger = new AttackLogger({
  namespace: "AttackSystem",
  enableConsole: true,
  enableHistory: true,
  enableGrouping: true,
});
