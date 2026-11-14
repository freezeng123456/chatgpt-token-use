import test from 'node:test';
import assert from 'node:assert/strict';
import manager from '../src/agent/conversation.js';
import settings from '../src/agent/settings.js';
import { SelfPrompter } from '../src/agent/self_prompter.js';

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

function setup(handleMessage = async () => {}) {
    const sent = [];
    const recorded = [];
    const pauseArgs = [];
    let paused = true;
    let busy = false;
    let resumes = 0;
    const agent = {
        name: 'RiverScout', last_sender: null, shut_up: false,
        actions: {currentActionLabel: 'action:building'},
        self_prompter: {
            isActive: () => !paused,
            isPaused: () => paused,
            pause: async stopAction => { pauseArgs.push(stopAction); paused = true; },
            start: () => { paused = false; resumes++; }
        },
        isIdle: () => !busy,
        history: {add: async (...args) => recorded.push(args)},
        handleMessage
    };
    Object.assign(settings, {conversation_idle_timeout_ms: 50, conversation_auto_end_when_silent: true, conversation_resume_delay_ms: 10});
    manager.initAgent(agent);
    manager.updateAgents([{name:'RiverScout',in_game:true},{name:'StoneKeeper',in_game:true}]);
    manager.sendBotMessage = (name, packet) => sent.push({name,packet});
    manager.startConversationFromOtherBot('StoneKeeper');
    return {agent, sent, recorded, pauseArgs, setPaused: value => { paused = value; }, setBusy: value => { busy = value; }, resumes: () => resumes};
}

async function cleanup() {
    manager._stopMonitor();
    for (const convo of Object.values(manager.convos)) clearTimeout(convo.inMessageTimer);
    manager.convos = {};
    manager.activeConversation = null;
    await delay(30);
}

test('ending a conversation notifies the partner and resumes the paused goal', async () => {
    const ctx = setup();
    manager.finishConversation('StoneKeeper');
    assert.equal(manager.inConversation(), false);
    assert.equal(ctx.sent.length, 1);
    assert.equal(ctx.sent[0].packet.end, true);
    await delay(40);
    assert.equal(ctx.resumes(), 1);
    await cleanup();
});

test('a partner ending a conversation resumes the goal without another model response', async () => {
    let responses = 0;
    const ctx = setup(async () => { responses++; });
    await manager.receiveFromBot('StoneKeeper', {message:'I will continue the path.', start:false, end:true});
    await delay(300);
    assert.equal(manager.inConversation(), false);
    assert.equal(ctx.resumes(), 1);
    assert.equal(responses, 0);
    assert.ok(ctx.recorded.some(entry => entry[1].includes('I will continue the path.')));
    await cleanup();
});

test('an idle conversation times out and releases the paused goal', async () => {
    const ctx = setup();
    await delay(2150);
    assert.equal(manager.inConversation(), false);
    assert.equal(ctx.sent.at(-1).packet.end, true);
    assert.equal(ctx.resumes(), 1);
    await cleanup();
});

test('pausing for a conversation does not stop an ongoing action', async () => {
    let stops = 0;
    const selfPrompter = new SelfPrompter({actions:{stop:async () => { stops++; }}});
    selfPrompter.state = 1;
    await selfPrompter.pause(false);
    assert.equal(stops, 0);
    assert.equal(selfPrompter.isPaused(), true);
    assert.equal(selfPrompter.interrupt, false);
});

test('a queued message waits for work and an in-flight response is not timed out', async () => {
    let release;
    const held = new Promise(resolve => { release = resolve; });
    let responses = 0;
    const ctx = setup(async () => { responses++; await held; });
    ctx.setBusy(true);
    ctx.setPaused(false);
    await manager.receiveFromBot('StoneKeeper', {message:'Let us check the garden.', start:false, end:false});
    assert.deepEqual(ctx.pauseArgs, [false]);
    await delay(100);
    assert.equal(responses, 0);
    ctx.setBusy(false);
    await delay(1300);
    assert.equal(responses, 1);
    await delay(1200);
    assert.equal(manager.inConversation(), true, 'a response in progress must not be interrupted');
    release();
    await delay(80);
    assert.equal(manager.inConversation(), false, 'a silent action response should release both goals');
    assert.equal(ctx.sent.at(-1).packet.end, true);
    assert.equal(ctx.resumes(), 1);
    await cleanup();
});
