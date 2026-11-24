import { officeTeam } from './office.mjs';
import { selectLead } from './setup.mjs';

// A projection of the current snapshot, not an event counter. Replay and
// reconnect rebuild the same records; observing the office never sends work.
export function observation(session) {
  switch (session.activity) {
    case 'waiting-question': return {tone:'waiting', label:'Waiting for an answer'};
    case 'waiting-permission': return {tone:'waiting', label:'Waiting for permission'};
    case 'running': return {tone:'running', label:'Running'};
    case 'retrying': return {tone:'running', label:'Retrying'};
    case 'idle': break;
    default: return {tone:'unknown', label:'Status unknown'};
  }
  if (session.outcome === 'failed') return {tone:'failed', label:'Failed'};
  if (session.outcome === 'completed') return {tone:'completed', label:'Completed · result not verified'};
  return {tone:'idle', label:session.unread ? 'Idle · unread activity' : 'Idle'};
}

export function modelAvailable(info, route) {
  if (typeof route !== 'string') return false;
  const [id, variant, extra] = route.split('#');
  return extra === undefined && !!info?.models?.includes(id) &&
    (variant === undefined || !!info.variants?.[id]?.includes(variant));
}

function route(ref) {
  return ref?.id && ref.providerID ? `${ref.providerID}/${ref.id}${ref.variant && ref.variant !== 'default' ? `#${ref.variant}` : ''}` : null;
}

/**
 * The confirmed Office team for this view, as raw snapshot sessions so every
 * surface renders the same ids. Only sessions below a recorded reservation
 * root are eligible: the chat being viewed is never itself Office work.
 * A member of a team sees that whole team; any other chat sees the project's
 * confirmed teams. Replay and reconnect rebuild the same family.
 */
export function officeFamily(snapshot, projectId, directory, reservations, rootId) {
  const roots = [...new Set(reservations.map(r => r.rootId).filter(Boolean))];
  const families = roots.map(id => officeTeam(snapshot, projectId, id, directory));
  const chosen = families.find(rows => rows.some(s => s.id === rootId));
  const rows = chosen ?? families.flat();
  return [...new Map(rows.map(s => [s.id, s])).values()];
}

export function steward({directory, projectId, rootId, snapshot, inspect:info, inspectState, inspectError, snapshotError}) {
  const settings = info?.settings ?? {};
  const selected = selectLead(info?.agents ?? [], settings.lead).selected;
  const bound = route(info?.agents?.find(a => a.id === selected)?.model);
  const model = settings.leadModel ?? bound ?? route(info?.hostModel);
  const source = settings.leadModel ? (info.sources?.leadModel ?? 'unknown') : bound ? 'agent' : 'host';
  const configured = !!settings.lead;
  const reservations = Array.isArray(info?.reservations) ? info.reservations : [];
  const coverage = Array.isArray(snapshot?.coverage)
    ? snapshot.coverage.find(c => c?.directory === directory)
    : undefined;
  // A missing or foreign project id, an errored snapshot or absent/non-ready
  // checkout coverage must never reach Ready, and must never expose records.
  const trusted = !!projectId && snapshot?.state === 'ready' && !snapshotError &&
    snapshot.projectId === projectId && coverage?.state === 'ready';
  const family = trusted ? officeFamily(snapshot, projectId, directory, reservations, rootId) : [];
  const records = family.map(s => ({
    id:s.id, parentId:s.parentId, agent:s.agent, title:s.title, ...observation(s),
  }));
  const result = (state, reason) => ({state, reason, configured, model, source, records, family});
  if (!directory) return result('Setup required','Open a project folder.');
  if (inspectState === 'error') return result('Degraded',inspectError || 'Office discovery failed. Refresh to retry.');
  if (!info || inspectState !== 'ready') return result('Checking','Reading project settings and host capabilities.');
  if (info.agentDiscovery === 'unavailable' || info.modelDiscovery === 'unavailable')
    return result('Degraded','OpenCode discovery is unavailable. Open the project in OpenCode and refresh.');
  if (!configured) return result('Setup required','Preview the available agents and choose a lead.');
  if (!selected) return result('Needs attention',`Selected lead "${settings.lead}" is unavailable. Review Settings.`);
  if (!modelAvailable(info,model)) return result('Needs attention','The selected lead model or variant is unavailable. Review Settings.');
  if (settings.specialistModel && !modelAvailable(info,settings.specialistModel))
    return result('Needs attention','The specialist preference is unavailable. Review Settings.');
  if (settings.budget != null) return result('Needs attention','The finite budget blocks dispatch: OpenCode cannot cap delegated spending.');
  if (settings.parallelism === 0) return result('Needs attention','Dispatch is paused (parallelism is zero).');
  if (!trusted)
    return result('Degraded',snapshotError || 'Live session coverage is unavailable. Check session access and refresh.');
  if (!Array.isArray(info.reservations)) return result('Degraded','Office records were not confirmed. Refresh discovery.');
  if (reservations.some(r => r.phase === 'uncertain' || r.phase === 'sending'))
    return result('Needs attention','An Office delivery is pending or uncertain. Inspect the root before retrying.');
  // SDK record order is not meaningful. Validate scoped membership of the
  // root inside its team instead of assuming the first row is the root.
  if (reservations.some(r => r.phase !== 'finished' &&
      !officeTeam(snapshot, projectId, r.rootId, directory).some(s => s.id === r.rootId)))
    return result('Needs attention','A reserved root is not visible. Inspect the record before retrying.');
  if (records.some(r => ['failed','waiting','unknown'].includes(r.tone)))
    return result('Needs attention','Open the highlighted session to inspect its status.');
  return result('Ready','Lead and model are available; session updates connected.');
}
