import type { ID } from "./types";

export function createId(): ID {
  return crypto.randomUUID();
}