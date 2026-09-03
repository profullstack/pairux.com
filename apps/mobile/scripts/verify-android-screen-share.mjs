import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, URL } from 'node:url';

const mobileRoot = fileURLToPath(new URL('..', import.meta.url));
const androidRoot = join(mobileRoot, 'android');
const manifestPath = join(androidRoot, 'app', 'src', 'main', 'AndroidManifest.xml');

function fail(message) {
  console.error(`Android screen-share verification failed: ${message}`);
  process.exit(1);
}

function findFile(root, names) {
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      const found = findFile(path, names);
      if (found) return found;
    } else if (names.has(entry.name)) {
      return path;
    }
  }
  return null;
}

if (!existsSync(manifestPath)) {
  fail('run Expo Android prebuild before this check');
}

const manifest = readFileSync(manifestPath, 'utf8');
const permissionTags = [...manifest.matchAll(/<uses-permission(?=[\s>])[^>]*\/?>/g)].map(
  ([tag]) => tag
);

function permissionEntries(name) {
  return permissionTags.filter((tag) => tag.includes(`android:name="${name}"`));
}

function expectActivePermission(name) {
  const active = permissionEntries(name).filter((tag) => !tag.includes('tools:node="remove"'));
  if (active.length !== 1) {
    fail(`${name} must appear exactly once as an active permission (found ${active.length})`);
  }
}

function expectBlockedPermission(name) {
  const entries = permissionEntries(name);
  const active = entries.filter((tag) => !tag.includes('tools:node="remove"'));
  const removals = entries.filter((tag) => tag.includes('tools:node="remove"'));
  if (active.length > 0 || removals.length !== 1) {
    fail(`${name} must be blocked exactly once and never requested`);
  }
}

for (const permission of [
  'android.permission.RECORD_AUDIO',
  'android.permission.POST_NOTIFICATIONS',
  'android.permission.FOREGROUND_SERVICE',
  'android.permission.FOREGROUND_SERVICE_MEDIA_PROJECTION',
]) {
  expectActivePermission(permission);
}

expectBlockedPermission('android.permission.CAMERA');
expectBlockedPermission('android.permission.SYSTEM_ALERT_WINDOW');

const javaRoot = join(androidRoot, 'app', 'src', 'main', 'java');
if (!existsSync(javaRoot)) {
  fail('generated Android Java/Kotlin source directory was not found');
}

const applicationPath = findFile(javaRoot, new Set(['MainApplication.kt', 'MainApplication.java']));
if (!applicationPath) {
  fail('generated MainApplication file was not found');
}

const application = readFileSync(applicationPath, 'utf8');
const enableCalls = application.match(/enableMediaProjectionService\s*=\s*true/g) || [];
if (enableCalls.length !== 1) {
  fail(`MediaProjection service must be enabled exactly once (found ${enableCalls.length})`);
}

console.log('Android screen-share manifest and native initialization are valid.');
