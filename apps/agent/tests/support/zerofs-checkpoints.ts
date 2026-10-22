import { CHECKPOINT_ID } from '#tests/support/fixtures.ts';

export const EMPTY_CHECKPOINT_LIST = 'No checkpoints found.\n';
export const CHECKPOINT_TABLE = `┌───────┬──────────────────────────────────────┬─────────────────────┐
│ Name  ┆ ID                                   ┆ Created At          │
╞═══════╪══════════════════════════════════════╪═════════════════════╡
│ ${CHECKPOINT_ID} ┆ 01234567-89ab-cdef-0123-456789abcdef ┆ 2026-10-22 12:00:00 │
└───────┴──────────────────────────────────────┴─────────────────────┘
`;
