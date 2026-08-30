import type { CallToolResult, McpServer } from '@modelcontextprotocol/server';
import type { PublicApiClient } from '@repo/api-client/public';
import { z } from 'zod';

/** What every tool file is handed: the server to register on, and the api to act through. */
export type ToolRegistration = {
  server: McpServer;
  api: PublicApiClient;
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
 * A tool's answer, including the ones that are refusals.
 *
 * `@repo/app-operations` refuses an operation the app's state has an answer for by throwing that
 * answer — "App foo is suspended, so a new release would never start. Resume it first." A model is
 * the reader here, and a sentence telling it what to do instead is worth more than a protocol
 * error it never sees, so anything thrown comes back as a result flagged `isError` rather than as
 * a failed request.
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
