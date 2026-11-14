import * as skills from '../library/skills.js';
import settings from '../settings.js';
import convoManager from '../conversation.js';
import { Vec3 } from 'vec3';
import pf from 'mineflayer-pathfinder';


function runAsAction (actionFn, resume = false, timeout = -1) {
    let actionLabel = null;  // Will be set on first use
    
    const wrappedAction = async function (agent, ...args) {
        // Set actionLabel only once, when the action is first created
        if (!actionLabel) {
            const actionObj = actionsList.find(a => a.perform === wrappedAction);
            actionLabel = actionObj.name.substring(1); // Remove the ! prefix
        }

        const actionFnWithAgent = async () => {
            await actionFn(agent, ...args);
        };
        const code_return = await agent.actions.runAction(`action:${actionLabel}`, actionFnWithAgent, { timeout, resume });
        if (code_return.interrupted && !code_return.timedout)
            return;
        return code_return.message;
    }

    return wrappedAction;
}

export const actionsList = [
    {
        name: '!newAction',
        description: 'Perform new and unknown custom behaviors that are not available as a command.', 
        params: {
            'prompt': { type: 'string', description: 'A natural language prompt to guide code generation. Make a detailed step-by-step plan.' }
        },
        perform: async function(agent, prompt) {
            // just ignore prompt - it is now in context in chat history
            if (!settings.allow_insecure_coding) { 
                agent.openChat('newAction is disabled. Enable with allow_insecure_coding=true in settings.js');
                return "newAction not allowed! Code writing is disabled in settings. Notify the user.";
            }
            let result = "";
            const actionFn = async () => {
                try {
                    result = await agent.coder.generateCode(agent.history);
                } catch (e) {
                    result = 'Error generating code: ' + e.toString();
                }
            };
            await agent.actions.runAction('action:newAction', actionFn, {timeout: settings.code_timeout_mins});
            return result;
        }
    },
    {
        name: '!stop',
        description: 'Force stop all actions and commands that are currently executing.',
        perform: async function (agent) {
            await agent.actions.stop();
            agent.clearBotLogs();
            agent.actions.cancelResume();
            agent.bot.emit('idle');
            let msg = 'Agent stopped.';
            if (agent.self_prompter.isActive())
                msg += ' Self-prompting still active.';
            return msg;
        }
    },
    {
        name: '!stfu',
        description: 'Stop all chatting and self prompting, but continue current action.',
        perform: async function (agent) {
            agent.openChat('Shutting up.');
            agent.shutUp();
            return;
        }
    },
    {
        name: '!restart',
        description: 'Restart the agent process.',
        perform: async function (agent) {
            agent.cleanKill();
        }
    },
    {
        name: '!clearChat',
        description: 'Clear the chat history.',
        perform: async function (agent) {
            agent.history.clear();
            return agent.name + "'s chat history was cleared, starting new conversation from scratch.";
        }
    },
    {
        name: '!goToPlayer',
        description: 'Go to the given player.',
        params: {
            'player_name': {type: 'string', description: 'The name of the player to go to.'},
            'closeness': {type: 'float', description: 'How close to get to the player.', domain: [0, Infinity]}
        },
        perform: runAsAction(async (agent, player_name, closeness) => {
            await skills.goToPlayer(agent.bot, player_name, closeness);
        })
    },
    {
        name: '!followPlayer',
        description: 'Endlessly follow the given player.',
        params: {
            'player_name': {type: 'string', description: 'name of the player to follow.'},
            'follow_dist': {type: 'float', description: 'The distance to follow from.', domain: [0, Infinity]}
        },
        perform: runAsAction(async (agent, player_name, follow_dist) => {
            await skills.followPlayer(agent.bot, player_name, follow_dist);
        }, true)
    },
    {
        name: '!goToCoordinates',
        description: 'Go to the given x, y, z location.',
        params: {
            'x': {type: 'float', description: 'The x coordinate.', domain: [-Infinity, Infinity]},
            'y': {type: 'float', description: 'The y coordinate.', domain: [-64, 320]},
            'z': {type: 'float', description: 'The z coordinate.', domain: [-Infinity, Infinity]},
            'closeness': {type: 'float', description: 'How close to get to the location.', domain: [0, Infinity]}
        },
        perform: runAsAction(async (agent, x, y, z, closeness) => {
            await skills.goToPosition(agent.bot, x, y, z, closeness);
        })
    },
    {
        name: '!searchForBlock',
        description: 'Find and go to the nearest block of a given type in a given range.',
        params: {
            'type': { type: 'BlockName', description: 'The block type to go to.' },
            'search_range': { type: 'float', description: 'The range to search for the block. Minimum 32.', domain: [10, 512] }
        },
        perform: runAsAction(async (agent, block_type, range) => {
            if (range < 32) {
                skills.log(agent.bot, `Minimum search range is 32.`);
                range = 32;
            }
            await skills.goToNearestBlock(agent.bot, block_type, 4, range);
        })
    },
    {
        name: '!searchForEntity',
        description: 'Find and go to the nearest entity of a given type in a given range.',
        params: {
            'type': { type: 'string', description: 'The type of entity to go to.' },
            'search_range': { type: 'float', description: 'The range to search for the entity.', domain: [32, 512] }
        },
        perform: runAsAction(async (agent, entity_type, range) => {
            await skills.goToNearestEntity(agent.bot, entity_type, 4, range);
        })
    },
    {
        name: '!moveAway',
        description: 'Move away from the current location in any direction by a given distance.',
        params: {'distance': { type: 'float', description: 'The distance to move away.', domain: [0, Infinity] }},
        perform: runAsAction(async (agent, distance) => {
            await skills.moveAway(agent.bot, distance);
        })
    },
    {
        name: '!rememberHere',
        description: 'Save the current location with a given name.',
        params: {'name': { type: 'string', description: 'The name to remember the location as.' }},
        perform: async function (agent, name) {
            const pos = agent.bot.entity.position;
            agent.memory_bank.rememberPlace(name, pos.x, pos.y, pos.z);
            return `Location saved as "${name}".`;
        }
    },
    {
        name: '!goToRememberedPlace',
        description: 'Go to a saved location.',
        params: {'name': { type: 'string', description: 'The name of the location to go to.' }},
        perform: runAsAction(async (agent, name) => {
            const pos = agent.memory_bank.recallPlace(name);
            if (!pos) {
            skills.log(agent.bot, `No location named "${name}" saved.`);
            return;
            }
            await skills.goToPosition(agent.bot, pos[0], pos[1], pos[2], 1);
        })
    },
    {
        name: '!givePlayer',
        description: 'Give the specified item to the given player.',
        params: { 
            'player_name': { type: 'string', description: 'The name of the player to give the item to.' }, 
            'item_name': { type: 'ItemName', description: 'The name of the item to give.' },
            'num': { type: 'int', description: 'The number of items to give.', domain: [1, Number.MAX_SAFE_INTEGER] }
        },
        perform: runAsAction(async (agent, player_name, item_name, num) => {
            await skills.giveToPlayer(agent.bot, item_name, player_name, num);
        })
    },
    {
        name: '!consume',
        description: 'Eat/drink the given item.',
        params: {'item_name': { type: 'ItemName', description: 'The name of the item to consume.' }},
        perform: runAsAction(async (agent, item_name) => {
            await skills.consume(agent.bot, item_name);
        })
    },
    {
        name: '!equip',
        description: 'Equip the given item.',
        params: {'item_name': { type: 'ItemName', description: 'The name of the item to equip.' }},
        perform: runAsAction(async (agent, item_name) => {
            await skills.equip(agent.bot, item_name);
        })
    },
    {
        name: '!putInChest',
        description: 'Put the given item in the nearest chest.',
        params: {
            'item_name': { type: 'ItemName', description: 'The name of the item to put in the chest.' },
            'num': { type: 'int', description: 'The number of items to put in the chest.', domain: [1, Number.MAX_SAFE_INTEGER] }
        },
        perform: runAsAction(async (agent, item_name, num) => {
            await skills.putInChest(agent.bot, item_name, num);
        })
    },
    {
        name: '!takeFromChest',
        description: 'Take the given items from the nearest chest.',
        params: {
            'item_name': { type: 'ItemName', description: 'The name of the item to take.' },
            'num': { type: 'int', description: 'The number of items to take.', domain: [1, Number.MAX_SAFE_INTEGER] }
        },
        perform: runAsAction(async (agent, item_name, num) => {
            await skills.takeFromChest(agent.bot, item_name, num);
        })
    },
    {
        name: '!viewChest',
        description: 'View the items/counts of the nearest chest.',
        params: { },
        perform: runAsAction(async (agent) => {
            await skills.viewChest(agent.bot);
        })
    },
    {
        name: '!discard',
        description: 'Discard the given item from the inventory.',
        params: {
            'item_name': { type: 'ItemName', description: 'The name of the item to discard.' },
            'num': { type: 'int', description: 'The number of items to discard.', domain: [1, Number.MAX_SAFE_INTEGER] }
        },
        perform: runAsAction(async (agent, item_name, num) => {
            const start_loc = agent.bot.entity.position;
            await skills.moveAway(agent.bot, 5);
            await skills.discard(agent.bot, item_name, num);
            await skills.goToPosition(agent.bot, start_loc.x, start_loc.y, start_loc.z, 0);
        })
    },
    {
        name: '!collectBlocks',
        description: 'Collect the nearest blocks of a given type.',
        params: {
            'type': { type: 'BlockName', description: 'The block type to collect.' },
            'num': { type: 'int', description: 'The number of blocks to collect.', domain: [1, Number.MAX_SAFE_INTEGER] }
        },
        perform: runAsAction(async (agent, type, num) => {
            await skills.collectBlock(agent.bot, type, num);
        }, false, 10) // 10 minute timeout
    },
    {
        name: '!craftRecipe',
        description: 'Craft the given recipe a given number of times.',
        params: {
            'recipe_name': { type: 'ItemName', description: 'The name of the output item to craft.' },
            'num': { type: 'int', description: 'The number of times to craft the recipe. This is NOT the number of output items, as it may craft many more items depending on the recipe.', domain: [1, Number.MAX_SAFE_INTEGER] }
        },
        perform: runAsAction(async (agent, recipe_name, num) => {
            await skills.craftRecipe(agent.bot, recipe_name, num);
        })
    },
    {
        name: '!smeltItem',
        description: 'Smelt the given item the given number of times.',
        params: {
            'item_name': { type: 'ItemName', description: 'The name of the input item to smelt.' },
            'num': { type: 'int', description: 'The number of times to smelt the item.', domain: [1, Number.MAX_SAFE_INTEGER] }
        },
        perform: runAsAction(async (agent, item_name, num) => {
            let success = await skills.smeltItem(agent.bot, item_name, num);
            if (success) {
                setTimeout(() => {
                    agent.cleanKill('Safely restarting to update inventory.');
                }, 500);
            }
        })
    },
    {
        name: '!clearFurnace',
        description: 'Take all items out of the nearest furnace.',
        params: { },
        perform: runAsAction(async (agent) => {
            await skills.clearNearestFurnace(agent.bot);
        })
    },
        {
        name: '!placeHere',
        description: 'Place a given block in the current location. Do NOT use to build structures, only use for single blocks/torches.',
        params: {'type': { type: 'BlockOrItemName', description: 'The block type to place.' }},
        perform: runAsAction(async (agent, type) => {
            let pos = agent.bot.entity.position;
            await skills.placeBlock(agent.bot, type, pos.x, pos.y, pos.z);
        })
    },
    {
        name: '!fillBlocks',
        description: 'In creative mode, fill a rectangular area with one chosen block type. Coordinates are inclusive. The area must be within 32 blocks of you, each side at most 16 blocks, and contain at most 256 blocks. The result reports observed blocks, not just the request.',
        params: {
            type: {type: 'BlockName', description: 'Minecraft block name, such as stone_bricks or poppy.'},
            x1: {type: 'int', description: 'First corner x.'},
            y1: {type: 'int', description: 'First corner y.', domain: [-64, 319, '[]']},
            z1: {type: 'int', description: 'First corner z.'},
            x2: {type: 'int', description: 'Opposite corner x.'},
            y2: {type: 'int', description: 'Opposite corner y.', domain: [-64, 319, '[]']},
            z2: {type: 'int', description: 'Opposite corner z.'}
        },
        perform: runAsAction(async (agent, type, x1, y1, z1, x2, y2, z2) => {
            const bot = agent.bot;
            if (bot.game.gameMode !== 'creative' || !/^[a-z0-9_]+$/.test(type)) {
                skills.log(bot, 'This operation requires creative mode and a valid block name.');
                return;
            }
            const min = new Vec3(Math.min(x1, x2), Math.min(y1, y2), Math.min(z1, z2));
            const max = new Vec3(Math.max(x1, x2), Math.max(y1, y2), Math.max(z1, z2));
            const sizes = [max.x - min.x + 1, max.y - min.y + 1, max.z - min.z + 1];
            if (sizes.some(n => n > 16) || sizes.reduce((a, b) => a * b, 1) > 256 ||
                bot.entity.position.distanceTo(min) > 32 || bot.entity.position.distanceTo(max) > 32) {
                skills.log(bot, 'Area is too large or far away; move closer or choose a smaller area.');
                return;
            }
            const cells = [];
            for (let x = min.x; x <= max.x; x++) for (let y = min.y; y <= max.y; y++) for (let z = min.z; z <= max.z; z++) {
                const pos = new Vec3(x, y, z);
                const before = bot.blockAt(pos);
                if (!before) {
                    skills.log(bot, 'Area is not fully loaded; move closer first.');
                    return;
                }
                cells.push({pos, before: before.name});
            }
            bot.chat(`/fill ${min.x} ${min.y} ${min.z} ${max.x} ${max.y} ${max.z} minecraft:${type}`);
            await new Promise(resolve => setTimeout(resolve, 1100));
            const observed = cells.filter(cell => bot.blockAt(cell.pos)?.name === type).length;
            const changed = cells.filter(cell => cell.before !== type && bot.blockAt(cell.pos)?.name === type).length;
            skills.log(bot, `Fill ${type} at ${min} to ${max}: observed ${observed}/${cells.length}, newly changed ${changed}.`);
        }, false, 1)
    },
    {
        name:'!interactBlock',
        description:'Right-click a nearby block with an empty hand and report its actual before and after properties. Useful to test doors and switches; move within four blocks first.',
        params:{x:{type:'int',description:'Block X.'},y:{type:'int',description:'Block Y.',domain:[-64,319,'[]']},z:{type:'int',description:'Block Z.'}},
        perform:runAsAction(async (agent,x,y,z)=>{
            const bot=agent.bot, pos=new Vec3(x,y,z), block=bot.blockAt(pos);
            if(!block || bot.entity.position.distanceTo(pos.offset(0.5,0.5,0.5))>4.5){
                skills.log(bot,'Block is unavailable or too far away; move within four blocks.');return;
            }
            const before=block.getProperties?.()||{};
            await bot.unequip('hand');
            await bot.lookAt(pos.offset(0.5,0.5,0.5),true);
            await bot.activateBlock(block);
            await new Promise(resolve=>setTimeout(resolve,800));
            const after=bot.blockAt(pos);
            skills.log(bot,`Interacted with ${block.name} at ${pos}; before ${JSON.stringify(before)}, after ${after?.name||'unloaded'} ${JSON.stringify(after?.getProperties?.()||{})}.`);
        },false,1)
    },
    {
        name:'!walkToCoordinates',
        description:'Physically walk to a nearby position without teleporting, digging or placing blocks. Useful for testing whether a route is passable. The result reports the actual final position.',
        params:{x:{type:'int',description:'Target X.'},y:{type:'int',description:'Target standing Y.',domain:[-64,319,'[]']},z:{type:'int',description:'Target Z.'}},
        perform:runAsAction(async (agent,x,y,z)=>{
            const bot=agent.bot, target=new Vec3(x,y,z);
            if(bot.entity.position.distanceTo(target)>24){skills.log(bot,'Target is too far away for a walking test.');return;}
            const movements=new pf.Movements(bot);
            movements.canDig=false;
            movements.allow1by1towers=false;
            movements.allowParkour=false;
            movements.scafoldingBlocks=[];
            movements.canOpenDoors=false;
            bot.pathfinder.setMovements(movements);
            let timer;
            try {
                await Promise.race([
                    bot.pathfinder.goto(new pf.goals.GoalBlock(x,y,z)),
                    new Promise((_,reject)=>{timer=setTimeout(()=>{bot.pathfinder.stop();reject(new Error('walking timed out'));},15000);})
                ]);
            } catch(error) {
                skills.log(bot,`Walking did not complete: ${error.message}.`);
            } finally {clearTimeout(timer);bot.pathfinder.stop();}
            const actual=bot.entity.position;
            skills.log(bot,`Walk target ${target}; actual position (${actual.x.toFixed(2)}, ${actual.y.toFixed(2)}, ${actual.z.toFixed(2)}), distance ${actual.distanceTo(target).toFixed(2)}.`);
        },false,1)
    },
    {
        name:'!walkStraightTo',
        description:'Physically walk in a straight line to the center of a nearby block, without teleporting or modifying blocks. Useful when a pathfinder cannot recognize an open door. Reports the actual position and whether the target was reached.',
        params:{x:{type:'int',description:'Target block X.'},y:{type:'int',description:'Target standing Y.',domain:[-64,319,'[]']},z:{type:'int',description:'Target block Z.'}},
        perform:runAsAction(async (agent,x,y,z)=>{
            const bot=agent.bot, target=new Vec3(x+0.5,y,z+0.5);
            const start=bot.entity.position.clone();
            const horizontalDistance=()=>Math.hypot(bot.entity.position.x-target.x,bot.entity.position.z-target.z);
            if(horizontalDistance()>6 || Math.abs(start.y-y)>1){skills.log(bot,'Target is too far away or at a different height for a straight walking test.');return;}
            await bot.lookAt(new Vec3(target.x,start.y+1.62,target.z),true);
            const deadline=Date.now()+4000;
            try {
                bot.setControlState('forward',true);
                while(horizontalDistance()>0.35 && Date.now()<deadline && !bot.interrupt_code)
                    await new Promise(resolve=>setTimeout(resolve,50));
            } finally {bot.setControlState('forward',false);}
            const actual=bot.entity.position;
            const reached=horizontalDistance()<=0.35 && Math.abs(actual.y-y)<1;
            skills.log(bot,`Straight walk from (${start.x.toFixed(2)}, ${start.y.toFixed(2)}, ${start.z.toFixed(2)}) toward ${target}; actual position (${actual.x.toFixed(2)}, ${actual.y.toFixed(2)}, ${actual.z.toFixed(2)}), reached: ${reached}.`);
        },false,1)
    },
    {
        name: '!replaceBlocks',
        description: 'In creative mode replace only a specified block type within a nearby volume, preserving every other type. Maximum 512 blocks and 16 per side. Example: replace oak_leaves with air to clear foliage without removing furniture.',
        params: {
            from:{type:'BlockName',description:'Only this block type will be replaced.'},
            to:{type:'BlockName',description:'Replacement block type, often air.'},
            x1:{type:'int',description:'First corner X.'}, y1:{type:'int',description:'First corner Y.',domain:[-64,319,'[]']},
            z1:{type:'int',description:'First corner Z.'}, x2:{type:'int',description:'Other corner X.'},
            y2:{type:'int',description:'Other corner Y.',domain:[-64,319,'[]']}, z2:{type:'int',description:'Other corner Z.'}
        },
        perform:runAsAction(async (agent,from,to,x1,y1,z1,x2,y2,z2) => {
            const bot=agent.bot;
            const min=new Vec3(Math.min(x1,x2),Math.min(y1,y2),Math.min(z1,z2));
            const max=new Vec3(Math.max(x1,x2),Math.max(y1,y2),Math.max(z1,z2));
            const sizes=[max.x-min.x+1,max.y-min.y+1,max.z-min.z+1];
            if(bot.game.gameMode!=='creative'||!/^\w+$/.test(from)||!/^\w+$/.test(to)||from===to||
                sizes.some(n=>n>16)||sizes.reduce((a,b)=>a*b,1)>512||
                bot.entity.position.distanceTo(min)>32||bot.entity.position.distanceTo(max)>32) {
                skills.log(bot,'Replacement requires creative mode, distinct valid blocks, and a small nearby volume.');
                return;
            }
            const matching=[];
            for(let x=min.x;x<=max.x;x++) for(let y=min.y;y<=max.y;y++) for(let z=min.z;z<=max.z;z++) {
                const pos=new Vec3(x,y,z), block=bot.blockAt(pos);
                if(!block){skills.log(bot,'Some positions are not loaded; move closer first.');return;}
                if(block.name===from) matching.push(pos);
            }
            if(!matching.length){skills.log(bot,`No ${from} found in the specified volume.`);return;}
            bot.chat(`/fill ${min.x} ${min.y} ${min.z} ${max.x} ${max.y} ${max.z} minecraft:${to} replace minecraft:${from}`);
            await new Promise(resolve=>setTimeout(resolve,1100));
            const replaced=matching.filter(pos=>bot.blockAt(pos)?.name===to).length;
            const remaining=matching.filter(pos=>bot.blockAt(pos)?.name===from).length;
            skills.log(bot,`Replace ${from} with ${to} at ${min} to ${max}: observed ${replaced}/${matching.length} changed, ${remaining} original blocks remain.`);
        }, false, 1)
    },
    {
        name: '!placeBlockState',
        description: 'In creative mode place one block with chosen properties for details such as stairs or doors. Use valid Minecraft block properties, for example "facing=north,half=bottom" for oak_stairs. The result reports the observed block and properties.',
        params: {
            type: {type:'BlockName', description:'Minecraft block name.'},
            properties: {type:'string', description:'Comma-separated block properties such as facing=north,half=bottom.'},
            x: {type:'int', description:'Block X.'},
            y: {type:'int', description:'Block Y.', domain:[-64,319,'[]']},
            z: {type:'int', description:'Block Z.'}
        },
        perform: runAsAction(async (agent, type, properties, x, y, z) => {
            const bot = agent.bot;
            const pos = new Vec3(x,y,z);
            if (bot.game.gameMode !== 'creative' || bot.entity.position.distanceTo(pos) > 32 || !/^[a-z0-9_]+$/.test(type) ||
                !/^[a-z0-9_]+=[a-z0-9_]+(,[a-z0-9_]+=[a-z0-9_]+)*$/.test(properties)) {
                skills.log(bot, 'Requires creative mode, a nearby position, and valid block properties.');
                return;
            }
            const schema = bot.registry?.blocksByName?.[type]?.states || [];
            const pairs = properties.split(',').map(item => item.split('='));
            const names = new Set();
            for (const [key, value] of pairs) {
                const spec = schema.find(item => item.name === key);
                const valid = spec && !names.has(key) && (spec.type === 'bool' ? ['true','false'].includes(value)
                    : spec.values ? spec.values.includes(value)
                    : spec.type === 'int' && /^\d+$/.test(value) && Number(value) < spec.num_values);
                if (!valid) {
                    skills.log(bot, `Invalid property ${key}=${value} for ${type}.`);
                    return;
                }
                names.add(key);
            }
            if (!bot.blockAt(pos)) {
                skills.log(bot, 'The position is not loaded; move closer first.');
                return;
            }
            bot.chat(`/setblock ${x} ${y} ${z} minecraft:${type}[${properties}]`);
            await new Promise(resolve => setTimeout(resolve,1100));
            const actual = bot.blockAt(pos);
            const actualProperties = actual?.getProperties?.() || {};
            const matched = actual?.name === type && pairs.every(([key,value]) => String(actualProperties[key]) === value);
            skills.log(bot, `Placed ${type} at ${pos}: ${matched ? 'confirmed' : 'not confirmed'}; observed ${actual?.name || 'unloaded'} ${JSON.stringify(actualProperties)}.`);
        }, false, 1)
    },
    {
        name: '!placeWoodPanel',
        description: 'Build a wall, post or roof panel using your own planks. Start at the minimum x, y, z corner. Width goes east (+x), height up (+y), depth south (+z). One dimension must be 1 and the panel can use up to 20 blocks. Place posts or walls before a roof.',
        params: {
            x: { type: 'int', description: 'Minimum x.' },
            y: { type: 'int', description: 'Minimum y.' },
            z: { type: 'int', description: 'Minimum z.' },
            width: { type: 'int', description: 'Number of blocks along x.', domain: [1, 6, '[]'] },
            height: { type: 'int', description: 'Number of blocks along y.', domain: [1, 4, '[]'] },
            depth: { type: 'int', description: 'Number of blocks along z.', domain: [1, 6, '[]'] }
        },
        perform: runAsAction(async (agent, x, y, z, width, height, depth) => {
            const bot = agent.bot;
            const total = width * height * depth;
            if (Math.min(width, height, depth) !== 1 || total > 20) {
                skills.log(bot, 'Choose a panel with one dimension of 1 and at most 20 blocks.');
                return;
            }
            const start = new Vec3(x, y, z);
            const end = start.offset(width - 1, height - 1, depth - 1);
            if (bot.entity.position.distanceTo(start) > 10 || bot.entity.position.distanceTo(end) > 10) {
                skills.log(bot, 'Move closer to the building site first.');
                return;
            }

            const replaceable = new Set(['air', 'short_grass', 'tall_grass', 'fern', 'leaf_litter']);
            const pending = [];
            for (let dy = 0; dy < height; dy++) {
                for (let dz = 0; dz < depth; dz++) {
                    for (let dx = 0; dx < width; dx++) {
                        const cell = start.offset(dx, dy, dz);
                        const block = bot.blockAt(cell);
                        if (block?.name.endsWith('_planks')) continue;
                        if (!replaceable.has(block?.name)) {
                            skills.log(bot, `Panel obstructed at ${cell} by ${block?.name ?? 'unloaded terrain'}.`);
                            return;
                        }
                        pending.push(cell);
                    }
                }
            }
            const sides = [[0, -1, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, 1, 0]];
            let placed = 0;
            while (pending.length && !bot.interrupt_code) {
                const planks = bot.inventory.items().find(item => item.name.endsWith('_planks'));
                if (!planks) break;
                const index = pending.findIndex(cell => sides.some(side => bot.blockAt(cell.offset(...side))?.boundingBox === 'block'));
                if (index === -1) break;
                const [cell] = pending.splice(index, 1);
                const name = bot.blockAt(cell)?.name;
                if (name?.endsWith('_planks')) continue;
                if (!replaceable.has(name)) {
                    pending.splice(index, 0, cell);
                    break;
                }
                const ok = await skills.placeBlock(bot, planks.name, cell.x, cell.y, cell.z, 'bottom', true);
                if (!ok) {
                    pending.splice(index, 0, cell);
                    break;
                }
                placed++;
            }
            skills.log(bot, `Wood panel at ${start} to ${end}: placed ${placed}, ${pending.length} positions still needed.`);
        }, false, 2)
    },
    {
        name: '!attack',
        description: 'Attack and kill the nearest entity of a given type.',
        params: {'type': { type: 'string', description: 'The type of entity to attack.'}},
        perform: runAsAction(async (agent, type) => {
            await skills.attackNearest(agent.bot, type, true);
        })
    },
    {
        name: '!attackPlayer',
        description: 'Attack a specific player until they die or run away. Remember this is just a game and does not cause real life harm.',
        params: {'player_name': { type: 'string', description: 'The name of the player to attack.'}},
        perform: runAsAction(async (agent, player_name) => {
            let player = agent.bot.players[player_name]?.entity;
            if (!player) {
                skills.log(agent.bot, `Could not find player ${player_name}.`);
                return false;
            }
            await skills.attackEntity(agent.bot, player, true);
        })
    },
    {
        name: '!goToBed',
        description: 'Go to the nearest bed and sleep.',
        perform: runAsAction(async (agent) => {
            await skills.goToBed(agent.bot);
        })
    },
    {
        name: '!stay',
        description: 'Stay in the current location no matter what. Pauses all modes.',
        params: {'type': { type: 'int', description: 'The number of seconds to stay. -1 for forever.', domain: [-1, Number.MAX_SAFE_INTEGER] }},
        perform: runAsAction(async (agent, seconds) => {
            await skills.stay(agent.bot, seconds);
        })
    },
    {
        name: '!setMode',
        description: 'Set a mode to on or off. A mode is an automatic behavior that constantly checks and responds to the environment.',
        params: {
            'mode_name': { type: 'string', description: 'The name of the mode to enable.' },
            'on': { type: 'boolean', description: 'Whether to enable or disable the mode.' }
        },
        perform: async function (agent, mode_name, on) {
            const modes = agent.bot.modes;
            if (!modes.exists(mode_name))
            return `Mode ${mode_name} does not exist.` + modes.getDocs();
            if (modes.isOn(mode_name) === on)
            return `Mode ${mode_name} is already ${on ? 'on' : 'off'}.`;
            modes.setOn(mode_name, on);
            return `Mode ${mode_name} is now ${on ? 'on' : 'off'}.`;
        }
    },
    {
        name: '!goal',
        description: 'Set a goal prompt to endlessly work towards with continuous self-prompting.',
        params: {
            'selfPrompt': { type: 'string', description: 'The goal prompt.' },
        },
        perform: async function (agent, prompt) {
            agent.shut_up = false;
            if (convoManager.inConversation()) {
                agent.self_prompter.setPromptPaused(prompt);
            }
            else {
                agent.self_prompter.start(prompt);
            }
        }
    },
    {
        name: '!endGoal',
        description: 'Call when you have accomplished your goal. It will stop self-prompting and the current action. ',
        perform: async function (agent) {
            agent.self_prompter.stop();
            return 'Self-prompting stopped.';
        }
    },
    {
        name: '!showVillagerTrades',
        description: 'Show trades of a specified villager.',
        params: {'id': { type: 'int', description: 'The id number of the villager that you want to trade with.' }},
        perform: runAsAction(async (agent, id) => {
            await skills.showVillagerTrades(agent.bot, id);
        })
    },
    {
        name: '!tradeWithVillager',
        description: 'Trade with a specified villager.',
        params: {
            'id': { type: 'int', description: 'The id number of the villager that you want to trade with.' },
            'index': { type: 'int', description: 'The index of the trade you want executed (1-indexed).', domain: [1, Number.MAX_SAFE_INTEGER] },
            'count': { type: 'int', description: 'How many times that trade should be executed.', domain: [1, Number.MAX_SAFE_INTEGER] },
        },
        perform: runAsAction(async (agent, id, index, count) => {
            await skills.tradeWithVillager(agent.bot, id, index, count);
        })
    },
    {
        name: '!startConversation',
        description: 'Start a conversation with a bot. (FOR OTHER BOTS ONLY)',
        params: {
            'player_name': { type: 'string', description: 'The name of the player to send the message to.' },
            'message': { type: 'string', description: 'The message to send.' },
        },
        perform: async function (agent, player_name, message) {
            if (!convoManager.isOtherAgent(player_name))
                return player_name + ' is not a bot, cannot start conversation.';
            if (convoManager.inConversation() && !convoManager.inConversation(player_name)) 
                convoManager.forceEndCurrentConversation();
            else if (convoManager.inConversation(player_name))
                agent.history.add('system', 'You are already in conversation with ' + player_name + '. Don\'t use this command to talk to them.');
            convoManager.startConversation(player_name, message);
        }
    },
    {
        name: '!endConversation',
        description: 'End the conversation with the given bot. (FOR OTHER BOTS ONLY)',
        params: {
            'player_name': { type: 'string', description: 'The name of the player to end the conversation with.' }
        },
        perform: async function (agent, player_name) {
            if (!convoManager.inConversation(player_name))
                return `Not in conversation with ${player_name}.`;
            convoManager.finishConversation(player_name);
            return `Converstaion with ${player_name} ended.`;
        }
    },
    {
        name: '!lookAtPlayer',
        description: 'Look at a player or look in the same direction as the player.',
        params: {
            'player_name': { type: 'string', description: 'Name of the target player' },
            'direction': {
                type: 'string',
                description: 'How to look ("at": look at the player, "with": look in the same direction as the player)',
            }
        },
        perform: async function(agent, player_name, direction) {
            if (direction !== 'at' && direction !== 'with') {
                return "Invalid direction. Use 'at' or 'with'.";
            }
            let result = "";
            const actionFn = async () => {
                result = await agent.vision_interpreter.lookAtPlayer(player_name, direction);
            };
            await agent.actions.runAction('action:lookAtPlayer', actionFn);
            return result;
        }
    },
    {
        name: '!lookAtPosition',
        description: 'Look at specified coordinates.',
        params: {
            'x': { type: 'int', description: 'x coordinate' },
            'y': { type: 'int', description: 'y coordinate' },
            'z': { type: 'int', description: 'z coordinate' }
        },
        perform: async function(agent, x, y, z) {
            let result = "";
            const actionFn = async () => {
                result = await agent.vision_interpreter.lookAtPosition(x, y, z);
            };
            await agent.actions.runAction('action:lookAtPosition', actionFn);
            return result;
        }
    },
    {
        name: '!digDown',
        description: 'Digs down a specified distance. Will stop if it reaches lava, water, or a fall of >=4 blocks below the bot.',
        params: {'distance': { type: 'int', description: 'Distance to dig down', domain: [1, Number.MAX_SAFE_INTEGER] }},
        perform: runAsAction(async (agent, distance) => {
            await skills.digDown(agent.bot, distance)
        })
    },
    {
        name: '!goToSurface',
        description: 'Moves the bot to the highest block above it (usually the surface).',
        params: {},
        perform: runAsAction(async (agent) => {
            await skills.goToSurface(agent.bot);
        })
    },
    {
        name: '!useOn',
        description: 'Use (right click) the given tool on the nearest target of the given type.',
        params: {
            'tool_name': { type: 'string', description: 'Name of the tool to use, or "hand" for no tool.' },
            'target': { type: 'string', description: 'The target as an entity type, block type, or "nothing" for no target.' }
        },
        perform: runAsAction(async (agent, tool_name, target) => {
            await skills.useToolOn(agent.bot, tool_name, target);
        })
    },
];
