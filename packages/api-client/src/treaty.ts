import type { Treaty } from '@elysiajs/eden';

// Eden revives anything ISO-8601-shaped into a Date on the way in. Timestamps are strings
// everywhere the api declares them, so leaving that on hands a caller a value that disagrees
// with the type it was just given, and every schema that revalidates one rejects it.
export const TREATY_DEFAULTS = { parseDate: false } as const satisfies Treaty.Config;
