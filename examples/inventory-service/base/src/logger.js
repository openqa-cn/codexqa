const SILENT = process.env.LOG_LEVEL === 'silent';

/**
 * Minimal structured logger. The platform team ships the real one as
 * `@acme/telemetry`; this local shim keeps the service dependency-free.
 *
 * @param {string} scope module name that shows up in every line
 */
export function createLogger(scope) {
  const emit = (level, message, context) => {
    if (SILENT) return;
    const line = `[${level}] ${scope}: ${message}`;
    if (context === undefined) {
      console.log(line);
    } else {
      console.log(line, JSON.stringify(context));
    }
  };

  return {
    info: (message, context) => emit('info', message, context),
    warn: (message, context) => emit('warn', message, context),
    error: (message, context) => emit('error', message, context),
  };
}
