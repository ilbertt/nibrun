export function Hero() {
  return (
    <div className="flex flex-col items-center gap-4 text-center">
      <h1 className="text-balance font-semibold text-4xl tracking-tight sm:text-5xl">
        Drop a binary. Get a server.
      </h1>
      <p className="text-balance text-lg text-muted-foreground">
        No Dockerfile. No YAML. No cluster. Just your binary, a microVM, and a disk that remembers.
      </p>
    </div>
  );
}
