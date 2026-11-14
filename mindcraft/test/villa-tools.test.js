import test from 'node:test';
import assert from 'node:assert/strict';
import { Vec3 } from 'vec3';
import minecraftData from 'minecraft-data';
import { getCommand } from '../src/agent/commands/index.js';

test('site survey reports usable ground and refuses distant areas', () => {
    const survey = getCommand('!surveyArea');
    const bot = {entity:{position:new Vec3(0,65,0)}, blockAt:pos => pos.y <= 64
        ? {name:'grass_block',boundingBox:'block'} : {name:'air',boundingBox:'empty'}};
    const map = survey.perform({bot}, -1, -1, 2, 2);
    assert.match(map, /z=-1: 65 65/);
    assert.match(map, /z=0: 65 65/);
    assert.match(survey.perform({bot}, 100, 100, 2, 2), /too far away/);
});

test('block properties are validated before sending a game command', async () => {
    const action = getCommand('!placeBlockState');
    const sent = [];
    const bot = {game:{gameMode:'creative'},entity:{position:new Vec3(0,65,0)},output:'',
        registry:{blocksByName:{oak_stairs:{states:[{name:'facing',type:'enum',values:['north','south']}]}}},
        blockAt:() => ({name:'oak_stairs',getProperties:()=>({facing:'north'})}),
        chat:message=>sent.push(message)};
    const agent = {bot,actions:{runAction:async (_name, fn) => {await fn();return {message:bot.output};}}};
    await action.perform(agent,'oak_stairs','facing=west',0,65,0);
    assert.equal(sent.length,0);
    assert.match(bot.output,/Invalid property/);
    bot.output='';
    await action.perform(agent,'oak_stairs','facing=north',0,65,0);
    assert.deepEqual(sent,['/setblock 0 65 0 minecraft:oak_stairs[facing=north]']);
    assert.match(bot.output,/confirmed/);
});

test('volume inspection and selective replacement preserve unrelated blocks', async () => {
    const inspect=getCommand('!inspectVolume');
    const replace=getCommand('!replaceBlocks');
    const cells=new Map([['0,65,0','oak_leaves'],['1,65,0','chest']]);
    const key=pos=>`${pos.x},${pos.y},${pos.z}`;
    const bot={game:{gameMode:'creative'},entity:{position:new Vec3(0,65,0)},output:'',
        blockAt:pos=>({name:cells.get(key(pos))||'air'}),
        chat:command=>{assert.match(command,/minecraft:air replace minecraft:oak_leaves$/);cells.set('0,65,0','air');}};
    const agent={bot,actions:{runAction:async (_name,fn)=>{await fn();return {message:bot.output};}}};
    assert.match(inspect.perform(agent,0,65,0,1,65,0),/oak_leaves: 1/);
    assert.match(inspect.perform(agent,0,65,0,1,65,0),/chest: 1/);
    await replace.perform(agent,'oak_leaves','air',0,65,0,1,65,0);
    assert.equal(cells.get('0,65,0'),'air');
    assert.equal(cells.get('1,65,0'),'chest');
    assert.match(bot.output,/observed 1\/1 changed/);
});

test('block interaction reports actual before and after states', async () => {
    const action=getCommand('!interactBlock');
    let open=false;
    const bot={entity:{position:new Vec3(0,65,1)},output:'',
        blockAt:()=>({name:'oak_door',getProperties:()=>({open})}),
        unequip:async()=>{},lookAt:async()=>{},activateBlock:async()=>{open=!open;}};
    const agent={bot,actions:{runAction:async (_name,fn)=>{await fn();return {message:bot.output};}}};
    await action.perform(agent,0,65,0);
    assert.equal(open,true);
    assert.match(bot.output,/"open":false/);
    assert.match(bot.output,/"open":true/);
});

test('walking uses non-destructive pathfinding and reports final position', async () => {
    const action=getCommand('!walkToCoordinates');
    let movements;
    const bot={registry:minecraftData('1.21.6'),entity:{position:new Vec3(0,65,0)},output:'',
        pathfinder:{setMovements:m=>{movements=m;},goto:async goal=>{bot.entity.position=new Vec3(goal.x,goal.y,goal.z);},stop:()=>{}}};
    const agent={bot,actions:{runAction:async (_name,fn)=>{await fn();return {message:bot.output};}}};
    await action.perform(agent,1,65,1);
    assert.equal(movements.canDig,false);
    assert.deepEqual(movements.scafoldingBlocks,[]);
    assert.match(bot.output,/actual position \(1\.00, 65\.00, 1\.00\)/);
});

test('straight walking uses controls, reports actual position, and releases controls', async () => {
    const action=getCommand('!walkStraightTo');
    const controls=[];
    const bot={entity:{position:new Vec3(0.5,65,0.5)},output:'',
        lookAt:async()=>{},
        setControlState:(name,value)=>{controls.push([name,value]);if(value) bot.entity.position=new Vec3(0.5,65,2.5);}};
    const agent={bot,actions:{runAction:async (_name,fn)=>{await fn();return {message:bot.output};}}};
    await action.perform(agent,0,65,2);
    assert.deepEqual(controls,[['forward',true],['forward',false]]);
    assert.match(bot.output,/actual position \(0\.50, 65\.00, 2\.50\), reached: true/);
});
