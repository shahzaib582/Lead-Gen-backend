const { createLogger, format, transports } = require('winston');

const isProduction = process.env.NODE_ENV === 'production';

function productionPrintf() {
  return format.printf(({ timestamp, level, message, stack, ...meta }) => {
    const lvl = level.toUpperCase().padEnd(5);
    let line = `[${timestamp}] ${lvl} ${message}`;
    if (stack) {
      line += `\n${stack}`;
    } else if (Object.keys(meta).length > 0) {
      line += ` ${JSON.stringify(meta)}`;
    }
    return line;
  });
}

function developmentPrintf() {
  return format.printf(({ timestamp, level, message, stack, ...meta }) => {
    const extras = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
    let line = `[${timestamp}] ${level}: ${message}${extras}`;
    if (stack) line += `\n${stack}`;
    return line;
  });
}

const logger = createLogger({
  level: process.env.LOG_LEVEL || (isProduction ? 'info' : 'info'),
  format: format.combine(
    format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    format.errors({ stack: true }),
    format.splat()
  ),
  transports: [
    new transports.Console({
      format: isProduction
        ? format.combine(format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }), productionPrintf())
        : format.combine(format.colorize(), format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }), developmentPrintf()),
    }),
  ],
});

module.exports = logger;
