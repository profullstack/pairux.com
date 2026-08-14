import type { ExpoConfig, ConfigContext } from 'expo/config';

const easProjectId = process.env.EAS_PROJECT_ID?.trim();
const pairuxApiUrl = process.env.PAIRUX_API_URL?.trim();
const easBuildProfile = process.env.EAS_BUILD_PROFILE?.trim();

if (easBuildProfile && !easProjectId) {
  throw new Error(
    `EAS_PROJECT_ID is required for the PairUX mobile EAS build profile "${easBuildProfile}".`
  );
}

if (easBuildProfile && !pairuxApiUrl) {
  throw new Error(
    `PAIRUX_API_URL is required for the PairUX mobile EAS build profile "${easBuildProfile}".`
  );
}

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: 'PairUX',
  slug: 'pairux',
  scheme: 'pairux',
  version: '0.1.0',
  orientation: 'portrait',
  icon: './assets/icon.png',
  userInterfaceStyle: 'automatic',
  newArchEnabled: false,
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
    blockedPermissions: ['android.permission.CAMERA', 'android.permission.SYSTEM_ALERT_WINDOW'],
  },
  plugins: [
    'expo-router',
    'expo-secure-store',
    // Expo runs Info.plist mods in reverse plugin order, so this must strip camera last.
    './plugins/with-webrtc-screen-capture',
    [
      '@config-plugins/react-native-webrtc',
      {
        microphonePermission: 'PairUX needs microphone access for voice chat during sessions.',
      },
    ],
  ],
  extra: {
    PAIRUX_API_URL: pairuxApiUrl,
    ...(easProjectId ? { eas: { projectId: easProjectId } } : {}),
  },
  experiments: {
    typedRoutes: true,
  },
});
