type Level = "debug" | "info" | "warn" | "error";

const LEVEL_RANK: Record<Level, number> = { debug: 0, info: 1, warn: 2, error: 3 };

const envLevel = (process.env.EXPO_PUBLIC_LOG_LEVEL as Level | undefined) ?? "info";
const ACTIVE_RANK = LEVEL_RANK[envLevel] ?? LEVEL_RANK.info;

/**
 * Mirrors the server's tag-based logger ([Tag] prefix).
 * Uses console.* directly — RN's Flipper / Metro logs forward these.
 */
export class Logger {
  constructor(private readonly tag: string) {}

  debug(...args: unknown[]): void {
    if (ACTIVE_RANK <= LEVEL_RANK.debug) console.log(`[${this.tag}]`, ...args);
  }

  info(...args: unknown[]): void {
    if (ACTIVE_RANK <= LEVEL_RANK.info) console.log(`[${this.tag}]`, ...args);
  }

  warn(...args: unknown[]): void {
    if (ACTIVE_RANK <= LEVEL_RANK.warn) console.warn(`[${this.tag}]`, ...args);
  }

  error(...args: unknown[]): void {
    if (ACTIVE_RANK <= LEVEL_RANK.error) console.error(`[${this.tag}]`, ...args);
  }
}
