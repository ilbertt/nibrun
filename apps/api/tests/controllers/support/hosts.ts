import { spyOn } from 'bun:test';
import { HostIdSchema } from '@repo/protocol';
import { Value } from '@sinclair/typebox/value';
import { AgentSessions } from '#lib/agent/sessions.ts';
import { AgentRepository } from '#repositories/agent.repository.ts';

export function stubHostRegistration(): void {
  const sessions = new AgentSessions();
  spyOn(AgentRepository.prototype, 'registerHost').mockImplementation(function registerHost() {
    return Promise.resolve(Value.Parse(HostIdSchema, Bun.randomUUIDv7()));
  });
  spyOn(AgentRepository.prototype, 'saveSession').mockImplementation(function saveSession(input) {
    sessions.open(input);
    return Promise.resolve(true);
  });
  spyOn(AgentRepository.prototype, 'hostForSession').mockImplementation(function hostForSession({
    sessionToken,
  }) {
    return Promise.resolve(sessions.hostFor({ sessionToken, now: new Date() }));
  });
}
