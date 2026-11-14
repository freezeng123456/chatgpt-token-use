// Translate 1.21.6 block states only in spectator packets for the 1.21.4 viewer.
// The Minecraft world and the agents always keep their native 1.21.6 state IDs.
const minecraftData = require('../mindcraft/node_modules/minecraft-data');
const prismarineBlock = require('../mindcraft/node_modules/prismarine-block');
const BitArray = require('../mindcraft/node_modules/prismarine-chunk/src/pc/common/BitArrayNoSpan');
const { WorldView } = require('../mindcraft/node_modules/prismarine-viewer/viewer/lib/worldView');

const sourceRegistry = minecraftData('1.21.6');
const targetRegistry = minecraftData('1.21.4');
const SourceBlock = prismarineBlock(sourceRegistry);
const TargetBlock = prismarineBlock(targetRegistry);
const cache = new Map();
const fallback = {
  leaf_litter: 'short_grass', wildflowers: 'oxeye_daisy', bush: 'fern',
  short_dry_grass: 'short_grass', tall_dry_grass: 'tall_grass',
  cactus_flower: 'pink_tulip', firefly_bush: 'fern', dried_ghast: 'sand'
};

function mapState(sourceId) {
  if (cache.has(sourceId)) return cache.get(sourceId);
  let targetId = 0;
  try {
    const source = SourceBlock.fromStateId(sourceId, 0);
    const name = targetRegistry.blocksByName[source.name] ? source.name : fallback[source.name];
    const descriptor = name && targetRegistry.blocksByName[name];
    if (descriptor) {
      if (name !== source.name) {
        targetId = descriptor.defaultState;
      } else {
        const accepted = new Set((descriptor.states || []).map(state => state.name));
        const properties = Object.fromEntries(Object.entries(source.getProperties() || {}).filter(([key]) => accepted.has(key)));
        const target = TargetBlock.fromProperties(name, properties, 0);
        const observed = target.getProperties() || {};
        const matches = Object.entries(properties).every(([key, value]) => String(observed[key]) === String(value));
        targetId = Number.isInteger(target.stateId) && target.name === name && matches ? target.stateId : descriptor.defaultState;
      }
    }
  } catch (error) {
    console.warn(`Viewer state conversion failed for ${sourceId}: ${error.message}`);
  }
  cache.set(sourceId, targetId);
  return targetId;
}

function mapChunk(json) {
  const chunk = JSON.parse(json);
  chunk.sections = chunk.sections.map(sectionJson => {
    if (!sectionJson) return sectionJson;
    const section = JSON.parse(sectionJson);
    let data = JSON.parse(section.data);
    if (data.type === 'single') data.value = mapState(data.value);
    else if (data.type === 'indirect') data.palette = data.palette.map(mapState);
    else if (data.type === 'direct') {
      const sourceBits = BitArray.fromJson(data.data);
      const values = Array.from({length:sourceBits.capacity}, (_, i) => mapState(sourceBits.get(i)));
      const palette = [...new Set(values)];
      const indices = new Map(palette.map((value, index) => [value, index]));
      const width = Math.max(4, Math.ceil(Math.log2(palette.length)));
      const encoded = new BitArray({bitsPerValue:width, capacity:values.length});
      values.forEach((value, index) => encoded.set(index, indices.get(value)));
      // This viewer's chunk library drops direct-container data on JSON import.
      // An indirect container retains the same states and remains mutable.
      data = {type:'indirect', palette, maxBits:Math.max(8,width), maxBitsPerBlock:15, data:encoded.toJson()};
    } else throw new Error(`Unsupported viewer palette ${data.type}`);
    section.data = JSON.stringify(data);
    return JSON.stringify(section);
  });
  return JSON.stringify(chunk);
}

function wrapEmitter(view) {
  const emitter = view.emitter;
  if (emitter.__gardenStateBridge) return;
  const original = emitter.emit;
  emitter.emit = function(event, ...args) {
    if (event === 'loadChunk' && args[0]?.chunk) args[0] = { ...args[0], chunk: mapChunk(args[0].chunk) };
    else if (event === 'blockUpdate' && Number.isInteger(args[0]?.stateId)) args[0] = { ...args[0], stateId: mapState(args[0].stateId) };
    return original.call(this, event, ...args);
  };
  emitter.__gardenStateBridge = true;
}

function install() {
  const loadChunk = WorldView.prototype.loadChunk;
  const listenToBot = WorldView.prototype.listenToBot;
  WorldView.prototype.loadChunk = function (...args) { wrapEmitter(this); return loadChunk.apply(this, args); };
  WorldView.prototype.listenToBot = function (...args) { wrapEmitter(this); return listenToBot.apply(this, args); };
}

module.exports = { mapState, mapChunk, install };
