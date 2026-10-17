import { APP_VERSION } from '@bf/shared';
import { loadConfig, lanAddresses } from './config.js';
import { logger } from './logger.js';
import { startServer } from './server.js';

const log = logger('main');

async function main() {
  const config = loadConfig();
  let server;
  try {
    server = await startServer(config);
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (e.code === 'EADDRINUSE') log.error(`Port ${config.port} is already in use. Set PORT=xxxx (or --port xxxx) to use another port.`);
    else log.error('Failed to start', err);
    process.exit(1);
  }

  const lines = [
    '',
    `  BroadcastForge Studio ${APP_VERSION}${config.dev ? ' (development)' : ''}`,
    `  Dashboard:   http://localhost:${server.port}`,
  ];
  if (config.host === '0.0.0.0' || config.host === '::') {
    for (const ip of lanAddresses()) lines.push(`  Network:     http://${ip}:${server.port}   (remote devices must pair: Settings → Remote access)`);
  } else {
    lines.push('  Network:     off (local only). Start with --lan to allow tablets/phones on your network.');
  }
  lines.push(`  Data folder: ${config.dataDir}`, '');
  console.log(lines.join('\n'));

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    log.info(`${signal} received, saving and shutting down…`);
    const force = setTimeout(() => process.exit(1), 5000);
    force.unref();
    try {
      await server.close();
    } finally {
      process.exit(0);
    }
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('unhandledRejection', (err) => log.error('Unhandled rejection', err));
}

void main();
