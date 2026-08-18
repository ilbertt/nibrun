import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@repo/ui/components/card';
import { cn } from '@repo/ui/lib/utils';
import type { ReactNode } from 'react';

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
