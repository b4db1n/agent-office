import { connectHost } from '@openchamber/sdk';

const host = connectHost();
host.onAction(async (item) => {
  if (item.kind !== 'message' || item.action !== 'dispatch' || item.role !== 'user' || !item.directory) {
    throw new Error('Choose Ask Office lead on a user message in a project.');
  }
  const response = await host.serviceRequest({
    method: 'POST', path: '/dispatch',
    body: JSON.stringify({ directory: item.directory, prompt: item.text }),
  });
  const result = JSON.parse(response.body);
  if (response.status >= 400 || !result.sessionId) throw new Error(result.message || 'Dispatch did not return a lead session.');
  await host.openSession(result.sessionId);
});
