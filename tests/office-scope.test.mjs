import test from 'node:test';
import assert from 'node:assert/strict';
import { officeTeam } from '../shared/office.mjs';
import { issueExample,issuePreview } from '../shared/contribution.mjs';

test('switching roots reuses the project snapshot without leaking a different team', () => {
  const list = [['one',null],['child','one'],['grandchild','child'],['two',null],['other','two'],['loop','loop']];
  const snapshot = {state:'ready',sessions:list.map(([id,parentId]) => ({id,parentId,projectId:'sample'}))};
  snapshot.sessions.push({id:'foreign',parentId:'two',projectId:'outside'});
  assert.deepEqual(officeTeam(snapshot,'sample','one').map(r=>r.id),['one','child','grandchild']);
  assert.deepEqual(officeTeam(snapshot,'sample','two').map(r=>r.id),['two','other']);
  assert.deepEqual(officeTeam({...snapshot,state:'loading'},'sample','two'),[]);
});
test('contributions use an unsubmitted public editor and reject private identifiers', () => {
  const target = new URL(issuePreview(issueExample));
  assert.equal(target.pathname,'/b4db1n/office-steward/issues/new');
  assert.equal(target.searchParams.get('body'),issueExample);
  assert.throws(()=>issuePreview('My fixture is at ~/example'));
});
