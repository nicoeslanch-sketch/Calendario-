import { requiredCleanupIds } from './validation.js';

// Never enumerate arbitrary orphans or infer an unbounded deletion scope.
// Validate the whole result before the first Storage mutation.
export async function cleanupDocuments(fileIds, {query,remove,purge}) {
  const ids=requiredCleanupIds(fileIds);
  const allowed=new Set(ids);
  const files=await query({file_ids:ids});
  if (!Array.isArray(files) || files.some((f)=>!allowed.has(f.id) || typeof f.storage_path!=='string' || !f.storage_path)) {
    throw new Error('La limpieza recibió archivos fuera de los IDs solicitados. No se borró ningún archivo.');
  }
  const removed_ids=[];
  for (const file of files) {
    const {error}=await remove([file.storage_path]);
    if (error) throw new Error('No se pudo eliminar un adjunto seleccionado. Puedes reintentar con los mismos IDs.');
    await purge({file_id:file.id});
    removed_ids.push(file.id);
  }
  return {ok:true,removed_ids};
}
