import { Elysia } from 'elysia';

export const WellKnownOpenAIAppsChallengeController = new Elysia().get(
  '/.well-known/openai-apps-challenge',
  new Response('eFTS9tBxSn1mZ58t6tXCn4CczpkDdy4Ml4CSe5rCYgE', {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  }),
  { detail: { hide: true } },
);
