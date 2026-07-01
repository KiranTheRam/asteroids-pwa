# Asteroids

A minimal, mobile-first PWA asteroids game — black & white vector art with pops of
color. Zero build step: plain HTML/CSS + ES modules and an HTML5 canvas.

**Modes:** Classic · Arcade (extra enemies, power-ups, modifiers, asteroid types —
all individually toggleable) · Planet (a Super Stardust-style spherical playfield).
**Controls:** on-screen dual pads (steer + fire/twin-stick aim) or a physical
**game controller** (Gamepad API). Permanent roguelite upgrades bought with minerals.

## Run with Docker

The app is a static site served by nginx. On your Linux server:

```bash
git clone https://github.com/KiranTheRam/<repo>.git asteroids
cd asteroids
docker compose up -d
```

Then open `http://<server-ip>:8080` and, on mobile, **Add to Home Screen**.

- Change the published port by editing the `ports` mapping in `docker-compose.yml`
  (e.g. `"9000:80"`).
- Update after a new registry image is published: `docker compose pull && docker compose up -d`.

### ⚠️ HTTPS is required for the full PWA (offline + install)

Service workers only run in a **secure context** — i.e. over **HTTPS** or via
`localhost`. Over a plain `http://<lan-ip>:8080` URL the game plays fine, but it
**won't install or work offline** because the browser refuses to register the
service worker.

To get installable/offline behavior, put the container behind a TLS-terminating
reverse proxy with a real domain, for example:

- **Caddy** (automatic Let's Encrypt): `yourgame.example.com { reverse_proxy asteroids:80 }`
- **Traefik** or **nginx-proxy + acme-companion**
- Cloudflare Tunnel

Point the proxy at this container's port 80 and browse the HTTPS URL.

## Development

Serve the folder over http(s)/localhost (service workers need this — `file://`
won't register the SW):

```bash
python3 -m http.server 8000    # then open http://localhost:8000
```

When you change assets, bump `CACHE_VERSION` in `sw.js` so clients pick up the new
build (the SW precaches the app shell for offline play).
