import type { ReactNode } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '#components/ui/card.tsx';
import { cn } from '#lib/utils.ts';

export function DeviceCard({
  title,
  description,
  failed,
  children,
}: {
  title: string;
  description: string;
  failed?: boolean;
  children?: ReactNode;
}) {
  return (
    <Card>
      <CardHeader className="text-center">
        <CardTitle className="text-xl">{title}</CardTitle>
        <CardDescription className={cn(failed && 'text-destructive')}>
          {description}
        </CardDescription>
      </CardHeader>
      {children && <CardContent>{children}</CardContent>}
    </Card>
  );
}
