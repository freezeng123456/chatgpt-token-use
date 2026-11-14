import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
const require = createRequire(import.meta.url);
const mineflayer = require('./mindcraft/node_modules/mineflayer');
const viewer = require('./mindcraft/node_modules/prismarine-viewer/lib/mineflayer.js');
const { Vec3 } = require('./mindcraft/node_modules/vec3');
if (process.env.CAMERA_VERSION_BRIDGE === '1') {
    require('./runtime/viewer-version-bridge.cjs').install();
    console.log('Spectator display translates 1.21.6 block states to 1.21.4 viewer states.');
}
let reconnectAttempts = 0;
function connectCamera() {
    const bot = mineflayer.createBot({host:'127.0.0.1', port:25586, username:'GardenCamera', version:'1.21.6', auth:'offline'});
    let initialized = false;
    bot.on('spawn', () => {
        if (initialized) return;
        initialized = true;
        reconnectAttempts = 0;
        viewer(bot, {host:'localhost', port:3002, firstPerson:false, viewDistance:4});
        console.log('Read-only garden camera connected; viewer on localhost:3002.');
        setTimeout(() => {
            if (bot._client.ended) return;
            const counts = {};
            let unavailable = 0;
            for (let x=-1; x<=9; x++) for (let z=31; z<=42; z++) for (let y=67; y<=68; y++) {
                const block = bot.blockAt(new Vec3(x,y,z));
                if (block) counts[block.name] = (counts[block.name] || 0) + 1;
                else unavailable++;
            }
            const report = {at:new Date().toISOString(), area:{x:[-1,9],y:[67,68],z:[31,42]}, counts, unavailable};
            writeFileSync(new URL('./garden-camera-blocks.json', import.meta.url), JSON.stringify(report,null,2)+'\n');
            console.log('Saved a read-only block count for the garden.');
        }, 12_000);
    });
    bot.on('error', err => console.error('Camera error:', err.message));
    bot.on('kicked', reason => console.error('Camera kicked:', String(reason)));
    bot.once('end', reason => {
        if (bot.viewer) bot.viewer.close();
        const delay = Math.min(30000, 5000 * 2 ** Math.min(reconnectAttempts++, 3));
        console.error(`Camera connection ended (${reason}); reconnecting in ${delay / 1000}s.`);
        setTimeout(connectCamera, delay);
    });
}
connectCamera();
