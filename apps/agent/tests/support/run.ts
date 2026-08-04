import { FileSystem } from '@effect/platform';
import { BunContext } from '@effect/platform-bun';
import { Effect, Layer, type Scope } from 'effect';

export const platform = BunContext.layer;

/**
 * The one `Effect.runPromise` a test performs, inside one scope: a temp directory, a listening
 * server or a log receiver is released when the test ends rather than in an `afterEach`.
 */
export function provided<R, LayerError>(layer: Layer.Layer<R, LayerError>) {
  return function run<A, E>(effect: Effect.Effect<A, E, R | Scope.Scope>) {
    return Effect.runPromise(Effect.provide(Effect.scoped(effect), layer));
  };
}

export const runScoped = provided(Layer.empty);

export const temporaryDirectory = Effect.flatMap(FileSystem.FileSystem, (fs) =>
  fs.makeTempDirectoryScoped({ prefix: 'nibrun-test-' }),
);
