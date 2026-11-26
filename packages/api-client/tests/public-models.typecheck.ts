import type {
  App,
  AppPatch,
  CronListing,
  Filename,
  GuestPath,
  OwnedAppState,
  TenantEnvironmentPatch,
} from '#models.ts';
import type { PublicApiClient } from '#public.ts';

type Assert<Condition extends true> = Condition;
type Equal<Left, Right> = [Left] extends [Right] ? ([Right] extends [Left] ? true : false) : false;
type CreateApp = Parameters<PublicApiClient['api']['apps']['post']>[0];
type CreateConfig = NonNullable<CreateApp['config']>;
type PatchConfig = NonNullable<AppPatch['config']>;
type StorageInput = NonNullable<CreateConfig['volumeStorage']>;

export type PublicModelAssertions = [
  Assert<Equal<TenantEnvironmentPatch, Record<string, string | null>>>,
  Assert<Equal<NonNullable<CreateConfig['environment']>, Record<string, string>>>,
  Assert<Equal<NonNullable<CronListing['jobs'][number]['environment']>, Record<string, string>>>,
  Assert<Equal<NonNullable<NonNullable<AppPatch['config']>['httpPort']>, number>>,
  Assert<Equal<CreateConfig['access'], App['config']['access']>>,
  Assert<
    Equal<Exclude<PatchConfig, { volumeStorage: StorageInput }>['access'], App['config']['access']>
  >,
  Assert<Equal<NonNullable<PatchConfig['volumeStorage']>, StorageInput>>,
  Assert<{ volumeStorage: StorageInput } extends PatchConfig ? true : false>,
  Assert<'prefix' extends keyof StorageInput ? false : true>,
  Assert<Equal<CreateApp['name'], string>>,
  Assert<Equal<Filename, string>>,
  Assert<Equal<GuestPath, string>>,
  Assert<Equal<App['createdAt'], string>>,
  Assert<Equal<OwnedAppState, 'active' | 'suspended'>>,
  Assert<'unknown' extends App['state'] ? false : true>,
];
