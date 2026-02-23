#!/usr/bin/env npx tsx

/**
 * PairUX TURN (coturn) setup helper
 *
 * Generates a coturn config that pins TURN to the public IP to avoid private
 * relay candidates on hosts with multiple interfaces (e.g. DigitalOcean).
 *
 * Can optionally apply the config locally (when run on the server as root) or
 * copy + apply it remotely over SSH.
 *
 * Examples:
 *   npx tsx scripts/setup-turn.ts --public-ip 143.198.96.161 --print-commands
 *   npx tsx scripts/setup-turn.ts --public-ip 143.198.96.161 --output /tmp/turnserver.conf
 *   sudo npx tsx scripts/setup-turn.ts --public-ip 143.198.96.161 --apply-local
 *   npx tsx scripts/setup-turn.ts --public-ip 143.198.96.161 --ssh-host ubuntu@turn.pairux.com --apply-remote
 */

import { parseArgs } from 'node:util';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import dotenv from 'dotenv';

dotenv.config();

interface Options {
  help: boolean;
  output: string;
  'public-ip'?: string;
  realm: string;
  username?: string;
  password?: string;
  'listening-port': number;
  'tls-listening-port': number;
  'min-port': number;
  'max-port': number;
  'tls-cert'?: string;
  'tls-key'?: string;
  'cli-password'?: string;
  'apply-local': boolean;
  'apply-remote': boolean;
  'ssh-host'?: string;
  'ssh-port'?: number;
  'remote-path': string;
  service: string;
  'print-commands': boolean;
  'allow-relay-tcp': boolean;
  'configure-ufw': boolean;
  'auto-tls': boolean;
  'auto-tls-email'?: string;
  'auto-tls-cert-dir': string;
}

function fail(message: string): never {
  console.error(`Error: ${message}`);
  process.exit(1);
}

