export const MAX_FILE_SIZE = 5 * 1024 * 1024;
export function requiredCleanupIds(value) {
  if (!Array.isArray(value) || value.length<1 || value.length>100
    || value.some((id)=>typeof id!=='string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id))) {
    throw new Error('La limpieza requiere entre 1 y 100 IDs de archivos explícitos y válidos.');
  }
  return [...new Set(value.map((id)=>id.toLowerCase()))];
}
export const TYPES = { pdf:'application/pdf', docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', pptx:'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  txt:'text/plain', csv:'text/csv', png:'image/png', jpg:'image/jpeg', jpeg:'image/jpeg' };
export function documentMeta(name, size) {
  const safe = String(name).split(/[\\/]/).pop().replace(/[\x00-\x1f\x7f]/g,'').trim();
  const extension = safe.split('.').pop().toLowerCase();
  if (!safe || safe.length>180 || !Object.hasOwn(TYPES,extension)) throw new Error('Usa PDF, DOCX, XLSX, PPTX, TXT, CSV, PNG o JPG (sin macros).');
  if (!Number.isInteger(size) || size<1 || size>MAX_FILE_SIZE) throw new Error('Cada archivo debe pesar entre 1 byte y 5 MB.');
  return { name:safe, mime:TYPES[extension], size };
}
