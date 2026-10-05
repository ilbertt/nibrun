import type { AppId, DeploymentId, GuestPath, OwnerId } from '@repo/protocol';
import { NotFoundError, TooManyRequestsError } from '#lib/errors.ts';

const SELECTION_LIFETIME_MS = 3_600_000;
const MAX_SELECTIONS = 1024;
const MAX_SELECTIONS_PER_OWNER = 16;

export type SqliteSelection = {
  id: string;
  appId: AppId;
  deploymentId: DeploymentId;
  ownerId: OwnerId;
  path: GuestPath;
  expiresAt: number;
};

export class SqliteSelections {
  readonly #selections = new Map<string, SqliteSelection>();

  create({
    nowMs,
    ...input
  }: Omit<SqliteSelection, 'id' | 'expiresAt'> & { nowMs: number }): SqliteSelection {
    this.#expire(nowMs);
    let owned = 0;
    for (const selection of this.#selections.values()) {
      if (selection.ownerId === input.ownerId) {
        owned += 1;
      }
    }
    if (owned >= MAX_SELECTIONS_PER_OWNER || this.#selections.size >= MAX_SELECTIONS) {
      throw new TooManyRequestsError(
        'Too many databases are selected. Close a selection before opening another.',
      );
    }
    const selection = {
      ...input,
      id: crypto.randomUUID(),
      expiresAt: nowMs + SELECTION_LIFETIME_MS,
    };
    this.#selections.set(selection.id, selection);
    return selection;
  }

  get({ id, ownerId, nowMs }: { id: string; ownerId: OwnerId; nowMs: number }): SqliteSelection {
    this.#expire(nowMs);
    const selection = this.#selections.get(id);
    if (!selection || selection.ownerId !== ownerId) {
      throw new NotFoundError('Database selection not found.');
    }
    return selection;
  }

  remove({ id, ownerId, nowMs }: { id: string; ownerId: OwnerId; nowMs: number }): SqliteSelection {
    const selection = this.get({ id, ownerId, nowMs });
    this.#selections.delete(id);
    return selection;
  }

  #expire(nowMs: number): void {
    for (const [id, selection] of this.#selections) {
      if (selection.expiresAt <= nowMs) {
        this.#selections.delete(id);
      }
    }
  }
}
