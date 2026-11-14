const test = require('node:test');
const assert = require('node:assert/strict');
const { mapState, mapChunk, install } = require('./viewer-version-bridge.cjs');
const Block = require('../mindcraft/node_modules/prismarine-block');
const Chunk = require('../mindcraft/node_modules/prismarine-chunk');
const { Vec3 } = require('../mindcraft/node_modules/vec3');
const From = Block('1.21.6');
const To = Block('1.21.4');

test('maps real block names and meaningful states instead of reusing raw ids', () => {
  const cases = [
    ['stone_bricks', {}], ['smooth_quartz', {}],
    ['smooth_quartz_slab', { type: 'top', waterlogged: false }],
    ['oak_door', { facing: 'south', half: 'lower', hinge: 'left', open: true, powered: false }],
    ['white_bed', { facing: 'north', part: 'head', occupied: false }],
    ['lantern', { hanging: true, waterlogged: false }],
    ['oak_stairs', { facing: 'south', half: 'bottom', shape: 'straight', waterlogged: false }]
  ];
  for (const [name, properties] of cases) {
    const source = From.fromProperties(name, properties, 0);
    const result = To.fromStateId(mapState(source.stateId), 0);
    assert.equal(result.name, name);
    for (const [key, value] of Object.entries(properties)) assert.equal(String(result.getProperties()[key]), String(value));
  }
  assert.equal(To.fromStateId(mapState(From.fromProperties('leaf_litter', {}, 0).stateId), 0).name, 'short_grass');
});

test('converts chunk palette without changing its source', () => {
  const source = new (Chunk('1.21.6'))();
  const samples = ['stone_bricks', 'smooth_quartz', 'lantern', 'oak_door', 'crafting_table'];
  samples.forEach((name, i) => source.setBlockStateId(new Vec3(i, 64, 0), From.fromProperties(name, {}, 0).stateId));
  const original = source.toJson();
  const converted = Chunk('1.21.4').fromJson(mapChunk(original));
  samples.forEach((name, i) => assert.equal(converted.getBlock(new Vec3(i, 64, 0)).name, name));
  assert.equal(source.toJson(), original);
});

test('converts direct palettes as well as ordinary indirect palettes', () => {
  const source = new (Chunk('1.21.6'))();
  for (let i = 0; i < 300; i++) source.setBlockStateId(new Vec3(i % 16, 64 + Math.floor(i / 256), Math.floor(i / 16) % 16), i);
  const original = source.toJson();
  assert.match(original, /direct/);
  const converted = Chunk('1.21.4').fromJson(mapChunk(original));
  for (let i = 0; i < 300; i++) {
    const p = new Vec3(i % 16, 64 + Math.floor(i / 256), Math.floor(i / 16) % 16);
    assert.equal(converted.getBlockStateId(p), mapState(source.getBlockStateId(p)));
  }
});

test('applies translations to both initial chunks and live block updates', async () => {
  const { EventEmitter } = require('node:events');
  const { WorldView } = require('../mindcraft/node_modules/prismarine-viewer/viewer/lib/worldView');
  const source = new (Chunk('1.21.6'))();
  const pos = new Vec3(0, 64, 0);
  source.setBlockStateId(pos, From.fromProperties('stone_bricks', {}, 0).stateId);
  const emitter = new EventEmitter();
  const view = new WorldView({getColumnAt:async()=>source}, 4, pos, emitter);
  const bot = new EventEmitter(); bot.username='test';bot.entity={};bot.entities={};
  install();
  let loaded; let update;
  emitter.on('loadChunk', item => {loaded=item;});
  emitter.on('blockUpdate', item => {update=item;});
  view.listenToBot(bot);
  await view.loadChunk(new Vec3(0,0,0));
  assert.equal(Chunk('1.21.4').fromJson(loaded.chunk).getBlock(pos).name, 'stone_bricks');
  const fresh=From.fromProperties('smooth_quartz_slab',{type:'top',waterlogged:false},0); fresh.position=pos;
  bot.emit('blockUpdate', {position:pos}, fresh);
  assert.equal(To.fromStateId(update.stateId,0).name, 'smooth_quartz_slab');
  assert.equal(To.fromStateId(update.stateId,0).getProperties().type, 'top');
  view.removeListenersFromBot(bot);
});
