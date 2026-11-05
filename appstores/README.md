# appstores

One directory per store pairux.com ships to. Each holds the whole build for that
store: source, signing instructions, the art the listing needs, and the copy
that goes in the store's own fields.

| Directory | Store | State |
| --- | --- | --- |
| `firetv/` | Amazon Appstore (Fire TV) | built, submitted to Amazon |
| `android/` | Google Play | not built |
| `ios/` | Apple App Store (iPhone, iPad) | not built |
| `appletv/` | Apple App Store (tvOS) | not built |
| `roku/` | Roku Channel Store | not built |

The web app at https://pairux.com is the product; these are shells and native
builds that put it in front of people who look for apps in a store.

**Signing keys never live here.** Each build's key is in its own team vault
(`profullstack/<name>-<store>--signing`) and the build scripts read it from the
environment. Losing a key means that store's users can never update in place.
