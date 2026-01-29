# macOS Code Signing & Notarization

PairUX desktop builds for macOS are automatically code-signed and notarized in CI when the required secrets are configured. This document covers setup and troubleshooting.

## Overview

Apple requires two steps for distributing macOS apps outside the App Store:

1. **Code Signing** — cryptographically signs the app with a Developer ID certificate
2. **Notarization** — submits the signed app to Apple for automated security checks; Apple staples a ticket that tells Gatekeeper the app is safe

Without both steps, users see Gatekeeper warnings or the app may refuse to launch (especially on macOS Sequoia+).

## Prerequisites

- **Apple Developer Program** membership ($99/year) — https://developer.apple.com/programs/
- **A Mac** (needed once to export the signing certificate)

## GitHub Secrets

| Secret                        | Description                                                   |
| ----------------------------- | ------------------------------------------------------------- |
| `APPLE_CERTIFICATE`           | Base64-encoded `.p12` Developer ID Application certificate    |
| `APPLE_CERTIFICATE_PASSWORD`  | Password used when exporting the `.p12`                       |
| `KEYCHAIN_PASSWORD`           | Any random string (used to create a temporary keychain in CI) |
| `APPLE_ID`                    | Apple Developer account email                                 |
| `APPLE_APP_SPECIFIC_PASSWORD` | App-specific password for notarytool                          |
| `APPLE_TEAM_ID`               | 10-character Apple Developer Team ID                          |

Add these at: https://github.com/profullstack/pairux.com/settings/secrets/actions

## Setup Steps

### 1. Get your Team ID

1. Sign in at https://developer.apple.com/account
2. Go to **Membership details**
3. Copy the **Team ID** (10-character alphanumeric string)

### 2. Create an App-Specific Password

Apple blocks regular passwords for automated tools. Generate a dedicated one:

1. Go to https://account.apple.com/sign-in
2. Sign in with your Apple ID
3. Go to **Sign-In and Security** > **App-Specific Passwords**
4. Click **Generate an app-specific password**
5. Label it `pairux-notarize`
6. Copy the password (format: `xxxx-xxxx-xxxx-xxxx`)

### 3. Create a Developer ID Application Certificate

1. Open **Keychain Access** on your Mac
2. Go to **Keychain Access** > **Certificate Assistant** > **Request a Certificate from a Certificate Authority**
   - Enter your Apple ID email
   - Select **Saved to disk**
   - Save the `.certSigningRequest` file
3. Go to https://developer.apple.com/account/resources/certificates/list
4. Click **+** to create a new certificate
5. Select **Developer ID Application**
6. Upload the `.certSigningRequest` file
7. Download the generated `.cer` file
8. Double-click to install it into your keychain

### 4. Export as .p12

1. Open **Keychain Access**
2. Find the certificate under **My Certificates** (named "Developer ID Application: ...")
3. Right-click > **Export**
4. Save as `.p12` format
5. Set a strong password (this becomes `APPLE_CERTIFICATE_PASSWORD`)

### 5. Base64-encode the certificate

```bash
base64 -i certificate.p12 | pbcopy
```

The encoded string is now on your clipboard — paste it as the `APPLE_CERTIFICATE` secret.

### 6. Add all secrets to GitHub

Go to https://github.com/profullstack/pairux.com/settings/secrets/actions and add:

- `APPLE_CERTIFICATE` — the base64 string from step 5
- `APPLE_CERTIFICATE_PASSWORD` — the password from step 4
- `KEYCHAIN_PASSWORD` — any random string (e.g. `openssl rand -hex 16`)
- `APPLE_ID` — your Apple Developer email
- `APPLE_APP_SPECIFIC_PASSWORD` — from step 2
- `APPLE_TEAM_ID` — from step 1

## How It Works

The CI pipeline (`desktop-release.yml`) handles everything:

1. **Certificate import** — decodes the `.p12` from `APPLE_CERTIFICATE`, creates a temporary keychain, imports the cert
2. **Code signing** — `electron-builder` signs the `.app` bundle using the imported certificate with hardened runtime enabled
3. **Notarization** — the `afterSign` hook (`apps/desktop/scripts/notarize.cjs`) submits the signed app to Apple's notary service using `@electron/notarize`
4. **Stapling** — `@electron/notarize` automatically staples the notarization ticket to the app

The notarize hook checks for the presence of `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, and `APPLE_TEAM_ID`. If any are missing, it skips notarization with a log message — local dev builds and non-mac CI jobs are unaffected.

## Troubleshooting

### "Unable to find helper app" on macOS

This usually means the `.app` bundle was extracted incorrectly. The installer uses `ditto -xk` to preserve macOS file attributes. If someone extracted the ZIP manually with `unzip`, executable permissions on the Electron helper binaries get stripped.

Fix:

```bash
# Re-run the installer
curl -fsSL https://installer.pairux.com/install.sh | bash

# Or fix permissions on an existing install
xattr -cr /Applications/PairUX.app
chmod +x /Applications/PairUX.app/Contents/Frameworks/PairUX\ Helper*.app/Contents/MacOS/*
```

### Gatekeeper blocks the app

If the app isn't notarized, users see "Apple cannot check it for malicious software." Fix by setting up notarization (this document) or tell users to right-click > Open on first launch.

### Notarization fails in CI

Common causes:

- **Invalid credentials** — verify `APPLE_ID` and `APPLE_APP_SPECIFIC_PASSWORD` are correct
- **Certificate not trusted** — ensure you created a **Developer ID Application** certificate (not a development or distribution cert)
- **Hardened runtime issues** — check `apps/desktop/resources/entitlements.mac.plist` for missing entitlements
- **Apple service outage** — check https://developer.apple.com/system-status/

### Certificate expired

Developer ID Application certificates last 5 years. When it expires:

1. Create a new certificate (steps 3-5 above)
2. Update the `APPLE_CERTIFICATE` and `APPLE_CERTIFICATE_PASSWORD` secrets

## Files

| File                                            | Purpose                                 |
| ----------------------------------------------- | --------------------------------------- |
| `apps/desktop/scripts/notarize.cjs`             | afterSign hook — notarizes the app      |
| `apps/desktop/electron-builder.yml`             | References the afterSign hook           |
| `apps/desktop/resources/entitlements.mac.plist` | Hardened runtime entitlements           |
| `.github/workflows/desktop-release.yml`         | CI pipeline with signing + notarization |
