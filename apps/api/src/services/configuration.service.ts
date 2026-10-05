import {
  DEFAULT_HTTP_PORT,
  DEFAULT_INSTANCE_RESOURCES,
  DEFAULT_VOLUME_SIZE_BYTES,
} from '#lib/app-config-defaults.ts';
import { EXTRA_PUBLIC_PORT_VALUES, RUNTIME_VALUES } from '#lib/runtime-values.ts';
import { Service } from '#services/service.ts';

export class ConfigurationService extends Service {
  get() {
    return {
      appDefaults: {
        httpPort: DEFAULT_HTTP_PORT,
        resources: DEFAULT_INSTANCE_RESOURCES,
        volumeSizeBytes: DEFAULT_VOLUME_SIZE_BYTES,
      },
      runtimeValues: Object.values(RUNTIME_VALUES).map((value) => ({
        ...value,
        requiresExtraPublicPort: EXTRA_PUBLIC_PORT_VALUES.some(
          (portValue) => portValue.name === value.name,
        ),
      })),
    };
  }
}
