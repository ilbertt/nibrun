import { t } from 'elysia';

const MAX_DETAIL_LENGTH = 128;

const ComponentSchema = t.Object({
  status: t.Union([t.Literal('up'), t.Literal('down'), t.Literal('unknown')]),
  detail: t.Optional(t.String({ maxLength: MAX_DETAIL_LENGTH })),
});

/**
 * Named keys rather than a list: a reader renders one row per component and has to know which
 * row it is drawing, so the set being fixed is what lets it label them without a lookup that
 * can miss.
 */
export const GetHealthResponseSchema = t.Object({
  status: t.Union([t.Literal('healthy'), t.Literal('degraded')]),
  uptime: t.Number(),
  components: t.Object({
    database: ComponentSchema,
    logStore: ComponentSchema,
    objectStore: ComponentSchema,
    agent: ComponentSchema,
    appHost: ComponentSchema,
  }),
});
