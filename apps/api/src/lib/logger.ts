const RESET = '\x1b[0m';
const LABEL_WIDTH = 5;

const LEVEL_STYLES = {
  debug: Bun.color('cyan', 'ansi'),
  info: Bun.color('green', 'ansi'),
  warn: Bun.color('yellow', 'ansi'),
  error: Bun.color('red', 'ansi'),
};

type LogLevel = keyof typeof LEVEL_STYLES;

function write({
  level,
  prefix,
  args,
}: {
  level: LogLevel;
  prefix: string;
  args: unknown[];
}): void {
  const ts = new Date().toISOString();
  const style = LEVEL_STYLES[level] ?? '';
  const label = level.toUpperCase().padEnd(LABEL_WIDTH);
  const tag = style ? `${style}${label}${RESET}` : label;
  const out = level === 'error' ? console.error : console.log;
  const head = prefix ? `${ts} ${tag} [${prefix}]` : `${ts} ${tag}`;
  out(head, ...args);
}

export function createLogger(prefix = '') {
  return {
    debug(...args: unknown[]) {
      write({ level: 'debug', prefix, args });
    },
    info(...args: unknown[]) {
      write({ level: 'info', prefix, args });
    },
    warn(...args: unknown[]) {
      write({ level: 'warn', prefix, args });
    },
    error(...args: unknown[]) {
      write({ level: 'error', prefix, args });
    },
  };
}
