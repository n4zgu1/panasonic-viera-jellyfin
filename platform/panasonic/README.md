# Panasonic IPTV HTML5 application preparation

Target: owned Panasonic TX-42ASW504, Viera Connect, firmware 3.073.

The recovered Panasonic HTML5 v2.0 guide describes an application entry
`sdkhtml/main.html` with adjacent `init.json`. The developer tool historically
loads `http://192.168.0.100/sdkhtml/main.html` or
`http://localserver.vieraconnect.com/sdkhtml/main.html`, after developer login.
This project does not change the household network or DNS to supply those addresses.

Build locally:

```sh
python3 tools/build_panasonic_app.py --output work/panasonic-html5-0.3
```

The build contains the application's own HTML/CSS/ES5, browser configuration,
generated artwork and file hashes. The ZIP is a transport/source bundle, **not a
verified Panasonic sideload/install package**. No firmware, device credentials,
Jellyfin credentials, session tokens, vendor product ID or signing key is included.

Requirements to run it as a registered Panasonic application:

1. An available and authorized HTML5 developer launcher, or publisher/market
   registration of the application's hosted URL.
2. This platform must accept the documented HTML5 v2.0 configuration. That has not
   yet been verified on this model's app runtime; the normal browser is different.
3. The application origin must also forward Jellyfin API/stream requests. In this
   project the Mac proxy supplies that service through Tailscale. Relative resource
   paths allow the same source to be hosted under `sdkhtml/`.

Version 0.3 automatically signs in using the test account explicitly configured by
the owner in the Mac proxy. `/viera/test-login` must be served on the application
origin for this convenience flow. The credentials are in the local proxy source,
not in this static source bundle; session tokens remain in browser memory.

Published Viera apps were documented as hosted applications with market approval,
not arbitrary APKs or USB-installed ZIPs. `init.json` is a browser configuration,
not an installer manifest and does not itself grant app registration or privileges.

The official developer portal currently fails DNS resolution from this environment
and a public resolver. The absence of the developer app in the captured installed
app list does not prove that it is unavailable in the TV's market. See
`results/INSTALLATION.md` for the remaining gate and sources.

The submission guide also asks for screenshots and developer/account information.
No TV screenshots or publisher identity have been fabricated, no terms accepted,
and no submission has been made. Generated icons are original project artwork.
