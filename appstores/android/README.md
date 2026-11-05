# Google Play (pairux.com)

Not built yet.

**What it takes:** an Android app (the Fire TV shell in `../firetv` is already a
plain Android app and is the obvious starting point — same WebView, same
`tv.js`, minus the leanback intent filter and plus a phone layout), a Play
Console developer account, an upload key, and a Play App Signing enrolment.

**Before the first upload**
- Play requires an **App Bundle** (`.aab`), not an APK, and a `targetSdk` that
  meets Play's current floor. The Fire TV build targets 34 for Fire OS; Play
  moves its floor every August, so check it rather than assuming.
- `applicationId` must differ from nothing else on Play, and once published it
  can never change.
- Play wants a privacy policy URL, a Data safety form, and content rating
  answers — the same facts as the Amazon listing, asked differently.
- The listing copy and art in `../firetv/store` mostly carries over; Play's
  screenshot sizes and the 1024x500 feature graphic do not.
