'use strict';

const colors = require('colors/safe');

const LOG_LEVEL = {
  trace: 5,
  debug: 4,
  info: 3,
  warn: 2,
  error: 1,
  fatal: 0,
};

const isLogLevelPermission = level => {
  const envLevel = LOG_LEVEL[process.env.LOG_LEVEL || 'warn'];
  return (envLevel != null ? envLevel : LOG_LEVEL.warn) >= level;
};

const noop = () => {};

const createLogger = name => ({
  trace: isLogLevelPermission(LOG_LEVEL.trace) ? console.log.bind(console, colors.green.grey(`[${name}|trace]`)) : noop,
  debug: isLogLevelPermission(LOG_LEVEL.debug) ? console.log.bind(console, colors.blue.bold(`[${name}|debug]`)) : noop,
  info: isLogLevelPermission(LOG_LEVEL.info) ? console.log.bind(console, colors.green.bold(`[${name}|info]`)) : noop,
  warn: isLogLevelPermission(LOG_LEVEL.warn) ? console.log.bind(console, colors.yellow.bold(`[${name}|warn]`)) : noop,
  error: isLogLevelPermission(LOG_LEVEL.error) ? console.log.bind(console, colors.red.bold(`[${name}|error]`)) : noop,
  fatal: isLogLevelPermission(LOG_LEVEL.fatal) ? console.log.bind(console, colors.red.bold(`[${name}|fatal]`)) : noop,
});

module.exports = {
  createLogger,
};
