import { cost } from './cost.mjs';
import { family, hostApi, collectPages } from './family.mjs';

// OpenCode 2.3.2: one typed assistant message per step. Read only assistant
// messages. Session totals and auxiliary usage events are not additive here.
export const STATUS = {OK:'ok', NO_DATA:'no-data', PARTIAL:'partial', UNSUPPORTED:'unsupported', INVALID:'invalid'};

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export async function usage(directory, rootId, options = {}) {
  const api = options.api ?? hostApi(options.run);
  const result = {directory, rootId, counts:{reported:0, estimated:0, unknown:0}, reported:0, estimated:0,
    sessions:[], observed:[], events:0, truncated:false, errors:[], status:STATUS.INVALID};
  if (!directory || !rootId) return result;
  let tree;
  try { tree = await family(api, directory, rootId, options.maxSessions); }
  catch { return {...result,status:STATUS.UNSUPPORTED,errors:[{scope:'root',code:'ROOT_UNAVAILABLE'}]}; }
  const steps = [], observed = new Map();
  const limit = options.messageLimit ?? 100;
  let reads = 0;
  // Only validated family members are read. Foreign sessions are never queried.
  for (const session of tree.sessions) {
    result.sessions.push(session.id);
    const page = await collectPages(
      api,
      `/api/session/${encodeURIComponent(session.id)}/message`,
      {type:'assistant', limit, order:'desc'},
      {maxPages: options.maxMessagePages},
    );
    if (!page.read) {
      result.errors.push({scope:`messages:${session.id}`,code:'MESSAGES_UNAVAILABLE'});
      continue;
    }
    reads++;
    // Coverage is decided by the tail page: a full bare page is ambiguous
    // even after cursor pages; an exhausted cursor walk is complete.
    if (page.partial || page.capped || page.ambiguousTail) result.truncated = true;
    for (const row of page.rows) {
      // Non-assistant rows are legitimately filtered. A malformed row or an
      // assistant row without a stable id is a lost observation: partial,
      // never a silently ignored no-data/OK result.
      if (!isObject(row)) { result.truncated = true; continue; }
      if (row.type !== 'assistant') continue;
      if (!row.id) { result.truncated = true; continue; }
      const {agent,model} = row;
      if (agent && model?.id && model.providerID) {
        const item = {sessionId:session.id, parentId:session.parentID ?? null, agent,
          model:`${model.providerID}/${model.id}`,variant:model.variant ?? null};
        observed.set(JSON.stringify(item),item);
      }
      steps.push({id:row.id, child:session.id !== rootId, providerID:model?.providerID,
        modelID:model?.id, cost:row.cost, tokens:row.tokens});
    }
  }
  const catalog = {};
  if (steps.some(s => s.cost == null && s.tokens)) {
    try {
      const models = await api('GET','/api/model',{'location[directory]':directory});
      for (const m of models ?? []) {
        // A tiered catalog needs more context than this message provides.
        if (m.cost?.length === 1 && m.cost[0].tier === undefined) catalog[`${m.providerID}/${m.id}`] = m;
      }
    } catch { result.errors.push({scope:'catalog',code:'CATALOG_UNAVAILABLE'}); }
  }
  const data = cost(steps,catalog);
  result.observed = [...observed.values()];
  for (const key of Object.keys(result.counts)) result.counts[key] = data.counts[key];
  result.events = data.deduplicated;
  result.estimated = data.estimated;
  result.reported = data.reported;
  result.truncated ||= tree.partial;
  result.status = !reads ? STATUS.UNSUPPORTED : result.errors.length || data.counts.unknown || result.truncated ?
    STATUS.PARTIAL : result.events ? STATUS.OK : STATUS.NO_DATA;
  return result;
}
export default usage;
