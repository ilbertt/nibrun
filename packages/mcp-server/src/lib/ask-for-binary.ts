import {
  type CallToolResult,
  type InputRequiredResult,
  inputRequired,
} from '@modelcontextprotocol/server';
import { type DeployLink, deployHref } from '@repo/deploy-link';
import { z } from 'zod';

/** The other thing a deploy can answer: not a release, but where to go to make one. */
export const AskedForBinarySchema = z.object({
  deployUrl: z.string(),
  detail: z.string(),
});

/**
 * The key the elicitation is filed under, and so the key its answer comes back under.
 *
 * One request means one key; it exists to tell a first call apart from the retry that follows the
 * caller having opened the page, which is what keeps this from asking a second time.
 */
const BINARY_REQUEST = 'binary';

const OPEN_IT =
  'Open this to pick the binary. Everything worked out so far is already filled in; the app is created when it is submitted.';

const ALREADY_OFFERED =
  'The deploy screen has it from here. Check `list_apps` once it has been submitted — the app appears under the name given there.';

export type BinaryRequest = {
  origin: string;
  era: 'legacy' | 'modern';
  /**
   * What a retry carried back, as the request hands it over: values from the client, and so only
   * ever read for whether a key is there at all.
   */
  responses: Record<string, unknown> | undefined;
  link: DeployLink;
};

/**
 * Ask the caller for a binary this end cannot reach.
 *
 * Tool arguments are written by a model rather than read off a disk, and this server runs beside
 * the api rather than beside the caller — so there is no path it could be handed and no bytes it
 * could be sent. What it can do is hand back the deploy screen with every field it did work out
 * already filled, and let the one thing only the caller has come from the caller's own machine.
 */
export function askForBinary({
  origin,
  era,
  responses,
  link,
}: BinaryRequest): CallToolResult | InputRequiredResult {
  const url = deployHref({ origin, link });

  // Asked once. A retry arrives after the caller has been sent to the page, and asking again
  // there is a loop rather than a question.
  if (responses?.[BINARY_REQUEST] !== undefined) {
    return said({ url, detail: ALREADY_OFFERED });
  }

  // The 2025 wire has no shape for a request that pauses for the caller, so on that era the link
  // is the whole answer and the client shows it as an ordinary result.
  if (era === 'legacy') {
    return said({ url, detail: OPEN_IT });
  }

  return inputRequired({
    inputRequests: { [BINARY_REQUEST]: inputRequired.elicitUrl({ message: OPEN_IT, url }) },
  });
}

function said({ url, detail }: { url: string; detail: string }): CallToolResult {
  const structuredContent = { deployUrl: url, detail };
  return {
    content: [{ type: 'text', text: `${detail}\n\n${url}` }],
    structuredContent,
  };
}
