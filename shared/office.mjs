/** Return the visible root and its descendants in one project snapshot. */
export function officeTeam(snapshot, projectId, rootId, directory) {
  if (!rootId || !projectId || snapshot?.state !== 'ready') return [];
  const sessions = snapshot.sessions.filter(s => !s.archivedAt && s.projectId === projectId &&
    (!directory || s.directory === directory));
  const byId = new Map(sessions.map(s => [s.id,s]));
  if (!byId.has(rootId)) return [];
  return sessions.filter(s => {
    const seen = new Set();
    let item = s;
    while (item && !seen.has(item.id)) {
      if (item.id === rootId) return true;
      seen.add(item.id);
      item = byId.get(item.parentId);
    }
    return false;
  });
}
