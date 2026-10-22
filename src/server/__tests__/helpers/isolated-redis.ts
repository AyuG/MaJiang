import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import Redis from 'ioredis';

/** Owns its process/data directory; never accepts a Redis URL or uses REDIS_URL. */
export class IsolatedRedis {
  constructor(private persistence: 'aof' | 'rdb' = 'aof') {}
  directory = '';
  socket = '';
  process?: ChildProcess;
  clients: Redis[] = [];

  async start(): Promise<void> {
    if (!this.directory) {
      // Keep the Unix socket pathname short enough for macOS.
      this.directory = await mkdtemp('/tmp/mjr-');
      this.socket = join(this.directory, 'redis.sock');
    }
    const binary = process.env.MJ_REDIS_SERVER;
    if (!binary) throw new Error('Set MJ_REDIS_SERVER to a local redis-server executable; no external Redis is used');
    const server = spawn(binary, [
      '--port', '0', '--unixsocket', this.socket, '--unixsocketperm', '700',
      '--dir', this.directory,
      ...(this.persistence === 'aof' ? ['--save', '', '--appendonly', 'yes', '--appendfsync', 'always'] : ['--appendonly', 'no']),
    ], { stdio: ['ignore', 'pipe', 'pipe'] });
    this.process = server;
    await new Promise<void>((resolve, reject) => {
      let output = '';
      const timeout = setTimeout(() => reject(new Error(`Redis startup timed out: ${output}`)), 10000);
      server.once('error', (error) => { clearTimeout(timeout); reject(error); });
      server.once('exit', (code) => { clearTimeout(timeout); reject(new Error(`Redis exited ${code}: ${output}`)); });
      const read = (chunk: Buffer) => {
        output += chunk.toString();
        if (output.includes('Ready to accept connections')) { clearTimeout(timeout); resolve(); }
      };
      server.stdout!.on('data', read);
      server.stderr!.on('data', read);
    });
  }

  client(): Redis {
    const client = new Redis(this.socket, { retryStrategy: () => null, maxRetriesPerRequest: 0 });
    client.on('error', () => { /* an intentional crash may close an in-flight connection */ });
    this.clients.push(client);
    return client;
  }

  async stop(signal: NodeJS.Signals = 'SIGTERM'): Promise<void> {
    for (const client of this.clients) client.disconnect();
    this.clients = [];
    const server = this.process;
    if (server && server.exitCode === null && server.signalCode === null) {
      const exit = once(server, 'exit');
      server.kill(signal);
      await exit;
    }
    this.process = undefined;
  }

  async cleanup(): Promise<void> {
    await this.stop();
    if (this.directory) await rm(this.directory, { recursive: true, force: true });
  }
}
