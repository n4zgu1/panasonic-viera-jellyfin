import { readFileSync } from 'node:fs';
import { isIP } from 'node:net';

export function validateConfig(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Configuration must be an object');
  if (typeof value.bind !== 'string' || isIP(value.bind) !== 4 || value.bind === '0.0.0.0') throw new Error('bind must be the host LAN IPv4 address');
  if (typeof value.tv !== 'string' || isIP(value.tv) !== 4) throw new Error('tv must be the explicitly selected TV IPv4 address');
  const port = value.port === undefined ? 8765 : value.port;
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('port must be an integer from 1 to 65535');
  let upstream;
  try { upstream = new URL(value.upstream); } catch { throw new Error('upstream must be a valid HTTP origin'); }
  if (upstream.protocol !== 'http:' || upstream.pathname !== '/' || upstream.search || upstream.hash || upstream.username || upstream.password) {
    throw new Error('upstream must be an HTTP origin without a path or credentials');
  }
  const account = value.testAccount ?? null;
  if (account !== null && (typeof account !== 'object' || Array.isArray(account) ||
      typeof account.Username !== 'string' || !account.Username || typeof account.Pw !== 'string')) {
    throw new Error('testAccount must be null or contain Username and Pw strings');
  }
  return { bind: value.bind, port, tv: value.tv, upstream: upstream.origin,
    testAccount: account === null ? null : { Username: account.Username, Pw: account.Pw } };
}

export function loadConfig(path = process.env.VIERA_CONFIG || 'config/local.json') {
  let text;
  try { text = readFileSync(path, 'utf8'); }
  catch { throw new Error('Local configuration missing/unreadable. Copy config/example.json to config/local.json and edit it.'); }
  let value;
  try { value = JSON.parse(text); } catch { throw new Error('Local configuration is not valid JSON'); }
  return validateConfig(value);
}

export function proxyOrigin(config = loadConfig()) {
  return `http://${config.bind}:${config.port}`;
}
