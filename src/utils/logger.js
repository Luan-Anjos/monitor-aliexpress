const levels = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
};

export function createLogger(level = "info") {
  const currentLevel = levels[level] ?? levels.info;

  function canLog(targetLevel) {
    return (levels[targetLevel] ?? levels.info) <= currentLevel;
  }

  function log(targetLevel, ...args) {
    if (!canLog(targetLevel)) return;
    const stamp = new Date().toISOString();
    console[targetLevel === "debug" ? "log" : targetLevel](`[${stamp}] [${targetLevel.toUpperCase()}]`, ...args);
  }

  return {
    error: (...args) => log("error", ...args),
    warn: (...args) => log("warn", ...args),
    info: (...args) => log("info", ...args),
    debug: (...args) => log("debug", ...args),
  };
}
