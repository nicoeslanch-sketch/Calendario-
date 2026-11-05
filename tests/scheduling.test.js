import { expect, it } from 'vitest';
import { scheduledDate, validOptionalDate, validateSchedule } from '../src/lib/scheduling.js';
import { minutePayload } from '../src/lib/minutes.js';
import { reuseMilestone } from '../src/lib/milestones.js';
import { documentMeta, MAX_FILE_SIZE } from '../supabase/functions/hito-documents/validation.js';

it('keeps dates optional, inherits folder dates, overrides and explicitly opts out', () => {
 const folders=[{id:'f',name:'Evento',assignee:'tomas',scheduled_date:'2026-11-09'}];
 expect(scheduledDate({folder_id:'f'},folders)).toBe('2026-11-09');
 expect(scheduledDate({folder_id:'f',schedule_mode:'custom',scheduled_date:'2026-11-12'},folders)).toBe('2026-11-12');
 expect(scheduledDate({folder_id:'f',schedule_mode:'none'},folders)).toBe('');
 expect(scheduledDate({folder_id:'missing'},folders)).toBe('');
 const m={title:'Fechas',folders,notes:[{id:'n',text:'Actividad',folder_id:'f'}]};
 expect(minutePayload(m,true).analysis.folders[0].tasks[0].scheduled_date).toBe('2026-11-09');
 expect(minutePayload({...m,folders:[{...folders[0],scheduled_date:''}]},true).analysis.folders[0].tasks[0].scheduled_date).toBeNull();
});
it('rejects malformed, non-calendar or out-of-range dates', () => {
 expect(validOptionalDate('2028-02-29')).toBe('2028-02-29');
 for(const value of ['2026-02-29','2026-11-31','11/04/2026','2026-13-01','1999-01-01','2201-01-01',123]) expect(()=>validOptionalDate(value)).toThrow();
 expect(()=>validateSchedule({folders:[],notes:[{schedule_mode:'weekly'}]})).toThrow();
});
it('reuses a historical structure as pending with independent IDs and no old results mixed in', () => {
 const source={id:'h1',title:'Evento anual',year:2026,guidelines:'Presencial',plan:'Plan anterior',learnings:'Más tiempo',
  tasks:[{id:'t1',title:'Reservar',completed:true,notes:'Con un mes de anticipación'}],documents:[{id:'d1',name:'Bases.pdf'}]};
 const before=structuredClone(source);
 const next=reuseMilestone(source,2027,()=> 'new-task');
 expect(next).not.toHaveProperty('id');
 expect(next.source_hito_id).toBe('h1'); expect(next.learnings).toBe('');
 expect(next.tasks[0]).toEqual({...source.tasks[0],id:'new-task',completed:false});
 expect(next.documents).toEqual([]); expect(next.source_snapshot.documents).toEqual(source.documents);
 next.tasks[0].title='Cambio'; next.source_snapshot.tasks[0].notes='Otra nota';
 expect(source).toEqual(before);
});
it('limits attachments and never accepts executable, active web, macros or unsafe filenames', () => {
 expect(documentMeta('../Bases.PDF',100)).toMatchObject({name:'Bases.PDF',mime:'application/pdf',size:100});
 expect(documentMeta('Plan.xlsx',MAX_FILE_SIZE).mime).toContain('spreadsheetml');
 for(const name of ['app.exe','page.html','image.svg','macro.xlsm','foo.constructor','foo.__proto__']) expect(()=>documentMeta(name,20)).toThrow();
 for(const size of [0,-1,1.5,MAX_FILE_SIZE+1]) expect(()=>documentMeta('Bases.pdf',size)).toThrow();
});
