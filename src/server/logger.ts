/**
 * Simple logger for server-side error tracking.
 * In production, consider using winston or pino for structured logging.
 */

type LogLevel = 'error' | 'warn' | 'info' | 'debug';

const LOG_LEVELS: Record<LogLevel, number> = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
};

const currentLevel: LogLevel = (process.env.LOG_LEVEL as LogLevel) || 
  (process.env.NODE_ENV === 'production' ? 'info' : 'debug');

function formatMessage(level: LogLevel, context: string, message: string, err?: unknown): string {
  const timestamp = new Date().toISOString();
  const prefix = `[${timestamp}] [${level.toUpperCase()}] [${context}]`;
  
  if (err instanceof Error) {
    return `${prefix} ${message}: ${err.message}\nStack: ${err.stack}`;
  }
  if (err) {
    return `${prefix} ${message}: ${JSON.stringify(err)}`;
  }
  return `${prefix} ${message}`;
}

export const logger = {
  error: (context: string, message: string, err?: unknown) => {
    if (LOG_LEVELS.error <= LOG_LEVELS[currentLevel]) {
      console.error(formatMessage('error', context, message, err));
    }
  },
  
  warn: (context: string, message: string, err?: unknown) => {
    if (LOG_LEVELS.warn <= LOG_LEVELS[currentLevel]) {
      console.warn(formatMessage('warn', context, message, err));
    }
  },
  
  info: (context: string, message: string) => {
    if (LOG_LEVELS.info <= LOG_LEVELS[currentLevel]) {
      console.info(formatMessage('info', context, message));
    }
  },
  
  debug: (context: string, message: string) => {
    if (LOG_LEVELS.debug <= LOG_LEVELS[currentLevel]) {
      console.debug(formatMessage('debug', context, message));
    }
  },
};