function readEnvOrFileMaybe(value: string | undefined): string | undefined {
  if (!value) return undefined;
  if (value.startsWith('@')) {
    return readFileSync(value.slice(1), 'utf-8').trim();
  }
  return value;
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function defaultRealmFromTurnUrl(urlValue: string | undefined): string | undefined {
  if (!urlValue) return undefined;
  const match = /^turns?:([^:/?]+)(?::\d+)?/i.exec(urlValue);
  return match?.[1];
}

function parseOptions(): Options {
  const { values } = parseArgs({
    options: {
      help: { type: 'boolean', short: 'h', default: false },
      output: { type: 'string', default: './turnserver.conf.generated' },
      'public-ip': { type: 'string' },
      realm: { type: 'string' },
      username: { type: 'string' },
      password: { type: 'string' },
      'listening-port': { type: 'string', default: '3478' },
      'tls-listening-port': { type: 'string', default: '5349' },
      'min-port': { type: 'string', default: '49152' },
      'max-port': { type: 'string', default: '49252' },
      'tls-cert': { type: 'string' },
      'tls-key': { type: 'string' },
      'cli-password': { type: 'string' },
      'apply-local': { type: 'boolean', default: false },
      'apply-remote': { type: 'boolean', default: false },
      'ssh-host': { type: 'string' },
      'ssh-port': { type: 'string' },
      'remote-path': { type: 'string', default: '/etc/turnserver.conf' },
      service: { type: 'string', default: 'coturn' },
      'print-commands': { type: 'boolean', default: false },
      'allow-relay-tcp': { type: 'boolean', default: false },
      'configure-ufw': { type: 'boolean', default: false },
      'auto-tls': { type: 'boolean', default: false },
      'auto-tls-email': { type: 'string' },
      'auto-tls-cert-dir': { type: 'string', default: '/etc/turnserver/certs' },
    },
  });

  const envTurnUrl = process.env.TURN_SERVER_URL;
  const envRealm = defaultRealmFromTurnUrl(envTurnUrl);

  const realm = values.realm ?? envRealm ?? 'turn.pairux.com';
  const username = values.username ?? process.env.TURN_SERVER_USERNAME;
  const passwordRaw = values.password ?? process.env.TURN_SERVER_CREDENTIAL;
  const password = readEnvOrFileMaybe(passwordRaw);
  const cliPassword = readEnvOrFileMaybe(values['cli-password'] ?? process.env.TURN_CLI_PASSWORD);

  const toInt = (k: string, v: string | undefined): number => {
    const n = Number.parseInt(v ?? '', 10);
    if (!Number.isFinite(n)) fail(`Invalid numeric value for --${k}: ${v}`);
    return n;
  };

  return {
    help: Boolean(values.help),
    output: values.output,
    'public-ip': values['public-ip'],
    realm,
    username,
    password,
    'listening-port': toInt('listening-port', values['listening-port']),
    'tls-listening-port': toInt('tls-listening-port', values['tls-listening-port']),
    'min-port': toInt('min-port', values['min-port']),
    'max-port': toInt('max-port', values['max-port']),
    'tls-cert': values['tls-cert'],
    'tls-key': values['tls-key'],
    'cli-password': cliPassword,
    'apply-local': Boolean(values['apply-local']),
    'apply-remote': Boolean(values['apply-remote']),
    'ssh-host': values['ssh-host'],
    'ssh-port': values['ssh-port'] ? toInt('ssh-port', values['ssh-port']) : undefined,
    'remote-path': values['remote-path'],
    service: values.service,
    'print-commands': Boolean(values['print-commands']),
    'allow-relay-tcp': Boolean(values['allow-relay-tcp']),
    'configure-ufw': Boolean(values['configure-ufw']),
    'auto-tls': Boolean(values['auto-tls']),
    'auto-tls-email': values['auto-tls-email'],
    'auto-tls-cert-dir': values['auto-tls-cert-dir'],
  };
}

function showHelp(): void {
  console.log(`
PairUX TURN setup helper

Generates a coturn config that avoids private relay candidates by pinning
listener/relay addresses to your public IP.

Required:
  --public-ip <IP>            Public IP of turn.pairux.com

Optional:
  --realm <host>              Realm/hostname (default: derived from TURN_SERVER_URL or turn.pairux.com)
  --username <name>           TURN static user (default: TURN_SERVER_USERNAME)
  --password <secret|@file>   TURN static password (default: TURN_SERVER_CREDENTIAL)
  --min-port <n>              Relay min port (default: 49152)
  --max-port <n>              Relay max port (default: 49252)
  --tls-cert <path>           Enable TURNS with cert path
  --tls-key <path>            Enable TURNS with private key path
  --cli-password <value>      Optional coturn CLI password (avoids warning)
  --output <file>             Write generated config locally (default: ./turnserver.conf.generated)

Apply modes:
  --apply-local               Install config on local server (must run as root)
  --apply-remote              Copy config to remote server and install/restart via SSH
  --ssh-host <user@host>      Required with --apply-remote
  --ssh-port <n>              SSH port (default: 22)
  --remote-path <path>        Remote coturn config path (default: /etc/turnserver.conf)
  --service <name>            Systemd service (default: coturn)

Extras:
  --print-commands            Print recommended ufw/systemctl commands
  --allow-relay-tcp           Also print ufw rule for relay TCP range
  --configure-ufw             Apply ufw rules on remote/local host automatically
  --auto-tls                  Install/use certbot to issue Let's Encrypt cert for --realm
  --auto-tls-email <email>    Required with --auto-tls (Let's Encrypt registration)
  --auto-tls-cert-dir <path>  Where to copy cert/key for coturn readability (default: /etc/turnserver/certs)

Examples:
  npx tsx scripts/setup-turn.ts --public-ip 143.198.96.161 --print-commands
  sudo npx tsx scripts/setup-turn.ts --public-ip 143.198.96.161 --apply-local
  npx tsx scripts/setup-turn.ts --public-ip 143.198.96.161 --apply-remote --ssh-host ubuntu@turn.pairux.com
`);
}

function validateOptions(options: Options): void {
  if (!options['public-ip']) fail('Missing --public-ip');
  if (!options.username)
    fail('Missing TURN username. Pass --username or set TURN_SERVER_USERNAME.');
  if (!options.password)
    fail('Missing TURN password. Pass --password or set TURN_SERVER_CREDENTIAL.');
  if (options['min-port'] > options['max-port']) fail('--min-port must be <= --max-port');
  if (
    (options['tls-cert'] && !options['tls-key']) ||
    (!options['tls-cert'] && options['tls-key'])
  ) {
    fail('Provide both --tls-cert and --tls-key together');
  }
  if (options['apply-remote'] && !options['ssh-host']) fail('--apply-remote requires --ssh-host');
  if (options['apply-local'] && options['apply-remote']) {
    fail('Use either --apply-local or --apply-remote, not both');
  }
  if (options['auto-tls'] && !options['auto-tls-email']) {
    fail('--auto-tls requires --auto-tls-email');
  }
}

function buildTurnConfig(options: Options): string {
  const lines: string[] = [
    '# Generated by scripts/setup-turn.ts',
    '# PairUX coturn config',
    '',
    `realm=${options.realm}`,
    'fingerprint',
    'lt-cred-mech',
    `user=${options.username}:${options.password}`,
    '',
    `listening-port=${options['listening-port']}`,
    `listening-ip=${options['public-ip']!}`,
    `relay-ip=${options['public-ip']!}`,
    `external-ip=${options['public-ip']!}`,
    '',
    `min-port=${options['min-port']}`,
    `max-port=${options['max-port']}`,
    '',
    'no-multicast-peers',
    '',
  ];

  if (options['cli-password']) {
    lines.push(`cli-password=${options['cli-password']}`, '');
  }

  if (options['tls-cert'] && options['tls-key']) {
    lines.push(
      `tls-listening-port=${options['tls-listening-port']}`,
      `cert=${options['tls-cert']}`,
      `pkey=${options['tls-key']}`,
      ''
    );
  } else {
    lines.push(
      '# TLS/TURNS is currently disabled (no cert/key provided)',
      `# tls-listening-port=${options['tls-listening-port']}`,
      '# cert=/etc/letsencrypt/live/turn.pairux.com/fullchain.pem',
      '# pkey=/etc/letsencrypt/live/turn.pairux.com/privkey.pem',
      ''
    );
  }

  lines.push(
    '# Optional hardening / logging (uncomment as needed)',
    '# no-loopback-peers',
    '# stale-nonce',
    '# no-tlsv1',
    '# no-tlsv1_1',
    '# log-file=/var/log/turnserver/turn.log',
    ''
  );

  return `${lines.join('\n')}\n`;
}

function printCommandBlock(options: Options): void {
  const min = options['min-port'];
  const max = options['max-port'];
  console.log('\nRecommended server commands:\n');
  console.log(`sudo ufw allow ${options['listening-port']}/tcp`);
  console.log(`sudo ufw allow ${options['listening-port']}/udp`);
  console.log(`sudo ufw allow ${options['tls-listening-port']}/tcp`);
  console.log(`sudo ufw allow ${min}:${max}/udp`);
  if (options['allow-relay-tcp']) {
    console.log(`sudo ufw allow ${min}:${max}/tcp`);
  }
  console.log(`sudo systemctl restart ${options.service}`);
  console.log(`sudo ss -lntup | grep -E ':(3478|5349)\\\\b'`);
  console.log(`sudo journalctl -u ${options.service} -n 100 --no-pager`);
}

function copyLetsEncryptCertsToCoturnLocal(options: Options): void {
  const certDir = options['auto-tls-cert-dir'];
  const realm = options.realm;
  const shellCmd = `
set -e
CERT_DIR="$(find /etc/letsencrypt/live -maxdepth 1 -type d -name '${realm}*' | sort | tail -n1)"
[ -n "$CERT_DIR" ] || { echo "No Let's Encrypt cert directory found for ${realm}" >&2; exit 1; }
[ -f "$CERT_DIR/fullchain.pem" ] && [ -f "$CERT_DIR/privkey.pem" ] || { echo "Missing fullchain.pem or privkey.pem in $CERT_DIR" >&2; exit 1; }
mkdir -p ${shellQuote(certDir)}
cp -L "$CERT_DIR/fullchain.pem" ${shellQuote(`${certDir}/fullchain.pem`)}
cp -L "$CERT_DIR/privkey.pem" ${shellQuote(`${certDir}/privkey.pem`)}
chown -R turnserver:turnserver ${shellQuote(certDir)}
chmod 644 ${shellQuote(`${certDir}/fullchain.pem`)}
chmod 640 ${shellQuote(`${certDir}/privkey.pem`)}
`;
  execFileSync('bash', ['-lc', shellCmd], { stdio: 'inherit' });
}

function applyLocal(options: Options, configPath: string): void {
  if (typeof process.getuid === 'function' && process.getuid() !== 0) {
    fail('--apply-local must be run as root (e.g. sudo npx tsx scripts/setup-turn.ts ...)');
  }

  const backupPath = `${options['remote-path']}.bak.${Date.now()}`;
  if (options['configure-ufw']) {
    const min = String(options['min-port']);
    const max = String(options['max-port']);
    execFileSync('ufw', ['allow', `${options['listening-port']}/tcp`], { stdio: 'inherit' });
    execFileSync('ufw', ['allow', `${options['listening-port']}/udp`], { stdio: 'inherit' });
    execFileSync('ufw', ['allow', `${options['tls-listening-port']}/tcp`], { stdio: 'inherit' });
    execFileSync('ufw', ['allow', `${min}:${max}/udp`], { stdio: 'inherit' });
    if (options['allow-relay-tcp']) {
      execFileSync('ufw', ['allow', `${min}:${max}/tcp`], { stdio: 'inherit' });
    }
  }

  if (options['auto-tls']) {
    const realm = options.realm;
    const email = options['auto-tls-email']!;
    execFileSync(
      'bash',
      ['-lc', 'command -v certbot >/dev/null || (apt-get update && apt-get install -y certbot)'],
      { stdio: 'inherit' }
    );
    execFileSync(
      'certbot',
      ['certonly', '--standalone', '--non-interactive', '--agree-tos', '-m', email, '-d', realm],
      { stdio: 'inherit' }
    );
    copyLetsEncryptCertsToCoturnLocal(options);
  }

  try {
    execFileSync('cp', ['-a', options['remote-path'], backupPath], { stdio: 'inherit' });
  } catch {
    console.warn(`Warning: could not back up ${options['remote-path']} (may not exist yet)`);
  }

  execFileSync('install', ['-m', '644', configPath, options['remote-path']], { stdio: 'inherit' });
  execFileSync('systemctl', ['restart', options.service], { stdio: 'inherit' });
  execFileSync('ss', ['-lntup'], { stdio: 'inherit' });
  execFileSync('systemctl', ['status', options.service, '--no-pager'], { stdio: 'inherit' });
}

function applyRemote(options: Options, configPath: string): void {
  const sshHost = options['ssh-host']!;
  const sshPort = String(options['ssh-port'] ?? 22);
  const remoteTmp = `/tmp/turnserver.conf.pairux.${Date.now()}`;
  const remotePathQ = shellQuote(options['remote-path']);
  const remoteTmpQ = shellQuote(remoteTmp);
  const serviceQ = shellQuote(options.service);
  const autoTlsCertDirQ = shellQuote(options['auto-tls-cert-dir']);

  execFileSync('scp', ['-P', sshPort, configPath, `${sshHost}:${remoteTmp}`], { stdio: 'inherit' });

  const remoteCmd = [
    `set -e`,
    ...(options['configure-ufw']
      ? [
          `sudo ufw allow ${options['listening-port']}/tcp`,
          `sudo ufw allow ${options['listening-port']}/udp`,
          `sudo ufw allow ${options['tls-listening-port']}/tcp`,
          `sudo ufw allow ${options['min-port']}:${options['max-port']}/udp`,
          ...(options['allow-relay-tcp']
            ? [`sudo ufw allow ${options['min-port']}:${options['max-port']}/tcp`]
            : []),
        ]
      : []),
    ...(options['auto-tls']
      ? [
          `if ! command -v certbot >/dev/null 2>&1; then sudo apt-get update && sudo apt-get install -y certbot; fi`,
          `sudo certbot certonly --standalone --non-interactive --agree-tos -m ${shellQuote(
            options['auto-tls-email']!
          )} -d ${shellQuote(options.realm)} || true`,
          `CERT_DIR="$(sudo find /etc/letsencrypt/live -maxdepth 1 -type d -name ${shellQuote(options.realm)}'*' | sort | tail -n1)"`,
          `if [ -z "$CERT_DIR" ]; then echo "No Let's Encrypt cert directory found for ${options.realm}" >&2; exit 1; fi`,
          `sudo test -f "$CERT_DIR/fullchain.pem"`,
          `sudo test -f "$CERT_DIR/privkey.pem"`,
          `sudo mkdir -p ${autoTlsCertDirQ}`,
          `sudo cp -L "$CERT_DIR/fullchain.pem" ${shellQuote(`${options['auto-tls-cert-dir']}/fullchain.pem`)}`,
          `sudo cp -L "$CERT_DIR/privkey.pem" ${shellQuote(`${options['auto-tls-cert-dir']}/privkey.pem`)}`,
          `sudo chown -R turnserver:turnserver ${autoTlsCertDirQ}`,
          `sudo chmod 644 ${shellQuote(`${options['auto-tls-cert-dir']}/fullchain.pem`)}`,
          `sudo chmod 640 ${shellQuote(`${options['auto-tls-cert-dir']}/privkey.pem`)}`,
        ]
      : []),
    `if [ -f ${remotePathQ} ]; then sudo cp -a ${remotePathQ} ${remotePathQ}.bak.$(date +%s); fi`,
    `sudo install -m 644 ${remoteTmpQ} ${remotePathQ}`,
    `rm -f ${remoteTmpQ}`,
    `sudo systemctl restart ${serviceQ}`,
    `sudo systemctl status ${serviceQ} --no-pager`,
    `sudo ss -lntup | grep -E ':(3478|5349)\\\\b' || true`,
    `sudo journalctl -u ${serviceQ} --since "2 minutes ago" --no-pager | grep -Ei 'tls|dtls|cert|pkey|warning|error' || true`,
  ].join('; ');

  execFileSync('ssh', ['-tt', '-p', sshPort, sshHost, remoteCmd], { stdio: 'inherit' });
}

function main(): void {
  const options = parseOptions();
  if (options.help) {
    showHelp();
    return;
  }

  validateOptions(options);
  if (options['auto-tls'] && !options['tls-cert'] && !options['tls-key']) {
    options['tls-cert'] = `${options['auto-tls-cert-dir']}/fullchain.pem`;
    options['tls-key'] = `${options['auto-tls-cert-dir']}/privkey.pem`;
  }

  const config = buildTurnConfig(options);

  writeFileSync(options.output, config, 'utf-8');
  console.log(`Generated coturn config: ${options.output}`);
  console.log(
    `Pinned listener/relay IP to ${options['public-ip']} and relay range ${options['min-port']}-${options['max-port']}`
  );

  if (options['print-commands']) {
    printCommandBlock(options);
  }

  if (options['apply-local'] || options['apply-remote']) {
    const tempDir = mkdtempSync(join(tmpdir(), 'pairux-turn-'));
    const tempConfig = join(tempDir, 'turnserver.conf');
    try {
      writeFileSync(tempConfig, config, 'utf-8');
      if (options['apply-local']) {
        applyLocal(options, tempConfig);
      } else {
        applyRemote(options, tempConfig);
      }
      console.log('TURN config applied successfully.');
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  } else {
    console.log('Config generated only (no remote changes made).');
  }
}

main();
