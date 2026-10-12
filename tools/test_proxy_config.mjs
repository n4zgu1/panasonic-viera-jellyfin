import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { loadConfig, validateConfig, proxyOrigin } from './proxy_config.mjs';
import { createProxy } from './jellyfin_proxy.mjs';
import { once } from 'node:events';
import http from 'node:http';
import net from 'node:net';
import { spawn } from 'node:child_process';

const fixture = { bind: '192.0.2.10', tv: '192.0.2.20', upstream: 'http://192.0.2.30:8096' };

test('configuration is portable across LANs and automatic login is optional', () => {
  const c = validateConfig(fixture);
  assert.equal(c.port, 8765);
  assert.equal(c.testAccount, null);
  assert.equal(proxyOrigin(c), 'http://192.0.2.10:8765');
  assert.equal(validateConfig({ ...fixture, bind: '10.0.0.2', tv: '10.0.0.3', port: 8088 }).bind, '10.0.0.2');
  const account = { Username: 'fixture-account', Pw: 'synthetic-secret', extra: 'do not forward' };
  assert.deepEqual(validateConfig({ ...fixture, testAccount: account }).testAccount,
    { Username: 'fixture-account', Pw: 'synthetic-secret' });
});

test('invalid bind, port, upstream credentials and account shape fail before listening', () => {
  for (const update of [{ bind: '0.0.0.0' }, { tv: 'not-an-ip' }, { port: 0 }, { port: 65536 },
    { upstream: 'http://user:secret@example.invalid/' }, { upstream: 'http://example.invalid/subpath' },
    { testAccount: { Username: 'fixture-account' } }]) {
    assert.throws(() => validateConfig({ ...fixture, ...update }));
  }
});

test('configuration parse errors do not echo private file contents', () => {
  const dir = mkdtempSync('work/config-test-');
  try {
    const path = join(dir, 'local.json');
    writeFileSync(path, '{ "testAccount": "sensitive-config-marker", }');
    assert.throws(() => loadConfig(path), e => e.message === 'Local configuration is not valid JSON');
    writeFileSync(path, JSON.stringify(fixture));
    assert.equal(loadConfig(path).tv, fixture.tv);
  } finally { rmSync(dir, { recursive: true }); }
});

test('unconfigured automatic login never contacts an upstream or uses baked-in credentials', async () => {
  const server = createProxy({ upstream: 'http://127.0.0.1:1', allowed: ['127.0.0.1'], tv: '192.0.2.20' });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  try {
    const status = await new Promise((resolve, reject) => {
      const request = http.request({ hostname: '127.0.0.1', port: server.address().port, path: '/viera/test-login', method: 'POST' }, response => {
        response.resume(); response.on('end', () => resolve(response.statusCode));
      });
      request.on('error', reject); request.end();
    });
    assert.equal(status, 503);
  } finally { server.stop(); }
});

test('CLI loads local settings but writes no account credentials to run metadata', { timeout: 10000 }, async () => {
  const directory = mkdtempSync('work/cli-config-test-');
  const reserved = net.createServer(); reserved.listen(0, '127.0.0.1'); await once(reserved, 'listening');
  const port = reserved.address().port; reserved.close(); await once(reserved, 'close');
  const configPath = join(directory, 'local.json'), output = join(directory, 'run');
  const secret = 'synthetic-cli-secret-marker';
  writeFileSync(configPath, JSON.stringify({ ...fixture, bind: '127.0.0.1', port,
    upstream: 'http://127.0.0.1:1', testAccount: { Username: 'fixture-account', Pw: secret } }));
  const child = spawn(process.execPath, ['tools/jellyfin_proxy.mjs', '--config', configPath, '--output', output], { stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '', stderr = '';
  try {
    await new Promise((resolve, reject) => {
      child.stdout.on('data', data => { stdout += data; if (stdout.includes('Own client:')) resolve(); });
      child.stderr.on('data', data => { stderr += data; });
      child.once('error', reject);
      child.once('exit', () => reject(new Error('Proxy exited before startup')));
    });
    const metadata = readFileSync(join(output, 'config.json'), 'utf8');
    assert.equal(JSON.parse(metadata).autoLoginConfigured, true);
    assert.equal(JSON.parse(metadata).port, port);
    assert.equal(JSON.parse(metadata).testAccount, undefined);
    assert.equal((metadata + stdout + stderr).includes(secret), false);
    assert.equal((metadata + stdout + stderr).includes('fixture-account'), false);
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = once(child, 'exit'); child.kill('SIGTERM'); await exited;
    }
    rmSync(directory, { recursive: true });
  }
});
