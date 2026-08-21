# Changelog

All notable changes to `nib` are documented in this file.

## [2026.8.21-1]

### 🚀 Features

- *(api,cli,dashboard)* An app can be suspended and resumed (#246)

## [2026.8.20-2]

### 🚀 Features

- *(dashboard)* A new app's environment can come from a .env file (#233)
- *(api,cli)* An environment patch edits the variables it names, and only those (#231)
- *(cli,dashboard)* An app is addressed by the domain its owner brought (#230)

### ⚙️ Miscellaneous Tasks

- Bun 1.4 ships what the build was pulling a canary for (#238)

## [2026.8.20-1]

### 🚀 Features

- *(api)* A deployment says what happened to it (#220)
- *(cli,dashboard)* An owner adds a domain and is handed the records to place (#199)
- *(api)* A hostname is routed once it has earned it, not once it is asked for (#197)
- *(cli)* An installer that puts nib on a machine (#213)
- *(cli)* Nib says which version of itself it is (#211)
- *(cli)* One binary per platform a release ships to (#205)
- An app runs with the environment its owner set (#196)
- *(agent)* An export reads a checkpoint, so a tenant is frozen only for the cut (#176)
- *(dashboard)* The dashboard is drawn in the sketchpad theme (#172)
- An upload says how far along it is (#171)
- A binary reaches the store without passing through the api (#150)
- *(app-operations)* The flows the cli and the dashboard both drive (#148)
- *(cli)* An owner reads what apps they have and what state each is in (#134)
- *(cli)* An owner who named no app is asked which one (#133)
- *(cli)* An owner deletes their app from their terminal (#127)
- *(cli)* An owner lists their app's filesystem from their terminal (#124)
- *(cli)* An owner downloads a copy of their app from their terminal (#123)
- An owner follows their app's output from their terminal (#122)
- A terminal is signed in by the browser that already is (#119)
- *(cli)* An owner runs a binary from their terminal (#115)
- *(api)* A host is told what to run, and its report moves the release (#109)
- *(api)* Deployments (#69)
- *(api)* Artifacts (#68)
- *(api)* Apps and their hostnames (#67)
- *(api)* Derive a frozen platform hostname from an app name (#66)
- *(api)* The api asks a host for a directory and logs the answer (#97)
- *(protocol)* A directory listing has a shape (#95)
- *(logs)* The agent writes tenant output to the store, not the api (#85)
- *(logs)* Stream tenant output from microvms (#59)
- *(protocol)* An artifact carries the name it was uploaded under (#54)
- *(runtime)* Let a tenant binary take arguments (#37)
- *(infra)* Give agents a private path to the api (#31)
- *(protocol)* Add the control plane / agent contract (#12)
- Api client

### 🐛 Bug Fixes

- *(cli)* Deleting an app says everything that goes with it (#137)
- Every line an app writes in one millisecond reaches the reader (#131)
- An exported app arrives whole and ready to run (#130)
- *(api)* An app is created with the arguments it was given (#120)
- *(api)* Deleting an app reclaims the filesystem it was using (#111)
- *(protocol)* An export names the binary it packages (#105)

### 🚜 Refactor

- *(app-operations)* Deleting an app is the same request from either surface (#158)
- *(app-operations)* An export is asked for and waited on the same way (#157)
- *(app-operations)* Deploying an app is one sequence wherever it starts (#156)
- *(api-client)* Move uwrap to api client (#147)
- *(cli)* Listing inside an app is spelled apps files ls (#138)
- *(cli)* An owner names an app the same way wherever they name one (#126)
- *(api)* A path segment is a string until a handler parses it (#117)
- A branded type is parsed into rather than asserted (#116)
- The api client carries one surface, and the agent uses it (#71)
- *(protocol)* The protocol says only what it does (#62)
- The network is the boundary, not a shared secret (#56)
- *(protocol)* Let the host say where a volume went (#40)

### 📚 Documentation

- Cut the AGENTS.md files back to what the code cannot say (#29)

### ⚡ Performance

- A deploy is ready as soon as the tenant answers (#132)

### ⚙️ Miscellaneous Tasks

- *(cli)* The first dated release accounts for everything before it (#222)
- *(cli)* The CLI is versioned by the day it ships (#217)
- *(cli)* A release train of its own, cut from cli-v tags (#206)

