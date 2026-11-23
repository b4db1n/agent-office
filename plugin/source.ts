import { dispatch } from '../shared/dispatch.mjs';

// The built entry (plugin/index.js) imports nothing: the bun build inlines this
// module and dispatch, so OpenCode can load the folder with a bare import.
const COMMAND = 'office';

export default {
  id: 'agent-office',
  async setup(ctx) {
    const commands = await ctx.command.list();
    if ((commands.data ?? commands).some((command) => command.name === COMMAND)) return;

    await ctx.command.transform((editor) => {
      editor.add({
        name: COMMAND,
        description: 'Send a task to the selected Agent Office lead in a new root session',
        execute: async ({ sessionID, prompt }) => {
          const text = prompt.text?.trim();
          if (!text) throw new Error('Type /office followed by a task.');

          // dispatch is the API-equivalent path already used by the panel action:
          // it selects the configured lead/model, creates a new root session in
          // this location, and sends the task there. It never targets the calling
          // session, so the task does not land back in the current chat.
          const result = await dispatch(ctx.location.directory, text);

          // Surface a followable outcome in the invoking chat WITHOUT turning it
          // into a prompt. A synthetic message with resume:false is recorded in the
          // transcript but is not scheduled for execution, so no model sees it.
          const lines = [
            'Agent Office: task sent to a new root session.',
            `Session ID: ${result.sessionId}`,
          ];
          if (result.lead) lines.push(`Lead: ${result.lead}`);
          if (result.leadModel) lines.push(`Model: ${result.leadModel}`);
          lines.push('Open it from the Agent Office panel or the session list.');

          await ctx.session.synthetic({
            sessionID,
            text: lines.join('\n'),
            resume: false,
          });
        },
      });
    });
  },
};
