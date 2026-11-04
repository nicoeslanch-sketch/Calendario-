import { PDFDocument, StandardFonts, rgb } from '../vendor/pdf-lib-1.17.1.js';

// Standard PDF fonts cover Spanish. Render unsupported symbols explicitly rather
// than dropping text or failing the export (no external fonts or network calls).
export function pdfText(value = '') {
  return String(value ?? '').normalize('NFC').replace(/[\u2010-\u2015]/g, '-').replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'").replace(/…/g, '...').replace(/[•✓✔]/g, '-')
    .replace(/[^\x20-\x7e\xa0-\xff\n]/gu, (c) => /\s/.test(c) ? ' ' : `[U+${c.codePointAt(0).toString(16).toUpperCase()}]`);
}
export function pdfFilename(hito) {
  const name = String(hito.title || 'hito').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-|-$/g, '').slice(0, 80) || 'hito';
  return `Hito-${hito.year || ''}-${name}.pdf`;
}

export async function createMilestonePdf(hito, owner = '') {
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const colors = { ink: rgb(.13,.24,.2), pine: rgb(.09,.25,.2), muted: rgb(.4,.48,.43), line: rgb(.82,.87,.82), pale: rgb(.95,.97,.94) };
  const width = 595.28, height = 841.89, margin = 36, contentWidth = width - 2 * margin;
  let page, y;
  const draw = (text, x, yy, size = 10, font = regular, color = colors.ink) => page.drawText(pdfText(text), { x, y: yy, size, font, color });
  function wrap(value, maxWidth, size = 10, font = regular) {
    const lines = [];
    for (const paragraph of pdfText(value).split('\n')) {
      let line = '';
      for (const char of paragraph) {
        if (line && font.widthOfTextAtSize(line + char, size) > maxWidth) {
          const space = line.lastIndexOf(' ');
          if (space > line.length / 2) { lines.push(line.slice(0,space)); line = line.slice(space + 1) + char; }
          else { lines.push(line); line = char; }
        } else line += char;
      }
      lines.push(line.trimEnd());
    }
    return lines.length ? lines : [''];
  }
  function newPage() {
    page = pdf.addPage([width,height]);
    page.drawRectangle({ x: 0, y: height - 73, width, height: 73, color: colors.pine });
    draw('PDR | MEMORIA DEL EQUIPO',margin,height-28,10,bold,rgb(1,1,1));
    const short = wrap(hito.title || 'Hito histórico', contentWidth-80,13,bold)[0];
    draw(`${hito.year || ''} - ${short}`,margin,height-51,13,bold,rgb(1,1,1));
    y = height - 98;
  }
  function room(needed) { if (y - needed < 49) newPage(); }
  function paragraph(value, size = 10, font = regular, color = colors.ink) {
    for (const line of wrap(value,contentWidth,size,font)) { room(size + 7); draw(line,margin,y,size,font,color); y -= size + 5; }
    y -= 9;
  }
  function section(label) { room(42); y -= 8; draw(label,margin,y,13,bold); y -= 23; }
  function tableHeader() {
    room(30); page.drawRectangle({ x: margin, y:y-25, width:contentWidth, height:25, color:colors.pale });
    draw('Tarea / actividad',margin+8,y-16,9,bold);
    draw('Estado',margin+238,y-16,9,bold);
    draw('Observaciones para otro año',margin+325,y-16,9,bold);
    y -= 25;
  }
  newPage();
  paragraph(hito.title || 'Hito histórico',20,bold);
  if (owner) paragraph(`Perfil: ${owner}`,10,regular,colors.muted);
  const tasks = (hito.tasks || []).filter((t) => t.title?.trim());
  const done = tasks.filter((t) => t.completed).length;
  section('Planilla histórica de actividades');
  paragraph(`${done} realizadas | ${tasks.length - done} por realizar. Referencia para la próxima edición.`,9,regular,colors.muted);
  tableHeader();
  const rows = tasks.length ? tasks : [{ title: 'Sin actividades registradas.', completed: false, notes: '' }];
  for (const task of rows) {
    const columns = [wrap(task.title,214,9), wrap(task.completed ? 'Realizada' : 'Por realizar',70,9), wrap(task.notes || '-',190,9)];
    const total = Math.max(...columns.map((c) => c.length));
    let offset = 0;
    while (offset < total) {
      if (y < 90) { newPage(); tableHeader(); }
      const lines = Math.min(total - offset, Math.floor((y - 57) / 13) - 1);
      const rowHeight = Math.max(29,lines * 13 + 14);
      page.drawRectangle({ x: margin, y: y-rowHeight, width:contentWidth, height:rowHeight, color: task.completed ? colors.pale : rgb(1,1,1), borderColor: colors.line, borderWidth:.5 });
      for (const [index, x] of [margin+8,margin+238,margin+325].entries()) {
        for (let line = 0; line < lines; line++) if (columns[index][offset+line] !== undefined) draw(columns[index][offset+line],x,y-16-line*13,9);
      }
      y -= rowHeight; offset += lines;
    }
  }
  y -= 14;
  for (const [label, value] of [['Para qué se realiza',hito.purpose],['Directrices y criterios',hito.guidelines],['Planificación y pasos a seguir',hito.plan],['Aprendizajes para otros años',hito.learnings]]) {
    section(label); paragraph(value || 'Sin información registrada.');
  }
  for (const [index,p] of pdf.getPages().entries()) {
    p.drawLine({ start:{ x:margin,y:35 },end:{ x:width-margin,y:35 },thickness:.5,color:colors.line });
    p.drawText(`PDR | Hito ${hito.year || ''} | ${index+1} / ${pdf.getPageCount()}`,{ x:margin,y:21,size:8,font:regular,color:colors.muted });
  }
  pdf.setTitle(pdfText(hito.title || 'Hito histórico'));
  pdf.setAuthor(pdfText(owner || 'Equipo PDR'));
  pdf.setSubject('Planilla histórica de actividades y aprendizajes');
  return pdf.save();
}

export async function downloadMilestonePdf(hito, owner) {
  const bytes = await createMilestonePdf(hito, owner);
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
  const link = document.createElement('a');
  link.href = url; link.download = pdfFilename(hito); document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
