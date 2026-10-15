import { createHash } from 'node:crypto';
import { INVALID_PARAMS, type McpServer, ProtocolError } from '@modelcontextprotocol/server';
import { Type } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import { getSkills } from '#lib/assets.ts';
import { fromTypeBox } from '#lib/mcp/schema.ts';

const deployToNibrun = await getSkills().get('deploy-to-nibrun/SKILL.md')!.text();

const frontmatter = Value.Parse(
  Type.Object({ name: Type.String(), description: Type.String() }, { additionalProperties: true }),
  Bun.YAML.parse(deployToNibrun.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)![1]!),
);
const uri = `skill://nibrun/${frontmatter.name}/SKILL.md`;
const skill = {
  uri,
  frontmatter,
  resources: [
    {
      uri,
      digest: `sha256:${createHash('sha256').update(deployToNibrun).digest('hex')}`,
      size: Buffer.byteLength(deployToNibrun),
    },
  ],
};

const listParams = fromTypeBox(Type.Object({ cursor: Type.Optional(Type.String()) }));
const getParams = fromTypeBox(Type.Object({ uri: Type.String() }));

export function registerSkills({ server }: { server: McpServer }) {
  // SEP-2640 is not yet exposed by the SDK's high-level registration API.
  server.server.registerCapabilities({ extensions: { 'io.modelcontextprotocol/skills': {} } });
  server.server.setRequestHandler('skills/list', { params: listParams }, ({ cursor }) => {
    if (cursor !== undefined) {
      throw new ProtocolError(INVALID_PARAMS, 'Unknown skills cursor');
    }
    return { resultType: 'complete', skills: [skill], ttlMs: 0, cacheScope: 'public' };
  });
  server.server.setRequestHandler('skills/get', { params: getParams }, (params) => {
    if (params.uri !== uri) {
      throw new ProtocolError(INVALID_PARAMS, 'Unknown skill');
    }
    return { resultType: 'complete', skill };
  });
  server.registerResource(
    frontmatter.name,
    uri,
    { description: frontmatter.description, mimeType: 'text/markdown' },
    () => ({ contents: [{ uri, mimeType: 'text/markdown', text: deployToNibrun }] }),
  );
}
