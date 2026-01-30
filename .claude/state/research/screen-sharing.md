# Screen Sharing Methods for Headless Mac

## Use Case
BMO needs to share screen/browser with Dave for verification checks, CAPTCHAs, visual confirmation. Dave should join from mobile or desktop via a simple link.

## Top 3 Recommendations

### #1: Cloudflare Tunnel + VNC Browser Rendering (RECOMMENDED)
- **Already have** the Cloudflare tunnel and domain (playplan.app)
- Cloudflare renders VNC in-browser at the edge - zero install for Dave
- Add route: `vnc.playplan.app` -> `tcp://localhost:5900`
- Cloudflare Access for auth (Zero Trust, free tier)
- Needs: VNC server on Mac + virtual display (BetterDisplay or HDMI dummy plug)
- **Cost: Free**

### #2: Browserbase (Session Live View)
- Cloud browser platform designed for AI agents
- Creates shareable Live View URLs - Dave taps link on phone
- No headless display problem (browser runs in their cloud)
- Perfect for CAPTCHAs and login flows
- **Cost: Free tier 1hr/month, $39/mo for 200hrs**

### #3: Cloudflare Tunnel + noVNC (fallback)
- Manual version of #1 if Cloudflare's native VNC rendering has protocol issues
- Run noVNC + websockify locally, expose via tunnel
- Same result for Dave (URL in browser = VNC)
- **Cost: Free**

## Headless Display Solutions (needed for VNC-based approaches)
1. **HDMI dummy plug** (~$8 Amazon) - most reliable
2. **BetterDisplay** (`brew install --cask betterdisplay`) - software virtual display
3. macOS built-in (less documented)

## Other Options Researched
- Apache Guacamole: overkill, needs Docker
- Chrome Remote Debugging: developer-focused, not user-friendly
- RustDesk: headless issues
- TeamViewer/AnyDesk: works but proprietary, needs dummy plug
- Tailscale + VNC: great security but Dave needs VNC app (not browser-only)
