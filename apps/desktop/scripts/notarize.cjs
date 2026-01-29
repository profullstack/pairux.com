/**
 * electron-builder afterSign hook — notarizes the macOS app bundle.
 *
 * Requires these environment variables (set in CI):
 *   APPLE_ID                    — Apple Developer account email
 *   APPLE_APP_SPECIFIC_PASSWORD — app-specific password for notarytool
 *   APPLE_TEAM_ID               — 10-char Apple Developer Team ID
 *
 * Skipped gracefully when the env vars are missing (local dev builds).
 */

const { notarize } = require('@electron/notarize');
const path = require('path');

module.exports = async function afterSign(context) {
  const { electronPlatformName, appOutDir } = context;

  if (electronPlatformName !== 'darwin') {
    return;
  }

  const appleId = process.env.APPLE_ID;
  const appleIdPassword = process.env.APPLE_APP_SPECIFIC_PASSWORD;
  const teamId = process.env.APPLE_TEAM_ID;

  if (!appleId || !appleIdPassword || !teamId) {
    console.log('Skipping notarization — APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, or APPLE_TEAM_ID not set');
    return;
  }

  const appName = context.packager.appInfo.productFilename;
  const appPath = path.join(appOutDir, `${appName}.app`);

  console.log(`Notarizing ${appPath} …`);

  await notarize({
    appPath,
    appleId,
    appleIdPassword,
    teamId,
  });

  console.log('Notarization complete');
};
