import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

type ApplyWebRTCScreenCapture = (contents: string, language: 'java' | 'kt') => string;
type RemoveUnusedCameraUsageDescription = (
  infoPlist: Record<string, unknown>
) => Record<string, unknown>;

const require = createRequire(import.meta.url);
const { applyWebRTCScreenCapture, removeUnusedCameraUsageDescription } =
  require('../../plugins/with-webrtc-screen-capture') as {
    applyWebRTCScreenCapture: ApplyWebRTCScreenCapture;
    removeUnusedCameraUsageDescription: RemoveUnusedCameraUsageDescription;
  };

describe('with-webrtc-screen-capture', () => {
  it('enables the media projection service in a Kotlin application', () => {
    const source = `package com.pairux.mobile

import android.app.Application

class MainApplication : Application() {
  override fun onCreate() {
    super.onCreate()
  }
}
`;

    const result = applyWebRTCScreenCapture(source, 'kt');

    expect(result).toContain('import com.oney.WebRTCModule.WebRTCModuleOptions');
    expect(result).toContain(
      'WebRTCModuleOptions.getInstance().enableMediaProjectionService = true'
    );
  });

  it('supports Java applications with Java syntax', () => {
    const source = `package com.pairux.mobile;

import android.app.Application;

public class MainApplication extends Application {
  @Override
  public void onCreate() {
    super.onCreate();
  }
}
`;

    const result = applyWebRTCScreenCapture(source, 'java');

    expect(result).toContain('import com.oney.WebRTCModule.WebRTCModuleOptions;');
    expect(result).toContain(
      'WebRTCModuleOptions.getInstance().enableMediaProjectionService = true;'
    );
  });

  it('is idempotent across repeated prebuilds', () => {
    const source = `package com.pairux.mobile

import android.app.Application

class MainApplication : Application() {
  override fun onCreate() {
    super.onCreate()
  }
}
`;

    const once = applyWebRTCScreenCapture(source, 'kt');
    const twice = applyWebRTCScreenCapture(once, 'kt');

    expect(twice).toBe(once);
    expect(twice.match(/enableMediaProjectionService/g)).toHaveLength(1);
  });

  it('removes the unused iOS camera prompt without changing required capabilities', () => {
    const infoPlist = {
      NSCameraUsageDescription: 'Allow PairUX to access your camera.',
      NSMicrophoneUsageDescription: 'PairUX needs microphone access for voice chat.',
      UIBackgroundModes: ['voip'],
    };

    expect(removeUnusedCameraUsageDescription(infoPlist)).toEqual({
      NSMicrophoneUsageDescription: 'PairUX needs microphone access for voice chat.',
      UIBackgroundModes: ['voip'],
    });
    expect(infoPlist).toHaveProperty('NSCameraUsageDescription');
  });
});
