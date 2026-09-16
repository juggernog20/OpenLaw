// Writes the small fictional attachment fixtures for the DOC-029 conversations walkthrough.
import { writeFileSync } from "node:fs";
function pdf(text) {
  const objs = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    null,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  const stream = `BT /F1 18 Tf 72 700 Td (${text}) Tj ET`;
  objs[3] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
  let out = "%PDF-1.4\n";
  const offsets = [];
  objs.forEach((o, i) => { offsets.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offsets.map((n) => `${String(n).padStart(10, "0")} 00000 n \n`).join("");
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return out;
}
writeFileSync("doc029-conv-notice.pdf", pdf("DOC-029 conversations fictional notice letter"));
writeFileSync("doc029-conv-schedule.pdf", pdf("DOC-029 conversations fictional pricing schedule"));
writeFileSync("doc029-conv-portal-note.pdf", pdf("DOC-029 conversations fictional requester note"));
writeFileSync("doc029-conv-legal-memo.pdf", pdf("DOC-029 conversations fictional legal-only memo"));
for (const n of [1, 2, 3, 4, 5, 6]) writeFileSync(`doc029-conv-extra-${n}.txt`, `DOC-029 conversations fictional extra file ${n}\n`);
