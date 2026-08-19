# Contributing to nibrun

## Development setup

```bash
git clone https://github.com/ilbertt/nibrun.git
cd nibrun
bun install
bun run build
```

## Tooling

- [Bun](https://bun.sh) — runtime, package manager, bundler
- [Docker](https://docs.docker.com/get-started/get-docker/) — runs the stack
- [Turborepo](https://turborepo.dev/) — task orchestration with caching
- [Biome](https://biomejs.dev/) — linter and formatter
- [commitlint](https://commitlint.js.org/) — conventional commit enforcement
- [TypeScript](https://www.typescriptlang.org/) — shared config via `@repo/typescript-config`

## Commit messages

We use [Conventional Commits](https://www.conventionalcommits.org/) for commit messages to the main branch. Make sure your PR title is in the correct format.
