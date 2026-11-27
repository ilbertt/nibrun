import { Button } from '@repo/ui/components/button';
import { Link, useLocation } from '@tanstack/react-router';
import { Route as LoginRoute } from '#routes/(auth)/login.tsx';

export function KeepAppsButton({ size }: { size: 'sm' | 'lg' }) {
  const here = useLocation({ select: (location) => location.href });
  return (
    <Button
      variant={size === 'lg' ? 'default' : 'outline'}
      size={size}
      render={<Link to={LoginRoute.to} search={{ redirect: here, reason: 'keep-app' }} />}
    >
      Sign in to keep it
    </Button>
  );
}
