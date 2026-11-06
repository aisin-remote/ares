import fs from 'node:fs/promises';
import path from 'node:path';
import { FileBlob, PresentationFile } from '@oai/artifact-tool';

const source = 'D:/fabian/00_Project/AI Project/ares/output/ARES-End-to-End-Flow-Complete-v3.pptx';
const output = 'D:/fabian/00_Project/AI Project/ares/.codex-ppt-build/final-render-complete-v3';

await fs.mkdir(output, { recursive: true });
const presentation = await PresentationFile.importPptx(await FileBlob.load(source));
const inspection = await presentation.inspect({
  select: '$.slides[*]',
  include: [
    'id', 'index', 'title', 'elements.id', 'elements.kind', 'elements.name',
    'elements.text', 'elements.position', 'elements.style', 'elements.alt',
  ],
});
await fs.writeFile(path.join(output, 'inspection.ndjson'), inspection.ndjson, 'utf8');

for (const [index, slide] of presentation.slides.items.entries()) {
  const stem = `slide-${String(index + 1).padStart(2, '0')}`;
  const png = await presentation.export({ slide, format: 'png', scale: 1.5 });
  await fs.writeFile(path.join(output, `${stem}.png`), new Uint8Array(await png.arrayBuffer()));
  const layout = await slide.export({ format: 'layout', detail: 'full' });
  await fs.writeFile(path.join(output, `${stem}.layout.json`), await layout.text(), 'utf8');
}

const montage = await presentation.export({ format: 'webp', montage: true, scale: 0.5 });
await fs.writeFile(path.join(output, 'montage.webp'), new Uint8Array(await montage.arrayBuffer()));
console.log(JSON.stringify({ slides: presentation.slides.items.length, size: presentation.slideSize }));
