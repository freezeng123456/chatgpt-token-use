import settings from '../settings.js';
export async function addBrowserViewer(bot, count_id) {
    if (settings.render_bot_view) {
        const { default: mineflayerViewer } = await import('prismarine-viewer/lib/mineflayer.js');
        mineflayerViewer(bot, {
            host: 'localhost',
            port: 3000 + count_id,
            viewDistance: 4,
            firstPerson: count_id === 0
        });
    }
}
