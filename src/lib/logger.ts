// ── Structured Logger ──────────────────────────────────────────────────────

import { getConfig } from "./config.js"

const PREFIX = "[mind-forge]"

export function debug(msg: string, ...args: unknown[]): void {
  if (getConfig().logLevel === "debug") console.debug(PREFIX, msg, ...args)
}

export function info(msg: string, ...args: unknown[]): void {
  if (["debug", "info"].includes(getConfig().logLevel)) console.info(PREFIX, msg, ...args)
}

export function warn(msg: string, ...args: unknown[]): void {
  if (["debug", "info", "warn"].includes(getConfig().logLevel)) console.warn(PREFIX, msg, ...args)
}

export function error(msg: string, ...args: unknown[]): void {
  console.error(PREFIX, msg, ...args)
}
