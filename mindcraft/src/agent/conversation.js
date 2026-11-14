import settings from './settings.js';
import { containsCommand } from './commands/index.js';
import { sendBotChatToServer } from './mindserver_proxy.js';

let agent;
let agent_names = [];
let agents_in_game = [];

class Conversation {
    constructor(name) {
        this.name = name;
        this.active = false;
        this.ignore_until_start = false;
        this.blocked = false;
        this.in_queue = [];
        this.inMessageTimer = null;
        this.processing = 0;
        this.lastActivity = Date.now();
    }

    reset() {
        clearTimeout(this.inMessageTimer);
        this.active = false;
        this.ignore_until_start = false;
        this.in_queue = [];
        this.inMessageTimer = null;
        this.lastActivity = Date.now();
    }

    end() {
        clearTimeout(this.inMessageTimer);
        this.active = false;
        this.ignore_until_start = true;
        this.inMessageTimer = null;
        const full_message = _compileInMessages(this);
        if (full_message.message.trim().length > 0)
            agent.history.add(this.name, full_message.message);
        // add the full queued messages to history, but don't respond

        if (agent.last_sender === this.name)
            agent.last_sender = null;
    }

    queue(message) {
        this.in_queue.push(message);
        this.lastActivity = Date.now();
    }
}

const WAIT_TIME_START = 30000;
class ConversationManager {
    constructor() {
        this.convos = {};
        this.activeConversation = null;
        this.awaiting_response = false;
        this.connection_timeout = null;
        this.wait_time_limit = WAIT_TIME_START;
        this.sendBotMessage = sendBotChatToServer;
    }

    initAgent(a) {
        agent = a;
    }

    _getConvo(name) {
        if (!this.convos[name])
            this.convos[name] = new Conversation(name);
        return this.convos[name];
    }

    _startMonitor() {
        clearInterval(this.connection_monitor);
        const initialWaitTime = settings.conversation_wait_ms ?? WAIT_TIME_START;
        this.wait_time_limit = initialWaitTime;
        let wait_time = 0;
        let last_time = Date.now();
        let idle_since = null;
        this.connection_monitor = setInterval(() => {
            if (!this.activeConversation) {
                this._stopMonitor();
                return; // will clean itself up
            }

            let delta = Date.now() - last_time;
            last_time = Date.now();
            let convo_partner = this.activeConversation.name;

            // A silent conversation must not leave both agents paused forever.
            // Do not expire a conversation while a response, action or queued message is running.
            const idleLimit = settings.conversation_idle_timeout_ms;
            if (Number.isFinite(idleLimit) && idleLimit > 0) {
                const convo = this.activeConversation;
                if (!agent.isIdle() || convo.processing || convo.inMessageTimer || convo.in_queue.length) {
                    idle_since = null;
                } else {
                    idle_since ??= last_time;
                    if (last_time - Math.max(idle_since, convo.lastActivity) >= idleLimit) {
                        console.log(`${agent.name} ended an idle conversation with ${convo_partner} and will continue the goal.`);
                        this.finishConversation(convo_partner, 'I will continue working and check back later.');
                        return;
                    }
                }
            }

            if (this.awaiting_response && agent.isIdle()) {
                wait_time += delta;
                if (wait_time > this.wait_time_limit) {
                    agent.handleMessage('system', `${convo_partner} hasn't responded in ${this.wait_time_limit/1000} seconds, respond with a message to them or your own action.`);
                    wait_time = 0;
                    this.wait_time_limit*=2;
                }
            }
            else if (!this.awaiting_response){
                this.wait_time_limit = initialWaitTime;
                wait_time = 0;
            }

            if (!this.otherAgentInGame(convo_partner) && !this.connection_timeout) {
                this.connection_timeout = setTimeout(() => {
                    if (this.otherAgentInGame(convo_partner)){
                        this._clearMonitorTimeouts();
                        return;
                    }
                    if (!agent.self_prompter.isPaused()) {
                        this.endConversation(convo_partner);
                        agent.handleMessage('system', `${convo_partner} disconnected, conversation has ended.`);
                    }
                    else {
                        this.endConversation(convo_partner);
                    }
                }, 10000);
            }
        }, 1000);
    }

    _stopMonitor() {
        clearInterval(this.connection_monitor);
        this.connection_monitor = null;
        this._clearMonitorTimeouts();
    }

    _clearMonitorTimeouts() {
        this.awaiting_response = false;
        clearTimeout(this.connection_timeout);
        this.connection_timeout = null;
    }

    async startConversation(send_to, message) {
        const convo = this._getConvo(send_to);
        convo.reset();
        
        if (agent.self_prompter.isActive()) {
            await agent.self_prompter.pause(false);
        }
        if (convo.active)
            return;
        convo.active = true;
        this.activeConversation = convo;
        this._startMonitor();
        this.sendToBot(send_to, message, true, false);
    }

    startConversationFromOtherBot(name) {
        const convo = this._getConvo(name);
        convo.active = true;
        this.activeConversation = convo;
        this._startMonitor();
    }

    sendToBot(send_to, message, start=false, open_chat=true, end=false) {
        if (!this.isOtherAgent(send_to)) {
            console.warn(`${agent.name} tried to send bot message to non-bot ${send_to}`);
            return;
        }
        const convo = this._getConvo(send_to);
        
        if (settings.chat_bot_messages && open_chat)
            agent.openChat(`(To ${send_to}) ${message}`);
        
        if (convo.ignore_until_start)
            return;
        convo.active = true;
        
        const json = {
            'message': message,
            start,
            end: end || message.includes('!endConversation'),
        };

        this.awaiting_response = true;
        convo.lastActivity = Date.now();
        this.sendBotMessage(send_to, json);
    }

