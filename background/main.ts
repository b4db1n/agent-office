import { connectHost } from '@openchamber/sdk';

const host = connectHost();
host.onAction(async (item) => {
  if (item.kind !== 'message' || item.action !== 'dispatch' || item.role !== 'user' || !item.directory) {
    throw new Error('Choose Ask Office lead on a user message in a project.');
  }
  const response = await host.serviceRequest({
    method: 'POST', path: '/dispatch',
    body: JSON.stringify({
      directory: item.directory,
      prompt: item.text,
      origin: { sessionId: item.sessionId, messageId: item.messageId },
    }),
  });
  const result = JSON.parse(response.body);
  if (response.status >= 400 || !result.sessionId) throw new Error(result.message || 'Dispatch did not return a lead session.');
  try {
    await host.openSession(result.sessionId);
  } catch {
    // The host already accepted the work. Do not suggest retrying just because navigation failed.
    await host.toast({ kind: 'info', message: 'Task sent to the Office lead. Open the new session from the session list.' }).catch(() => undefined);
  }
});
