# Apple App Store (pairux.com)

Not built yet.

**What it takes:** an Xcode project (a WKWebView shell is the equivalent of the
Fire TV build), an Apple Developer Program membership, a signing certificate and
provisioning profile, and a Mac or a hosted macOS runner to build and notarise.

**Before the first upload**

- Apple rejects apps that are only a website in a shell unless they offer
  something a browser tab does not: offline, notifications, Handoff, widgets,
  share extensions. Guideline 4.2 is the one that catches these.
- An app that takes an account needs **Sign in with Apple** when it offers any
  other third-party sign-in, and a working account-deletion path inside the app.
- App Privacy answers are per data type and are published on the listing.
