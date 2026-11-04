import { expect, it } from 'vitest';
import { PDFDocument } from '../src/vendor/pdf-lib-1.17.1.js';
import { createMilestonePdf, pdfFilename, pdfText } from '../src/lib/milestone-pdf.js';

it('creates an actual PDF with Spanish text and safe filenames', async () => {
  const bytes = await createMilestonePdf({ title: 'Organización año 2026', year: 2026,
    tasks: [{ title: 'Confirmación del salón', completed: true, notes: 'Se realizó en otoño.' }] }, 'Nicolás Albornoz');
  expect(new TextDecoder().decode(bytes.slice(0,5))).toBe('%PDF-');
  const pdf = await PDFDocument.load(bytes);
  expect(pdf.getPageCount()).toBeGreaterThanOrEqual(1);
  expect(pdf.getTitle()).toBe('Organización año 2026');
  expect(pdfFilename({ title: '../../ Reunión anual', year: 2026 })).toBe('Hito-2026-Reunion-anual.pdf');
  expect(pdfText('mañana — revisión ✓')).toBe('mañana - revisión -');
});
it('paginates long activity rows and never mutates historical task states', async () => {
  const h = { title: 'Historial', year: 2026, tasks: Array.from({ length: 25 }, (_,i) => ({
    title: `Actividad ${i}: ` + 'Planificar con el equipo. '.repeat(40), completed: i % 2 === 0,
    notes: 'Recordar coordinación y materiales. '.repeat(20),
  })) };
  const before = structuredClone(h);
  const pdf = await PDFDocument.load(await createMilestonePdf(h));
  expect(pdf.getPageCount()).toBeGreaterThan(3);
  expect(h).toEqual(before);
},15000);
