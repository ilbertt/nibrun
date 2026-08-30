import type { CallToolResult, McpServer } from '@modelcontextprotocol/server';
import type { OwnerId } from '@repo/protocol';
import { z } from 'zod';
import type { McpServices } from '#lib/mcp/services.ts';

/** What every tool file is handed: the server to register on, and who it is acting for. */
export type ToolRegistration = {
  server: McpServer;
  services: McpServices;
  /**
   * Whoever the request authenticated as. Every service call takes it and scopes on it, exactly as
   * a controller does — a tool has no reach of its own beyond the caller carrying it.
   */
  ownerId: OwnerId;
};

const JSON_INDENT = 2;

/**
 * The app a tool acts on. Slugs rather than ids everywhere, because the slug is the half a person
 * says out loud and so the half a model reads back out of a listing — the same reason the CLI
 * takes one.
 */
export const AppSlugSchema = z
  .string()
  .describe('Slug of the app, as `list_apps` reports it under `slug`.');

/**
 * What became of the app, for the tools that change what it is doing rather than what it runs.
 * `detail` is the sentence a reader gets; `state` is the same answer for something acting on it.
 */
export const AppTransitionResultSchema = z.object({
  slug: z.string(),
  state: z.string(),
  detail: z.string(),
});

/**
 * A tool's answer, including the ones that are refusals.
 *
 * An operation the app's state has an answer for is refused with that answer — "App foo is
 * suspended, so a new release would never start. Resume it first." A model is the reader here, and
 * a sentence telling it what to do instead is worth more than a protocol error it never sees, so
 * anything thrown comes back as a result flagged `isError` rather than as a failed request.
 *
 * The structured half is what a model should act on; the text half is the same value, because a
 * client that ignores `structuredContent` would otherwise be handed a tool that answers nothing.
 */
export async function answered<Structured extends Record<string, unknown>>({
  produce,
}: {
  produce: () => Promise<Structured>;
}): Promise<CallToolResult> {
  try {
    const structuredContent = await produce();
    return {
      content: [{ type: 'text', text: JSON.stringify(structuredContent, null, JSON_INDENT) }],
      structuredContent,
    };
  } catch (failure) {
    return {
      content: [{ type: 'text', text: refusal(failure) }],
      isError: true,
    };
  }
}

function refusal(failure: unknown): string {
  return failure instanceof Error ? failure.message : String(failure);
}
