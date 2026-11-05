# Apple App Store, tvOS (pairux.com)

Not built yet.

**What it takes:** a separate tvOS target (tvOS has **no WKWebView** — this is
the one platform where the web app cannot simply be wrapped, and the screens
have to be built natively in SwiftUI or UIKit against the same API the web app
uses), plus the same Apple Developer membership and signing as `../ios`.

**Before the first upload**
- tvOS apps are driven by the Siri Remote: focus engine first, no pointer, no
  keyboard beyond the on-screen one.
- The top shelf image and the layered app icon are required and are unlike any
  other store's art.
