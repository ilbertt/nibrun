import { defineCommand } from '@parshjs/core';
import { z } from 'zod';
import { SHARED_OPTIONS } from '#config.ts';
import { parseCommandLine } from '#lib/command-line.ts';
import { requireSignedIn } from '#lib/credentials.ts';
import { binaryFrom, deploy } from '#lib/deploy.ts';
import { createOutput } from '#lib/output.ts';
import { completeOptions } from '#lib/plan.ts';
import { RELEASE_OUTPUT } from '#lib/release.ts';

export const command = defineCommand('run [command]', {
  description:
    'Deploy a compiled binary and run it, from this machine or from an https url nibrun fetches it at. Quote the binary with its arguments to pass them on: nib run "./my-server serve --port 8080".',
  params: {
    command: { schema: z.string().min(1) },
  },
  options: {
    [SHARED_OPTIONS.app.name]: {
      ...SHARED_OPTIONS.app.option,
      description: 'Slug of an existing app to deploy onto. Asked for when omitted.',
    },
    name: {
      schema: z.string().optional(),
      description: 'Name for the new app. Defaults to the binary filename.',
    },
    sha256: {
      schema: z.string().optional(),
      description:
        'What the file at the url should hash to, as its release publishes it — for an archive, the archive rather than the executable inside it. nibrun refuses a download that hashes to anything else. Only for a url: a file on this machine is not fetched.',
    },
    [SHARED_OPTIONS.port.name]: SHARED_OPTIONS.port.option,
    [SHARED_OPTIONS.extraPublicPort.name]: SHARED_OPTIONS.extraPublicPort.option,
    [SHARED_OPTIONS.env.name]: SHARED_OPTIONS.env.option,
    [SHARED_OPTIONS.unset.name]: SHARED_OPTIONS.unset.option,
    [SHARED_OPTIONS.detach.name]: SHARED_OPTIONS.detach.option,
  },
  beforeHandler: ({ context }) => requireSignedIn(context),
  handler: async ({ params, options, context, print, rootOptions }) => {
    // parsh names an option as it is typed, so a flag with hyphens in it does not arrive under the
    // name the deploy takes and has to be renamed rather than spread through.
    const {
      detach,
      sha256,
      [SHARED_OPTIONS.extraPublicPort.name]: extraPublicPort,
      ...flags
    } = options;
    const given = { ...flags, extraPublicPort };
    const { binarySource, args } = parseCommandLine(params.command);
    const { api } = context;

    const { interactive, ui, emit } = createOutput({
      output: RELEASE_OUTPUT,
      print,
      json: rootOptions.json,
    });

    // Before anything is asked, so a path nobody can read costs one line rather than a
    // questionnaire whose answers are then thrown away. A url is not opened here at all: the api
    // is the end that fetches it, and it is the end that says whether it could.
    const binary = await binaryFrom({ source: binarySource, sha256 });
    ui.open('nib run');

    const resolved = interactive
      ? await completeOptions({ api, options: given, binarySource, args })
      : given;

    emit(await deploy({ ...resolved, api, ui, binary, args, detach }));
  },
});
