import winston from 'winston';
import path from 'path';
import config from '../config/index.js'; // Assuming config will be created later

const logsDir = path.resolve(process.cwd(), 'logs');

// Ensure logs directory exists (optional, Winston can create files but not dirs)
// import fs from 'fs';
// if (!fs.existsSync(logsDir)) {
//   fs.mkdirSync(logsDir, { recursive: true });
// }

const { combine, timestamp, printf, colorize, errors, json } = winston.format;

// Custom format for console logging
const consoleFormat = printf(({ level, message, timestamp, context, stack, ...metadata }) => {
  let log = `${timestamp} [${context || 'App'}] ${level}: ${message}`;
  // Include stack trace for errors if available
  if (stack) {
    log += `\n${stack}`;
  }
  // Include metadata if any exists
  const meta = Object.keys(metadata).length ? JSON.stringify(metadata, null, 2) : '';
  if (meta && meta !== '{}') {
    // Avoid printing empty metadata objects
    log += ` ${meta}`;
  }
  return log;
});

// Custom format for file logging
const fileFormat = combine(
  timestamp(),
  errors({ stack: true }), // Log stack traces
  json() // Log in JSON format
);

const logger = winston.createLogger({
  level: config.logLevel || 'info', // Restore using config level
  format: combine(
    timestamp({ format: 'YYYY-MM-DDTHH:mm:ss.SSSZ' }), // ISO 8601 format
    errors({ stack: true }) // Ensure errors format includes stack trace
  ),
  transports: [
    // Console Transport
    new winston.transports.Console({
      format: combine(
        colorize(), // Add colors to console output
        consoleFormat // Use the custom console format
      ),
      handleExceptions: true, // Log uncaught exceptions
      handleRejections: true, // Log unhandled promise rejections
    }),
    // File Transport - All Logs
    new winston.transports.File({
      filename: path.join(logsDir, 'combined.log'),
      format: fileFormat, // Use JSON format for files
      maxsize: 5242880, // 5MB
      maxFiles: 5,
      tailable: true,
      handleExceptions: true,
      handleRejections: true,
    }),
    // File Transport - Error Logs
    new winston.transports.File({
      level: 'error',
      filename: path.join(logsDir, 'error.log'),
      format: fileFormat, // Use JSON format for error file
      maxsize: 5242880, // 5MB
      maxFiles: 3,
      tailable: true,
      handleExceptions: true,
      handleRejections: true,
    }),
  ],
  exitOnError: false, // Do not exit on handled exceptions
});

/**
 * Creates a child logger with a specific context label.
 * @param context - The context label (e.g., 'AstParser', 'Neo4jClient').
 * @returns A child logger instance.
 */
export const createContextLogger = (context: string): winston.Logger => {
  // Ensure child logger inherits the level set on the parent
  return logger.child({ context });
};

// Export the main logger instance if needed directly
export default logger;