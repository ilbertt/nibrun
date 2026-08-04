import type { ObjectKey } from '@repo/protocol';
import { Layer } from 'effect';
import { AgentConfig } from '#services/agent-config.service.ts';

export const HOST_STORAGE_PREFIX = 'filesystems/host-1' as ObjectKey;

/** `slotsFile` names a directory nothing creates: what a test persists never reaches a host. */
export const AGENT_CONFIG = {
  slotsFile: '/nonexistent/nibrun-test/slots.json',
  zerofsStoragePrefix: HOST_STORAGE_PREFIX,
  zerofsMount: '/mnt/zerofs',
  zerofsNbdSocket: '/run/zerofs/nbd.sock',
  zerofsBinary: '/opt/nibrun/bin/zerofs/zerofs',
  zerofsConfigFile: '/etc/zerofs/config.toml',
} as const;

export function agentConfig(overrides: Partial<AgentConfig> = {}) {
  return Layer.succeed(AgentConfig, { ...AGENT_CONFIG, ...overrides } as unknown as AgentConfig);
}
