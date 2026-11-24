export const issueExample = [
  'Problem: In a sample project, two agents use the same display name.',
  'Proposed change: Show the role beside each name.',
  'Acceptance test: Create two example agents named Helper. Confirm that their roles distinguish them.',
].join('\n\n');

export function issuePreview(text) {
  if (!text.trim() || text.length > 3000) throw Error('Use a synthetic example of 1–3,000 characters.');
  if (/(?:\bses_[\w-]+|\/(?:Users|home|private|var|tmp)\/|[A-Z]:\\|~\/|(?:ghp_|github_pat_|sk-)[\w-]+|BEGIN .*PRIVATE KEY)/i.test(text))
    throw Error('Remove local paths, session IDs and credentials before opening a public draft.');
  const url = new URL('https://github.com/b4db1n/office-steward/issues/new');
  url.searchParams.set('title', 'Office Steward improvement');
  url.searchParams.set('body', text);
  return url.href;
}
