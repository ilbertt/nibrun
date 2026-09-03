import { GUEST_PATH_ROOT } from '@repo/protocol';
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@repo/ui/components/breadcrumb';
import { buttonVariants } from '@repo/ui/components/button';
import { Link } from '@tanstack/react-router';
import { FolderRootIcon } from 'lucide-react';
import { Fragment } from 'react';
import { useAppId } from '#lib/hooks/use-app-id.ts';
import { useDirectoryPath } from '#lib/hooks/use-directory-path.ts';
import { Route as FilesRoute } from '#routes/(dashboard)/apps/$appId/files.tsx';

const ROOT_LABEL = 'Root directory';

type PathStep = {
  name: string;
  path: string;
};

export function PathBreadcrumb() {
  const appId = useAppId();
  const path = useDirectoryPath();
  const steps = stepsOf(path);

  return (
    <Breadcrumb>
      <BreadcrumbList className="font-mono">
        <BreadcrumbItem>
          {steps.length === 0 ? (
            <BreadcrumbPage
              aria-label={ROOT_LABEL}
              className="flex size-7 items-center justify-center"
              title={ROOT_LABEL}
            >
              <FolderRootIcon className="size-4" />
            </BreadcrumbPage>
          ) : (
            <BreadcrumbLink
              className={buttonVariants({
                size: 'icon-sm',
                variant: 'ghost',
              })}
              render={
                <Link
                  aria-label={ROOT_LABEL}
                  params={{ appId }}
                  search={{ path: GUEST_PATH_ROOT }}
                  title={ROOT_LABEL}
                  to={FilesRoute.to}
                />
              }
            >
              <FolderRootIcon className="size-4" />
            </BreadcrumbLink>
          )}
        </BreadcrumbItem>
        {steps.map((step) => (
          <Fragment key={step.path}>
            <BreadcrumbSeparator>/</BreadcrumbSeparator>
            <BreadcrumbItem>
              {step.path === path ? (
                <BreadcrumbPage>{step.name}</BreadcrumbPage>
              ) : (
                <BreadcrumbLink
                  render={
                    <Link to={FilesRoute.to} params={{ appId }} search={{ path: step.path }} />
                  }
                >
                  {step.name}
                </BreadcrumbLink>
              )}
            </BreadcrumbItem>
          </Fragment>
        ))}
      </BreadcrumbList>
    </Breadcrumb>
  );
}

function stepsOf(path: string): PathStep[] {
  const names = path.split('/').filter(Boolean);
  const steps: PathStep[] = [];

  for (const name of names) {
    const parent = steps.at(-1);
    steps.push({ name, path: `${parent === undefined ? '' : parent.path}/${name}` });
  }

  return steps;
}
