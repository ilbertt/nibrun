import { createContext } from 'react';
import type { DeployRun } from '#lib/hooks/use-run-app.ts';

export const DeployRunContext = createContext<DeployRun | undefined>(undefined);
