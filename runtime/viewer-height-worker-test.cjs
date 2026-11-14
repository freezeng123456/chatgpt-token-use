const { Worker } = require('node:worker_threads');
const path = require('node:path');
const Chunk = require('../mindcraft/node_modules/prismarine-chunk')('1.21.4');
const mcData = require('../mindcraft/node_modules/minecraft-data')('1.21.4');
const { Vec3 } = require('../mindcraft/node_modules/vec3');
const states = require('../mindcraft/node_modules/prismarine-viewer/public/blocksStates/1.21.4.json');
const worker = new Worker(path.join(__dirname, '../mindcraft/node_modules/prismarine-viewer/public/worker.js'));
const chunk = new Chunk();
for (const y of [-32, 64, 304]) chunk.setBlockStateId(new Vec3(1,y,1), mcData.blocksByName.stone.defaultState);
const found = new Set();
const finished = new Set();
const timer = setTimeout(() => {console.error('worker test timed out');worker.terminate();process.exitCode=1}, 30000);
worker.on('error', err=>{clearTimeout(timer);console.error(err.message);process.exitCode=1;});
worker.on('message', msg=>{
  if (msg.type==='geometry' && msg.geometry.positions.length>0) found.add(msg.key);
  if (msg.type==='sectionFinished') finished.add(msg.key);
  if (finished.size===3) {
    clearTimeout(timer); console.log(JSON.stringify({geometry:[...found], finished:[...finished]}));
    for(const y of [-32,64,304]) if(!found.has(`0,${y},0`)) process.exitCode=1;
    worker.terminate();
  }
});
worker.postMessage({type:'version', version:'1.21.4'});
worker.postMessage({type:'blockStates',json:states});
worker.postMessage({type:'chunk',x:0,z:0,chunk:chunk.toJson()});
for (const y of [-32,64,304]) worker.postMessage({type:'dirty',x:0,y,z:0,value:true});
