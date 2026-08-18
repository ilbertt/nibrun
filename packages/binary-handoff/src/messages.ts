/**
 * The landing page and the app are different origins, so a binary dropped on the former
 * reaches the latter only by being posted into a frame the app itself serves. These are the
 * messages that crossing is made of.
 *
 * Plain types and guards rather than schemas: the offer carries a `File`, which survives a
 * structured clone but has no JSON form for a schema to describe. The guards are what makes a
 * message trustworthy, and the sender's origin is what makes it worth reading at all; both
 * sides check both, and neither ever posts to `*`.
 */

// Where the app serves the receiving frame. Shared so the two sides cannot disagree about it.
export const HANDOFF_FRAME_PATH = '/deploy';

export const HANDOFF_READY = 'handoff-ready';
export const HANDOFF_OFFER = 'handoff-offer';
export const HANDOFF_STORED = 'handoff-stored';

/** The frame has mounted and is listening. Sent to the parent. */
export type HandoffReady = { kind: typeof HANDOFF_READY };

/** The binary itself. Sent to the frame. */
export type HandoffOffer = { kind: typeof HANDOFF_OFFER; binary: File };

/** The binary is in the app's own storage and the parent may navigate. Sent to the parent. */
export type HandoffStored = { kind: typeof HANDOFF_STORED };

function hasKind({ value, kind }: { value: unknown; kind: string }): boolean {
  return typeof value === 'object' && value !== null && (value as { kind?: unknown }).kind === kind;
}

export function isHandoffReady(value: unknown): value is HandoffReady {
  return hasKind({ value, kind: HANDOFF_READY });
}

export function isHandoffStored(value: unknown): value is HandoffStored {
  return hasKind({ value, kind: HANDOFF_STORED });
}

export function isHandoffOffer(value: unknown): value is HandoffOffer {
  return hasKind({ value, kind: HANDOFF_OFFER }) && (value as HandoffOffer).binary instanceof File;
}
