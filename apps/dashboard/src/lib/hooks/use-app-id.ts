import { useParams } from '@tanstack/react-router';

export function useAppId(): string {
  return useParams({ from: '/(dashboard)/apps/$appId' }).appId;
}
