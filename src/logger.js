import { config } from './config.js';

const levels = { debug: 0, info: 1, warn: 2, error: 3 };
const current = levels[config.logLevel] ?? levels.info;

function ts() {
  return new Date().toISOString();
}

export const log = {
  debug: (...args) => current <= levels.debug && console.log(`[${ts()}] [DEBUG]`, ...args),
  info: (...args) => current <= levels.info && console.log(`[${ts()}] [INFO]`, ...args),
  warn: (...args) => current <= levels.warn && console.warn(`[${ts()}] [WARN]`, ...args),
  error: (...args) => current <= levels.error && console.error(`[${ts()}] [ERROR]`, ...args),
};
