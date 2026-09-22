// Execute the installed JS permission/acquisition chain, not a getUserMedia mock.
// Native bridge calls remain doubles: this is not a device permission-dialog test.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';
import { microphoneFailure } from './microphone';

const packageRoot = dirname(
  createRequire(import.meta.url).resolve('react-native-webrtc/package.json')
);

function fixture(platform: 'ios' | 'android', format: 'src' | 'lib/commonjs' | 'lib/module') {
  const bridge = {
    requestPermission: vi.fn(async () => true),
    getUserMedia: vi.fn((_constraints: unknown, success: (id: string, tracks: unknown[]) => void) =>
      success('local-stream', [])
    ),
  };
  const android = {
    request: vi.fn(async () => 'granted'),
    PERMISSIONS: { CAMERA: 'camera', RECORD_AUDIO: 'microphone' },
    RESULTS: { GRANTED: 'granted' },
  };
  const modules: Record<string, unknown> = {
    'react-native': {
      NativeModules: { WebRTCModule: bridge },
      Platform: { OS: platform },
      PermissionsAndroid: android,
    },
    './RTCUtil': {
      normalizeConstraints: (value: unknown) => structuredClone(value),
      deepClone: (value: unknown) => structuredClone(value),
    },
    './MediaStream': {
      default: class {
        constructor(readonly info: unknown) {}
      },
      __esModule: true,
    },
  };
  const load = (name: string) => {
    const extension = format === 'src' ? 'ts' : 'js';
    const source = readFileSync(join(packageRoot, format, `${name}.${extension}`), 'utf8');
    const code = ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        esModuleInterop: true,
      },
    }).outputText;
    const module = { exports: {} as Record<string, unknown> };
    runInNewContext(
      code,
      {
        module,
        exports: module.exports,
        require: (key: string) => {
          if (!(key in modules)) throw new Error(`Unexpected dependency: ${key}`);
          return modules[key];
        },
      },
      { filename: `${name}.ts` }
    );
    modules[`./${name}`] = module.exports;
    return module.exports;
  };
  load('Permissions');
  load('MediaStreamError');
  const getUserMedia = load('getUserMedia').default as (constraints: {
    audio: boolean;
    video: boolean;
  }) => Promise<unknown>;
  return { bridge, android, getUserMedia };
}

async function outcome(getUserMedia: ReturnType<typeof fixture>['getUserMedia']) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      getUserMedia({ audio: true, video: false }).then(
        (value) => ({ state: 'resolved', value }),
        (error: unknown) => ({ state: 'rejected', error })
      ),
      new Promise<{ state: string }>((resolve) => {
        timer = setTimeout(() => resolve({ state: 'pending' }), 100);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

describe.each(['src', 'lib/commonjs', 'lib/module'] as const)(
  'installed WebRTC permission contract: %s',
  (format) => {
    it.each(['ios', 'android'] as const)(
      'acquires only after permission on %s',
      async (platform) => {
        const f = fixture(platform, format);
        expect(await outcome(f.getUserMedia)).toMatchObject({ state: 'resolved' });
        expect(f.bridge.getUserMedia).toHaveBeenCalledOnce();
        expect(f.bridge.getUserMedia.mock.calls[0]?.[0]).toEqual({ audio: true });
      }
    );

    it.each(['ios', 'android'] as const)(
      'reports denial without invoking capture on %s',
      async (platform) => {
        const f = fixture(platform, format);
        f.bridge.requestPermission.mockResolvedValue(false);
        f.android.request.mockResolvedValue('denied');
        const result = await outcome(f.getUserMedia);
        expect(result).toMatchObject({
          state: 'rejected',
          error: { name: 'SecurityError', message: 'Permission denied.' },
        });
        expect(microphoneFailure('error' in result ? result.error : null)).toBe('permission');
        expect(f.bridge.getUserMedia).not.toHaveBeenCalled();
      }
    );

    it('does not hang or orphan a rejection when the iOS permission bridge fails', async () => {
      const f = fixture('ios', format);
      const error = new Error('native bridge unavailable');
      f.bridge.requestPermission.mockRejectedValue(error);
      expect(await outcome(f.getUserMedia)).toEqual({ state: 'rejected', error });
      expect(microphoneFailure(error)).toBe('unavailable');
      expect(f.bridge.getUserMedia).not.toHaveBeenCalled();
    });

    it('keeps Android request rejection as denial, per the installed adapter', async () => {
      const f = fixture('android', format);
      f.android.request.mockRejectedValue(new Error('native unavailable'));
      expect(await outcome(f.getUserMedia)).toMatchObject({
        state: 'rejected',
        error: { name: 'SecurityError' },
      });
      expect(f.bridge.getUserMedia).not.toHaveBeenCalled();
    });

    it.each(['ios', 'android'] as const)(
      'does not hang if starting capture throws on %s',
      async (platform) => {
        const f = fixture(platform, format);
        const error = new Error('capture unavailable');
        f.bridge.getUserMedia.mockImplementation(() => {
          throw error;
        });
        expect(await outcome(f.getUserMedia)).toEqual({ state: 'rejected', error });
      }
    );
  }
);
