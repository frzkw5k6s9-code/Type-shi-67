import { createApp } from './app.js';

const app = await createApp();
const addr = await app.listen();
console.log(`Barbero is running at ${app.cfg.publicOrigin ?? `http://${addr.address === '::1' ? 'localhost' : addr.address}:${addr.port}`}`);

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, async () => {
    await app.close();
    process.exit(0);
  });
}
