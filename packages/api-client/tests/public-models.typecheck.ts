import type {
  App,
  AppPatch,
  CronListing,
  Filename,
  GuestPath,
  RuntimeValueName,
  TenantEnvironmentPatch,
} from '#models.ts';
import type { PublicApiClient } from '#public.ts';

type Assert<Condition extends true> = Condition;
type Equal<Left, Right> = [Left] extends [Right] ? ([Right] extends [Left] ? true : false) : false;
type CreateApp = Parameters<PublicApiClient['api']['apps']['post']>[0];
type CreateConfig = NonNullable<CreateApp['config']>;

export type PublicModelAssertions = [
  Assert<Equal<TenantEnvironmentPatch, Record<string, string | null>>>,
  Assert<Equal<NonNullable<CreateConfig['environment']>, Record<string, string>>>,
  Assert<Equal<NonNullable<CronListing['jobs'][number]['environment']>, Record<string, string>>>,
  Assert<Equal<NonNullable<AppPatch['httpPort']>, number>>,
  Assert<Equal<CreateApp['name'], string>>,
  Assert<Equal<Filename, string>>,
  Assert<Equal<GuestPath, string>>,
  Assert<Equal<App['createdAt'], string>>,
  Assert<'unknown' extends App['state'] ? false : true>,
  Assert<'NIBRUN_UNKNOWN' extends RuntimeValueName ? false : true>,
];
