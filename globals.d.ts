// Globals the Bedrock script engine provides that are not part of the
// @minecraft/server typings. Used only by the type check (jsconfig.json).
declare const console: {
  log(...data: unknown[]): void;
  info(...data: unknown[]): void;
  warn(...data: unknown[]): void;
  error(...data: unknown[]): void;
};
