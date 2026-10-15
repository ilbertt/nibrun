import { useLocation } from '@tanstack/react-router';

export function useOAuthQuery(): string {
  // The router serializes repeated parameters as JSON arrays, invalidating Better Auth's signature.
  return useLocation({ select: () => window.location.search });
}
