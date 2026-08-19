# Changelog

All notable changes to `nib` are documented in this file.

## [0.1.0] - 2026-08-19

### 🚀 Features

- *(cli)* One binary per platform a release ships to (#205)
- An app runs with the environment its owner set (#196)
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

### 🐛 Bug Fixes

- *(cli)* Deleting an app says everything that goes with it (#137)
- Every line an app writes in one millisecond reaches the reader (#131)
- An exported app arrives whole and ready to run (#130)
- *(api)* An app is created with the arguments it was given (#120)

### 🚜 Refactor

- *(app-operations)* Deleting an app is the same request from either surface (#158)
- *(app-operations)* An export is asked for and waited on the same way (#157)
- *(app-operations)* Deploying an app is one sequence wherever it starts (#156)
- *(api-client)* Move uwrap to api client (#147)
- *(cli)* Listing inside an app is spelled apps files ls (#138)
- *(cli)* An owner names an app the same way wherever they name one (#126)

### ⚡ Performance

- A deploy is ready as soon as the tenant answers (#132)

### ⚙️ Miscellaneous Tasks

- *(cli)* A release train of its own, cut from cli-v tags (#206)

