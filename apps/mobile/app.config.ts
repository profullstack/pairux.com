import type { ExpoConfig, ConfigContext } from 'expo/config';

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: 'PairUX',
  slug: 'pairux',
  scheme: 'pairux',
  version: '0.1.0',
  orientation: 'portrait',
  icon: './assets/icon.png',
  userInterfaceStyle: 'automatic',
  splash: {
    image: './assets/splash.png',
    resizeMode: 'contain',
    backgroundColor: '#0f172a',
  },
  ios: {
    bundleIdentifier: 'com.pairux.mobile',
    supportsTablet: true,
    infoPlist: {
      UIBackgroundModes: ['voip'],
      NSMicrophoneUsageDescription:
        'PairUX needs microphone access for voice chat during sessions.',
    },
  },
  android: {
    package: 'com.pairux.mobile',
    adaptiveIcon: {
      foregroundImage: './assets/adaptive-icon.png',
      backgroundColor: '#0f172a',
    },
    permissions: [
      'INTERNET',
      'RECORD_AUDIO',
      'FOREGROUND_SERVICE',
      'FOREGROUND_SERVICE_MEDIA_PROJECTION',
    ],
  },
  plugins: ['expo-router', 'expo-secure-store'],
  extra: {
    PAIRUX_API_URL: process.env.PAIRUX_API_URL,
    eas: {
      projectId: 'pairux-mobile',
    },
  },
  experiments: {
    typedRoutes: true,
  },
});
