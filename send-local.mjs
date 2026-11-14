import { io } from './mindcraft/node_modules/socket.io-client/build/esm/index.js';

const [agent, ...words] = process.argv.slice(2);
const message = words.join(' ');
if (!['RiverScout', 'StoneKeeper'].includes(agent) || !message) {
    throw new Error('Pass the local bot name and a message.');
}

const socket = io('http://localhost:18080', { reconnection: false });
const timer = setTimeout(() => {
    console.error('Both Minecraft bots were not available in time.');
    socket.disconnect();
    process.exitCode = 1;
}, 8000);

function sendWhenReady(agents) {
    if (!['RiverScout', 'StoneKeeper'].every(name => agents.some(bot => bot.name === name && bot.in_game))) {
        return;
    }
    clearTimeout(timer);
    socket.off('agents-status', sendWhenReady);
    socket.emit('send-message', agent, { from: 'LocalTester', message });
    setTimeout(() => socket.disconnect(), 400);
}

socket.on('agents-status', sendWhenReady);
