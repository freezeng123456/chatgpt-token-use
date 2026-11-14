// Fix the local spectator's 1.21 overworld height range, retaining the outfit patch.
// Only static viewer files are changed; the Minecraft server/world are untouched.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const viewer = path.join(root, 'mindcraft/node_modules/prismarine-viewer');
const backups = path.join(root, 'runtime/viewer-before-height-fix');
const specs = [
  ['public/index.js', [
    ['for(let i=0;i<256;i+=16){const n=new r(t,i,e);this.setSectionDirty(n)',
      'for(let i=-64;i<320;i+=16){const n=new r(t,i,e);this.setSectionDirty(n)'],
    ['for(let i=0;i<256;i+=16){this.setSectionDirty(new r(t,i,e),!1)',
      'for(let i=-64;i<320;i+=16){this.setSectionDirty(new r(t,i,e),!1)']
  ]],
  ['public/worker.js', [
    ['i&&i.sections[Math.floor(a/16)]?dirtySections[s]=t',
      'i&&i.sections[Math.floor((a-(i.minY??0))/16)]?dirtySections[s]=t'],
    ['if(l&&l.sections[Math.floor(n/16)]){delete dirtySections[t]',
      'if(l&&l.sections[Math.floor((n-(l.minY??0))/16)]){delete dirtySections[t]'],
    ['g.position.y<0)continue;let v=', 'g.position.y< -64)continue;let v='],
    ['n.position.y<0)continue}const S=', 'n.position.y< -64)continue}const S=']
  ]],
  ['viewer/lib/worldrenderer.js', [
    ['for (let y = 0; y < 256; y += 16)', 'for (let y = -64; y < 320; y += 16)', 2]
  ]],
  ['viewer/lib/worker.js', [
    ['chunk.sections[Math.floor(y / 16)]', 'chunk.sections[Math.floor((y - (chunk.minY ?? 0)) / 16)]', 2]
  ]],
  ['viewer/lib/models.js', [
    ['if (neighbor.position.y < 0) continue', 'if (neighbor.position.y < -64) continue', 2]
  ]]
];

const changed = [];
for (const [relative, replacements] of specs) {
  const file = path.join(viewer, relative);
  let text = fs.readFileSync(file, 'utf8');
  for (const [oldText, newText, expected = 1] of replacements) {
    const oldCount = text.split(oldText).length - 1;
    const newCount = text.split(newText).length - 1;
    if (oldCount === 0 && newCount === expected) continue;
    if (oldCount !== expected || newCount !== 0) throw new Error(`${relative}: unexpected patch state ${oldCount}/${newCount}`);
    text = text.split(oldText).join(newText);
  }
  changed.push([relative, text]);
}
for (const [relative, text] of changed) {
  const file = path.join(viewer, relative);
  const backup = path.join(backups, relative);
  fs.mkdirSync(path.dirname(backup), { recursive: true });
  if (!fs.existsSync(backup)) fs.copyFileSync(file, backup);
  const temporary = `${file}.height-tmp`;
  fs.writeFileSync(temporary, text);
  fs.renameSync(temporary, file);
  console.log(`Patched ${relative}`);
}
