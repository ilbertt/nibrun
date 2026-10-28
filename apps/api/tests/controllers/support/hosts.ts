import { spyOn } from 'bun:test';
import { HostIdSchema } from '@repo/protocol';
import { Value } from '@sinclair/typebox/value';
import { AgentRepository } from '#repositories/agent.repository.ts';

export function stubHostRegistration(): void {
  spyOn(AgentRepository.prototype, 'registerHost').mockImplementation(function registerHost() {
    return Promise.resolve(Value.Parse(HostIdSchema, Bun.randomUUIDv7()));
  });
}
