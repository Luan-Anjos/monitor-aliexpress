const levels = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
};

const currentLevel = process.env.LOG_LEVEL || "info";

function canLog(level) {
  return levels[level] <= levels[currentLevel];
}

function log(level, message, meta) {
  if (!canLog(level)) return;

  const timestamp = new Date().toISOString();
  if (meta) {
    console.log(`[${timestamp}] [${level.toUpperCase()}] ${message}`, meta);
  } else {
    console.log(`[${timestamp}] [${level.toUpperCase()}] ${message}`);
  }
}

export const logger = {
  error: (message, meta) => log("error", message, meta),
  warn: (message, meta) => log("warn", message, meta),
  info: (message, meta) => log("info", message, meta),
  debug: (message, meta) => log("debug", message, meta),
};
