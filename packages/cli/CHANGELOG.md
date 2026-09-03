# Changelog

All notable changes to `nib` are documented in this file.

## [2026.9.3-1]

### ⚡ Performance

- *(protocol)* A host asks for its desired state four times a second (#458)

## [2026.8.31-3]

### 🚀 Features

- *(api)* A new app waits for its first request (#424)
- *(api)* An owner can see how their app comes up (#422)

### 🚜 Refactor

- *(app-operations)* An app between requests is idle, in that word (#423)

## [2026.8.31-2]

### 🚀 Features

- *(cli)* A command answers with a typed value, and --json prints it (#419)
- *(cli)* Nib upgrade runs the install against the nib that ran it (#415)
- *(agent)* An app can wait for a request instead of running (#390)

## [2026.8.31-1]

### 🚀 Features

- *(www)* Sharkord is a deploy the app already knows how to configure (#384)
- A deploy link may say what the binary should hash to (#382)
- *(cli)* Nib apps status says how much of the machine an app is using (#371)

### 🚜 Refactor

- Tests sit beside src, never inside it (#396)
- *(protocol)* The default volume size moves next to the volume it sizes (#380)

## [2026.8.29-1]

### 🚀 Features

- An app says what cpu and memory it is spending (#364)
- An app says how much of its volume it is using (#333)
- *(cli)* A release publishes its checksums, and the install checks against them (#360)

## [2026.8.28-2]

### 🚀 Features

- *(cli)* Nib run takes a url where it takes a path (#349)
- *(api)* A binary may be fetched from a url instead of uploaded (#347)
- An owner sees where their app answers on its own port (#340)

### 🐛 Bug Fixes

- *(cli,dashboard)* A settling release is said in the app's terms, not the guest's (#353)

### ⚙️ Miscellaneous Tasks

- Cap cognitive complexity and enforce api layering with Biome (#343)

## [2026.8.28-1]

### 🚀 Features

- *(cli,dashboard)* An owner may ask for the extra public port (#332)
- *(api)* A value may name the public port an app has, not one it has not (#330)
- An app may ask for a public port besides HTTP, and is forwarded it (#328)
- *(runtime)* A guest is told the address and extra port it is reached at (#323)
- A value may only name a runtime one the guest offers (#320)
- *(runtime)* The guest names the directory its volume is mounted at (#319)

### 🚜 Refactor

- [**breaking**] A release that is serving is running, not active (#331)
- *(runtime)* [**breaking**] The port a tenant is handed is spelled one way (#321)
- [**breaking**] An app config carries an httpPort, not a guestPort (#317)
- The port a binary listens on is called its HTTP port (#316)

## [2026.8.27-2]

### 🚀 Features

- *(runtime)* A tenant value can name a runtime one (#306)
- *(dashboard)* The files tab asks the same table every other surface does (#305)
- *(cli)* One table decides what an app's state lets a command do (#303)

### 🐛 Bug Fixes

- A suspended app is not offered a release that would never start (#301)

### 🚜 Refactor

- What an app is doing is read the same way on both surfaces (#302)

## [2026.8.27-1]

### 🚀 Features

- *(app-operations)* A failed app's files say so rather than asking a host (#285)
- *(cli)* Nib apps update changes how an app starts, not its binary (#277)
- *(app-operations)* A release can reuse the binary the app already runs (#276)
- *(cli)* The installer says which of the two things it is doing (#267)

## [2026.8.25-1]

### 🚀 Features

- *(api)* Nibrun sizes the machine, not the owner (#261)
- *(protocol)* An app starts at 256 MiB rather than 512 (#259)
- *(agent,api)* The export bundle carries the variables the app was deployed with (#258)
- *(api,dashboard)* A suspended app says so once the microVM is down (#249)

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

