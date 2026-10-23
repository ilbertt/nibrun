import { Elysia } from 'elysia';

const OPENAI_CHALLENGE_TOKEN = 'eFTS9tBxSn1mZ58t6tXCn4CczpkDdy4Ml4CSe5rCYgE';

export const WellKnownOpenAIAppsChallengeController = new Elysia().get(
  '/.well-known/openai-apps-challenge',
  new Response(OPENAI_CHALLENGE_TOKEN, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  }),
  { detail: { hide: true } },
);
