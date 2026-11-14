// Apply a narrow patch to the already-installed viewer bundle. No image assets are modified.
import { readFileSync, writeFileSync, existsSync, copyFileSync, renameSync } from 'node:fs';

const bundle = new URL('./mindcraft/node_modules/prismarine-viewer/public/index.js', import.meta.url);
const backup = new URL('./runtime/viewer-index-before-garden-outfits.js', import.meta.url);
let source = readFileSync(bundle, 'utf8');
if (source.includes('garden-outfit-')) {
    console.log('Garden viewer patch is already installed.');
    process.exit(0);
}

const oldTag = 'if(void 0!==t.username){const e=s(500,100),r=e.getContext("2d");r.font="50pt Arial",r.fillStyle="#000000",r.textAlign="left",r.textBaseline="top";const a=t.username;r.fillText(a,100,0);const o=new n.Texture(e);o.needsUpdate=!0;const l=new n.SpriteMaterial({map:o}),u=new n.Sprite(l);u.position.y+=t.height+.6,i.mesh.add(u)}';
const newOutfit = `const gardenColor={RiverScout:"vec3(0.12,1.0,0.30)",StoneKeeper:"vec3(1.0,0.32,0.08)"}[t.username];if(gardenColor)i.mesh.traverse(part=>{if(!part.isSkinnedMesh)return;const material=part.material.clone();material.onBeforeCompile=shader=>{shader.fragmentShader=shader.fragmentShader.replace("#include <map_fragment>","#include <map_fragment>\\nif (diffuseColor.r < 0.04 && diffuseColor.g > 0.30 && abs(diffuseColor.g - diffuseColor.b) < 0.04) { diffuseColor.rgb = "+gardenColor+" * diffuseColor.g; }")};material.customProgramCacheKey=()=>"garden-outfit-"+t.username;part.material=material});`;
const oldCamera = 'h.update(),s=!1),i){e||(e=new a("1.16.4","player",u.scene)';
const newCamera = 'h.update(),s=!1),i&&"3002"!==window.location.port){e||(e=new a("1.16.4","player",u.scene)';

for (const [label, before] of [['name tag', oldTag], ['camera mesh', oldCamera]]) {
    if (source.split(before).length !== 2) throw new Error(`Expected exactly one ${label} segment in the installed viewer.`);
}
if (!existsSync(backup)) copyFileSync(bundle, backup);
source = source.replace(oldTag, newOutfit).replace(oldCamera, newCamera);
const temporary = new URL('./mindcraft/node_modules/prismarine-viewer/public/index.js.garden-tmp', import.meta.url);
writeFileSync(temporary, source);
renameSync(temporary, bundle);
console.log('Removed 3D name tags, assigned green and orange shirts, and hid the spectator camera avatar.');