    async receiveFromBot(sender, received) {
        const convo = this._getConvo(sender);

        if (convo.ignore_until_start && !received.start)
            return;

        // check if any convo is active besides the sender
        if (this.inConversation() && !this.inConversation(sender)) {
            this.sendToBot(sender, `I'm talking to someone else, try again later. !endConversation("${sender}")`, false, false);
            this.endConversation(sender);
            return;
        }

        if (received.start) {
            convo.reset();
            this.startConversationFromOtherBot(sender);
        }

        this._clearMonitorTimeouts();
        convo.queue(received);
        
        // responding to conversation takes priority over self prompting
        if (!received.end && agent.self_prompter.isActive()){
            await agent.self_prompter.pause(false);
        }
    
        _scheduleProcessInMessage(sender, received, convo);
    }

    responseScheduledFor(sender) {
        if (!this.isOtherAgent(sender) || !this.inConversation(sender))
            return false;
        const convo = this._getConvo(sender);
        return !!convo.inMessageTimer;
    }

    isOtherAgent(name) {
        return agent_names.some((n) => n === name);
    }

    otherAgentInGame(name) {
        return agents_in_game.some((n) => n === name);
    }
    
    updateAgents(agents) {
        agent_names = agents.map(a => a.name);
        agents_in_game = agents.filter(a => a.in_game).map(a => a.name);
    }

    getInGameAgents() {
        return agents_in_game;
    }
    
    inConversation(other_agent=null) {
        if (other_agent)
            return this.convos[other_agent]?.active;
        return Object.values(this.convos).some(c => c.active);
    }
    
    endConversation(sender) {
        if (this.convos[sender]) {
            this.convos[sender].end();
            if (this.activeConversation?.name === sender) {
                this._stopMonitor();
                this.activeConversation = null;
                if (agent.self_prompter.isPaused() && !this.inConversation()) {
                    _resumeSelfPrompter();
                }
            }
        }
    }

    finishConversation(sender, message='I will continue working and check back later.') {
        if (!this.inConversation(sender)) return;
        this.sendToBot(sender, message, false, false, true);
        this.endConversation(sender);
    }
    
    endAllConversations() {
        for (const sender in this.convos) {
            this.endConversation(sender);
        }
        if (agent.self_prompter.isPaused()) {
            _resumeSelfPrompter();
        }
    }

    forceEndCurrentConversation() {
        if (this.activeConversation) {
            let sender = this.activeConversation.name;
            this.finishConversation(sender);
        }
    }
}

const convoManager = new ConversationManager();
export default convoManager;

/*
Queue incoming messages until the current action and response have finished,
except for long-running actions explicitly marked safe to talk over. New
messages received during the delay are combined into a single response.
*/
const talkOverActions = ['stay', 'followPlayer', 'mode:']; // all mode actions
const fastDelay = 200;
const longDelay = 5000;
async function _scheduleProcessInMessage(sender, received, convo) {
    if (convo.inMessageTimer)
        clearTimeout(convo.inMessageTimer);
    let otherAgentBusy = containsCommand(received.message);

    const scheduleResponse = (delay) => convo.inMessageTimer = setTimeout(() => _processInMessageQueue(sender), delay);
    const scheduleWhenIdle = () => {
        if (!convo.active || convo.ignore_until_start) return;
        if (!agent.isIdle() || convo.processing) {
            convo.inMessageTimer = setTimeout(scheduleWhenIdle, 1000);
        } else {
            scheduleResponse(fastDelay);
        }
    };

    const canTalkOver = talkOverActions.some(a => agent.actions.currentActionLabel.includes(a));
    if (convo.processing || (!agent.isIdle() && !canTalkOver)) {
        scheduleWhenIdle();
        return;
    }

    if (otherAgentBusy)
        // other bot is busy but I'm not
        scheduleResponse(longDelay);
    else {
        // If an action cannot safely be interrupted, this runs only after it is idle.
        scheduleResponse(fastDelay);
    }
}

function _processInMessageQueue(name) {
    const convo = convoManager._getConvo(name);
    convo.inMessageTimer = null;
    if (!convo.active || convo.ignore_until_start || convo.in_queue.length === 0) return;
    _handleFullInMessage(name, _compileInMessages(convo));
}

function _compileInMessages(convo) {
    let pack = {};
    let full_message = '';
    while (convo.in_queue.length > 0) {
        pack = convo.in_queue.shift();
        full_message += pack.message;
    }
    pack.message = full_message;
    return pack;
}

async function _handleFullInMessage(sender, received) {
    console.log(`${agent.name} responding to "${received.message}" from ${sender}`);
    
    const convo = convoManager._getConvo(sender);
    convo.active = true;

    let message = _tagMessage(received.message);
    if (received.end) {
        convoManager.endConversation(sender);
        await agent.history.add('system', `Conversation with ${sender} ended with message: "${message}"`);
        return;
    }
    else if (received.start)
        agent.shut_up = false;
    convo.inMessageTimer = null;
    convo.processing++;
    try {
        await agent.handleMessage(sender, message);
    } finally {
        convo.processing--;
        convo.lastActivity = Date.now();
        if (settings.conversation_auto_end_when_silent && convo.active && !convoManager.awaiting_response &&
            !convo.inMessageTimer && convo.in_queue.length === 0 && convo.processing === 0) {
            console.log(`${agent.name} finished responding to ${sender} with actions and is resuming the goal.`);
            convoManager.finishConversation(sender);
        }
    }
}


function _tagMessage(message) {
    return "(FROM OTHER BOT)" + message;
}

async function _resumeSelfPrompter() {
    await new Promise(resolve => setTimeout(resolve, settings.conversation_resume_delay_ms ?? 5000));
    if (agent.self_prompter.isPaused() && !convoManager.inConversation()) {
        agent.self_prompter.start();
    }
}
