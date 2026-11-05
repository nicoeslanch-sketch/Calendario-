import { expect, it, vi } from 'vitest';
import { requiredCleanupIds } from '../supabase/functions/hito-documents/validation.js';
import { cleanupDocuments } from '../supabase/functions/hito-documents/cleanup.js';

const a='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const b='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const c='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const services=(files=[])=>({query:vi.fn().mockResolvedValue(files),remove:vi.fn().mockResolvedValue({error:null}),purge:vi.fn().mockResolvedValue({})});

it('rejects missing, empty, malformed or oversized scopes before any query or deletion',async()=>{
  for(const value of [undefined,null,[],{},[null],['*'],['invalid'],['------------------------------------'],Array(101).fill(a)]) {
    const api=services();
    await expect(cleanupDocuments(value,api)).rejects.toThrow('IDs');
    expect(api.query).not.toHaveBeenCalled(); expect(api.remove).not.toHaveBeenCalled(); expect(api.purge).not.toHaveBeenCalled();
  }
  expect(requiredCleanupIds([a.toUpperCase(),a,b])).toEqual([a,b]);
});
it('queries exactly the explicit IDs and removes only their returned paths',async()=>{
  const api=services([{id:a,storage_path:'owner/hito/'+a},{id:b,storage_path:'owner/hito/'+b}]);
  await expect(cleanupDocuments([a,b],api)).resolves.toEqual({ok:true,removed_ids:[a,b]});
  expect(api.query).toHaveBeenCalledExactlyOnceWith({file_ids:[a,b]});
  expect(api.remove.mock.calls).toEqual([[['owner/hito/'+a]],[['owner/hito/'+b]]]);
  expect(api.purge.mock.calls).toEqual([[{file_id:a}],[{file_id:b}]]);
});
it('rejects any unexpected candidate before deleting even a valid earlier one',async()=>{
  const api=services([{id:a,storage_path:'owner/hito/'+a},{id:c,storage_path:'other/file'}]);
  await expect(cleanupDocuments([a,b],api)).rejects.toThrow('fuera de los IDs');
  expect(api.remove).not.toHaveBeenCalled(); expect(api.purge).not.toHaveBeenCalled();
});
it('never purges metadata when Storage fails and handles already-absent IDs safely',async()=>{
  const api=services([{id:a,storage_path:'owner/hito/'+a}]); api.remove.mockResolvedValue({error:new Error('Storage failed')});
  await expect(cleanupDocuments([a],api)).rejects.toThrow('No se pudo eliminar'); expect(api.purge).not.toHaveBeenCalled();
  const missing=services(); await expect(cleanupDocuments([a],missing)).resolves.toEqual({ok:true,removed_ids:[]});
  expect(missing.remove).not.toHaveBeenCalled();
});
