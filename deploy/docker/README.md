# deploy/docker: copia de REFERENCIA de producción (Docker + Cloudflare Tunnel)

**La VPS no ejecuta estos archivos.** Ejecuta `/opt/theburgerhouse/deploy.sh` (y el resto de `/opt/theburgerhouse/*`, `/opt/traefik/*`), que son de root y se actualizan **a mano**. Si cambiás algo acá, aplicalo también en la VPS, y viceversa. Que no viva dentro del clon es a propósito: así un push no puede cambiar el script que el runner ejecuta con sudo.

| Archivo acá | En la VPS |
| --- | --- |
| `Dockerfile`, `.dockerignore`, `compose.yml`, `deploy.sh`, `backup.sh` | `/opt/theburgerhouse/` (el contexto de build es esa carpeta; el código está en `repo/`) |
| `nginx/default.conf`, `nginx/headers.conf` | `/opt/theburgerhouse/nginx/` (+ `maintenance.html` copiado de `deploy/nginx/maintenance/`) |
| `env.example`, `env.app.example` | `/opt/theburgerhouse/.env`, `.env.app` (modo 600, secretos reales) |
| `traefik/compose.yml`, `traefik/env.example` | `/opt/traefik/compose.yml`, `/opt/traefik/.env` (TUNNEL_TOKEN) |
| `host/*` | `/etc/cron.d/`, `/etc/logrotate.d/`, `/etc/sudoers.d/`, `/etc/docker/daemon.json`, `/etc/fail2ban/jail.local` |

La documentación completa de operación está en `/opt/theburgerhouse/README.md` de la VPS.
