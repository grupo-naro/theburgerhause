# Runbook de operación: The Burger House 828 en la VPS (Contabo, Ubuntu)

Para la persona que administra el servidor. Se asume que sabés Linux básico (entrar por SSH, editar un archivo,
usar `sudo`), pero **no** que conocés este proyecto. Todos los comandos se pueden copiar y pegar.

## Cómo leer este documento

- Los valores que **tenés que reemplazar** están entre `<ESTOS_SIGNOS>` y en MAYÚSCULAS. Ejemplos:
  `<TU_DOMINIO>`, `<IP_DE_LA_VPS>`, `<TU_USUARIO>`, `<CLAVE_DB>`. Si dejás los signos `<` `>` el comando falla.
- `# comentario` es texto explicativo: no hace falta copiarlo.
- `$` indica un comando como usuario normal con `sudo`; si el comando empieza con `sudo`, te pide tu clave.
- Los archivos de configuración están en el repositorio, carpeta `deploy/`. Esta guía los llama "el repo".
- Documentos relacionados: protocolo de impresión `docs/ops/print-agent-protocol.md`, instalación de los agentes
  en las PCs `docs/ops/print-agent-install.md`, tiempo real (SSE) `docs/ops/realtime.md`.

Valores que se usan en toda la guía (anotalos en un lugar seguro, **no en el repo**):

| Valor | Ejemplo | Qué es |
| --- | --- | --- |
| `<TU_DOMINIO>` | `pedidos.tulocal.com.ar` | El nombre público del sistema |
| `<IP_DE_LA_VPS>` | `203.0.113.10` | La IP que te da Contabo |
| `<TU_USUARIO>` | `operador` | Tu usuario de administración en la VPS (no `root`) |
| `<TU_EMAIL>` | `dueno@tulocal.com.ar` | Para avisos de vencimiento del certificado |
| `<CLAVE_DB>` | (la generás en 2.8) | Clave de PostgreSQL del sistema |
| `<REPO_URL>` | `git@github.com:ORG/REPO.git` | Dónde está el código |

---

## 1. Arquitectura y puertos

```
 Internet (navegadores de clientes y del local, agentes de impresión)
        │  80 (redirige) / 443 (TLS, Let's Encrypt)
        ▼
 ┌───────────────────────────── VPS Contabo (Ubuntu) ─────────────────────────────┐
 │  ufw: solo permite 22, 80, 443                                                 │
 │                                                                                │
 │  Nginx ──────────────► Next.js (UN solo proceso, systemd: burgerhause.service) │
 │   │  TLS, límites,        127.0.0.1:3000  (no se expone)                       │
 │   │  /uploads/ directo         │                                               │
 │   │  desde disco               ▼                                               │
 │   ▼                      PostgreSQL 127.0.0.1:5432 (no se expone)              │
 │  /var/lib/burgerhause/uploads  (fotos de productos)                            │
 │                                                                                │
 │  burgerhause-backup.timer  → 04:30 todos los días → /var/backups/burgerhause   │
 │  logs → journald (journalctl)        certbot.timer → renueva el certificado    │
 └────────────────────────────────────────────────────────────────────────────────┘
```

| Puerto | Quién escucha | Visible desde internet |
| --- | --- | --- |
| 22 | SSH | Sí (solo con clave, con fail2ban) |
| 80 | Nginx | Sí (solo redirige a 443 y responde el desafío de Let's Encrypt) |
| 443 | Nginx | Sí |
| 3000 | La app (solo `127.0.0.1`) | **No** |
| 5432 | PostgreSQL (solo `localhost`) | **No** |

Reglas que no se pueden romper:

1. **Una sola instancia de la app.** El bus de eventos en tiempo real, el contador de conexiones y los límites de
   intentos viven en la memoria del proceso. **No** usar PM2 en modo cluster ni levantar una segunda copia.
2. **Nunca ejecutar `pnpm db:seed` en el servidor.** Carga productos y precios de DEMO. La app lo rechaza cuando
   `NODE_ENV=production`; para el servidor se usa `pnpm db:init-prod`.
3. **Los secretos viven en `/etc/burgerhause/burgerhause.env`**, fuera del repo. Los tokens de estación y la clave
   del admin **no** se guardan en archivos.

---

## 2. Alta de la VPS desde cero (Ubuntu 22.04 o 24.04)

Tiempo: 1 a 2 horas la primera vez. Hacelo en orden.

> **Qué está probado y qué no.** Los archivos de `deploy/` se probaron antes de entregarlos con Docker: la
> configuración de Nginx (sintaxis y comportamiento: encabezados, redirecciones, límites, subida de fotos), el
> `deploy.sh` con su rollback automático, y un backup real restaurado en una base vacía (`pnpm test:deploy`). **No**
> se pudieron probar sin la VPS real: la emisión del certificado con certbot, el comportamiento de systemd (las
> unidades pasaron `systemd-analyze verify`, pero no se arrancaron), ufw y fail2ban, y la copia remota por `rsync`/ssh.
> Por eso el primer deploy se hace mirando la pantalla (2.13) y la práctica de restauración es obligatoria (4.6).

### 2.1 Antes de empezar

- Una VPS Contabo con Ubuntu 22.04 o 24.04 y **al menos 2 GB de RAM** (el `build` consume memoria; con menos de
  4 GB agregá swap en 2.3).
- Un dominio y acceso a su DNS. Creá un registro **A**: `<TU_DOMINIO>` → `<IP_DE_LA_VPS>`. Comprobá (puede tardar
  minutos u horas): `nslookup <TU_DOMINIO>` debe devolver `<IP_DE_LA_VPS>`.
- El código en un repositorio Git al que puedas dar acceso de solo lectura (clave de despliegue, 2.6).

### 2.2 Primer ingreso: usuario propio, claves SSH, sin contraseña

Desde **tu PC**:

```bash
ssh root@<IP_DE_LA_VPS>
```

Ya dentro de la VPS, como `root`:

```bash
apt update && apt -y upgrade
adduser <TU_USUARIO>                  # te pide una clave: guardala en un gestor de claves
usermod -aG sudo <TU_USUARIO>
```

Desde **tu PC** (otra ventana), copiá tu clave pública. Si no tenés una, creala primero con `ssh-keygen -t ed25519`:

```bash
ssh-copy-id <TU_USUARIO>@<IP_DE_LA_VPS>
ssh <TU_USUARIO>@<IP_DE_LA_VPS>       # tiene que entrar SIN pedir la clave de la VPS (usa tu clave SSH)
```

Recién cuando eso funcione, en la VPS cerrá el acceso por contraseña y de `root`:

```bash
sudo tee /etc/ssh/sshd_config.d/99-burgerhause.conf >/dev/null <<'EOF'
PasswordAuthentication no
PermitRootLogin no
PubkeyAuthentication yes
EOF
sudo sshd -t && sudo systemctl reload ssh     # sshd -t no debe imprimir nada
```

**No cierres la ventana actual** hasta abrir otra y comprobar que `ssh <TU_USUARIO>@<IP_DE_LA_VPS>` sigue entrando.
Si te equivocaste, desde la ventana abierta borrá el archivo `99-burgerhause.conf` y recargá ssh.

### 2.3 Firewall (ufw), fail2ban, actualizaciones automáticas, swap

```bash
# Firewall: solo SSH, HTTP y HTTPS
sudo apt install -y ufw
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable                       # responde y (la sesión SSH actual no se corta porque OpenSSH está permitido)
sudo ufw status verbose

# fail2ban: bloquea IPs que fallan el ingreso por SSH
sudo apt install -y fail2ban
sudo tee /etc/fail2ban/jail.d/sshd.local >/dev/null <<'EOF'
[sshd]
enabled  = true
maxretry = 5
findtime = 10m
bantime  = 1h
EOF
sudo systemctl enable --now fail2ban
sudo fail2ban-client status sshd

# Parches de seguridad automáticos
sudo apt install -y unattended-upgrades
sudo dpkg-reconfigure -plow unattended-upgrades     # elegir "Yes"
```

Swap de 2 GB (solo si la VPS tiene menos de 4 GB de RAM; evita que el `build` se quede sin memoria):

```bash
free -h                                # mirá la fila Swap; si ya hay 2 GB o más, saltear esto
sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile
sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

### 2.4 Zona horaria

```bash
sudo timedatectl set-timezone America/Argentina/Buenos_Aires     # <TU_ZONA_HORARIA> si estás en otro país
timedatectl                            # "System clock synchronized: yes"
```

El backup corre a las 04:30 de esta hora.

### 2.5 Paquetes base

```bash
sudo apt install -y git curl rsync tmux nginx certbot postgresql-client ca-certificates gnupg
```

### 2.6 Traer el código: clave de despliegue y clon

`deploy.sh` clona el código desde Git **como root**. Para un repo privado hace falta una clave de solo lectura:

```bash
sudo ssh-keygen -t ed25519 -f /root/.ssh/burgerhause_deploy -N "" -C "deploy@burgerhause"
sudo cat /root/.ssh/burgerhause_deploy.pub     # copiá esta línea
```

En el sitio donde está el repo (por ejemplo GitHub → Settings → Deploy keys → Add deploy key) pegá la clave pública
**sin** marcar "Allow write access". Después:

```bash
sudo tee -a /root/.ssh/config >/dev/null <<'EOF'
Host github.com
    IdentityFile /root/.ssh/burgerhause_deploy
    IdentitiesOnly yes
EOF
sudo chmod 600 /root/.ssh/config
sudo ssh -T git@github.com                      # la primera vez pregunta si confiás en el host: yes
sudo git clone <REPO_URL> /opt/burgerhause/repo # copia de trabajo que se usa para correr deploy.sh y copiar configuración
```

(Si el repo es público, o preferís copiar el código desde tu PC con `rsync`, ver 3.4.)

### 2.7 Node.js 22 LTS y pnpm (corepack)

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
node --version                         # v22.x
command -v node                        # tiene que ser /usr/bin/node (así lo espera el servicio)
sudo corepack enable                   # activa pnpm; la versión exacta la fija package.json
pnpm --version                         # puede tardar la primera vez (descarga pnpm 10)
```

> Node 20 LTS también sirve (la app pide Node 20 o superior). Si `command -v node` da otra ruta, editá
> `ExecStart=` en `/etc/systemd/system/burgerhause.service` (2.13).

### 2.8 PostgreSQL (solo local) y la base de datos

```bash
# Ubuntu 24.04 trae PostgreSQL 16 (la versión con la que se desarrolló). En 22.04 trae la 14; para usar la 16:
#   sudo apt install -y postgresql-common && sudo /usr/share/postgresql-common/pgdg/apt.postgresql.org.sh -y
sudo apt install -y postgresql
sudo -u postgres psql -c 'select version();'
```

Comprobá que **solo escucha en local** (tiene que verse `127.0.0.1:5432`, nunca `0.0.0.0:5432`):

```bash
sudo ss -tlnp | grep 5432
sudo grep -n "^listen_addresses" /etc/postgresql/*/main/postgresql.conf       # si no aparece o dice 'localhost' está bien
```

Si no es así, editá `/etc/postgresql/<VERSION>/main/postgresql.conf` (la versión es el número de esa carpeta),
dejá `listen_addresses = 'localhost'` y reiniciá: `sudo systemctl restart postgresql`. En
`/etc/postgresql/<VERSION>/main/pg_hba.conf` solo deben quedar líneas `local` y `host ... 127.0.0.1/32` / `::1/128`
(es lo que trae Ubuntu por defecto; **no agregues** líneas con `0.0.0.0/0`).

Crear el rol y la base (con el script del repo clonado en 2.6). **La clave nunca se escribe en la línea de
comandos** (quedaría visible en `ps` y en el historial): se carga con `\password`, que la pide por teclado.

```bash
# 1) generar una clave de base de datos (solo letras y números, para no tener que escaparla en la URL)
openssl rand -hex 24                   # copiá el resultado: es <CLAVE_DB>

# 2) crear el rol (sin clave) y la base
sudo -u postgres psql -v ON_ERROR_STOP=1 -f /opt/burgerhause/repo/deploy/postgres/burgerhause-init.sql

# 3) ponerle la clave: pide <CLAVE_DB> dos veces y no la muestra
sudo -u postgres psql -c '\password burgerhause'

# 4) comprobar que la base existe y que el rol es suyo (como superusuario; la prueba con el usuario de la app es en 2.9)
sudo -u postgres psql -d burgerhause -c 'select current_database();'
```

El rol se llama igual que el usuario del sistema que corre la app y el backup (`burgerhause`): el backup entra por
el socket local con autenticación `peer`, **sin clave**. La clave solo la usa la app (por `DATABASE_URL`).

(El paso 2 usa el repo clonado en 2.6.)

### 2.9 Usuario de la app y carpetas con sus permisos

```bash
# usuario sin privilegios, sin login interactivo
sudo useradd --system --create-home --home-dir /var/lib/burgerhause --shell /usr/sbin/nologin burgerhause
sudo chmod 750 /var/lib/burgerhause

# código: lo escribe root (deploy.sh), la app solo lee
sudo install -d -m 755 -o root -g root /opt/burgerhause /opt/burgerhause/releases

# fotos subidas: dueño la app, grupo burgerhause; "2" = los archivos nuevos heredan el grupo
sudo install -d -m 2750 -o burgerhause -g burgerhause /var/lib/burgerhause/uploads
sudo usermod -aG burgerhause www-data      # nginx (usuario www-data) puede leer las fotos
sudo systemctl restart nginx               # para que tome el grupo nuevo

# backups: solo la app
sudo install -d -m 700 -o burgerhause -g burgerhause /var/backups/burgerhause

# secretos
sudo install -d -m 750 -o root -g burgerhause /etc/burgerhause

# el usuario de la app entra a su base por el socket local, sin clave (así hace el backup)
sudo -u burgerhause psql -d burgerhause -c 'select current_user, current_database();'
```

### 2.10 Archivo de variables (`/etc/burgerhause/burgerhause.env`)

```bash
sudo install -m 640 -o root -g burgerhause /opt/burgerhause/repo/deploy/env/burgerhause.env.example /etc/burgerhause/burgerhause.env
openssl rand -base64 48                # copiá el resultado: es <SESSION_SECRET>
sudo nano /etc/burgerhause/burgerhause.env
```

Dentro del archivo cambiá **solo** estas líneas (sin comillas, sin espacios alrededor del `=`):

```
DATABASE_URL=postgres://burgerhause:<CLAVE_DB>@127.0.0.1:5432/burgerhause
SESSION_SECRET=<SESSION_SECRET>
REPO_URL=<REPO_URL>                    # sacale el # del principio
REF=main                               # idem
```

Dejá `UPLOAD_DIR=/var/lib/burgerhause/uploads` y `NODE_ENV=production` como están. Guardá con `Ctrl+O`, `Enter`,
`Ctrl+X`. Comprobá los permisos: `ls -l /etc/burgerhause/burgerhause.env` → `-rw-r----- root burgerhause`.
**Nunca** pongas `ALLOW_DEMO_SEED` en este archivo.

### 2.11 Nginx y el certificado TLS (Let's Encrypt)

El sitio final de Nginx referencia el certificado, que todavía no existe. Se hace en dos tiempos: primero un sitio
mínimo que solo responde el desafío de Let's Encrypt, después el sitio completo.

```bash
sudo mkdir -p /var/www/certbot
sudo rm -f /etc/nginx/sites-enabled/default

# Tiempo 1: sitio mínimo en el puerto 80
sudo tee /etc/nginx/sites-available/bootstrap >/dev/null <<'EOF'
server {
    listen 80 default_server;
    server_name _;
    location ^~ /.well-known/acme-challenge/ { root /var/www/certbot; }
    location / { return 404; }
}
EOF
sudo ln -sf /etc/nginx/sites-available/bootstrap /etc/nginx/sites-enabled/bootstrap
sudo nginx -t && sudo systemctl reload nginx

# Pedir el certificado (el DNS de <TU_DOMINIO> ya tiene que apuntar a esta VPS)
sudo certbot certonly --webroot -w /var/www/certbot -d <TU_DOMINIO> -m <TU_EMAIL> --agree-tos --no-eff-email \
  --deploy-hook "systemctl reload nginx"
sudo ls /etc/letsencrypt/live/<TU_DOMINIO>/        # fullchain.pem y privkey.pem
```

Tiempo 2: instalar la configuración del repo y poner tu dominio:

```bash
cd /opt/burgerhause/repo/deploy/nginx
sudo install -m 644 conf.d/00-burgerhause-zones.conf /etc/nginx/conf.d/
sudo install -d /etc/nginx/snippets
sudo install -m 644 snippets/burgerhause-proxy.conf snippets/burgerhause-headers.conf /etc/nginx/snippets/
sudo install -m 644 burgerhause.conf /etc/nginx/sites-available/burgerhause.conf
sudo sed -i 's/burgerhause\.example\.com/<TU_DOMINIO>/g' /etc/nginx/sites-available/burgerhause.conf
sudo grep -c "example.com" /etc/nginx/sites-available/burgerhause.conf      # tiene que dar 0
sudo rm -f /etc/nginx/sites-enabled/bootstrap
sudo ln -sf /etc/nginx/sites-available/burgerhause.conf /etc/nginx/sites-enabled/burgerhause.conf
sudo nginx -t                          # "syntax is ok" y "test is successful"
sudo systemctl reload nginx
sudo certbot renew --dry-run           # prueba la renovación automática (debe terminar en "Congratulations")
systemctl list-timers certbot.timer    # la renovación automática está programada
```

Un pedido a `https://<IP_DE_LA_VPS>/` o a cualquier otro nombre que no sea `<TU_DOMINIO>` se corta (no llega a la app): es el
servidor "catch-all" de la configuración, que usa el mismo certificado solo para poder completar el saludo TLS.

Qué hace esa configuración (por si necesitás tocarla): redirige HTTP→HTTPS, pasa a la app la IP real del cliente
**sobrescribiendo** `X-Forwarded-For` (la app usa ese dato para limitar intentos; nunca se debe cambiar a
`$proxy_add_x_forwarded_for`), desactiva el buffering en `/api/events` y `/api/agent/stream` (tiempo real),
sirve `/uploads/` directo desde disco, permite subir hasta 6 MB solo en `/api/uploads`, limita pedidos/login/
agentes por IP (el local entero comparte una IP: los agentes y las PCs tienen límites generosos) y agrega los
encabezados de seguridad (HSTS, `nosniff`, `X-Frame-Options`).

### 2.12 Servicio de la app (systemd)

```bash
cd /opt/burgerhause/repo/deploy/systemd
sudo install -m 644 burgerhause.service burgerhause-backup.service burgerhause-backup.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable burgerhause burgerhause-backup.timer     # "enable" = arranca solo al prender la VPS
# Todavía NO lo inicies: no hay código desplegado. Lo arranca el primer deploy.
```

### 2.13 Primer deploy

```bash
cd /opt/burgerhause/repo && sudo git pull --ff-only
sudo DRY_RUN=1 ./deploy/scripts/deploy.sh      # muestra el plan sin cambiar nada: leelo
```

El deploy tarda varios minutos. **Si se corta tu conexión SSH a la mitad, el deploy tiene que seguir solo**: por eso
se lanza con `systemd-run` (o dentro de `tmux`), nunca "pelado" en la terminal del SSH:

```bash
# Opción A (recomendada): corre como servicio temporal y te muestra la salida en vivo
sudo systemd-run --wait --collect --pty --unit=burgerhause-deploy \
  --working-directory=/opt/burgerhause/repo /opt/burgerhause/repo/deploy/scripts/deploy.sh

# Opción B: tmux (si se corta SSH, el deploy sigue; reconectás con "tmux attach -t deploy")
tmux new -s deploy
sudo ./deploy/scripts/deploy.sh
```

Con variables (por ejemplo una etiqueta): `sudo systemd-run --wait --collect --pty --unit=burgerhause-deploy --setenv=REF=v1.2.0 --working-directory=/opt/burgerhause/repo /opt/burgerhause/repo/deploy/scripts/deploy.sh`.

Al final tiene que decir `DEPLOY_OK`. Si dice otra cosa, mirá la sección 9. Si perdiste la pantalla: `journalctl -u burgerhause-deploy -n 80 --no-pager`
y `journalctl -t burgerhause-deploy -n 50 --no-pager`. Comprobá:

```bash
systemctl status burgerhause --no-pager        # "active (running)"
curl -s http://127.0.0.1:3000/api/health       # {"status":"ok","db":"ok","realtime":"live",...}
curl -s https://<TU_DOMINIO>/api/health        # lo mismo, pasando por Nginx y TLS
```

### 2.14 Inicializar la base y crear el administrador

```bash
cd /opt/burgerhause/repo
sudo ./deploy/scripts/app-run.sh pnpm db:init-prod
```

Crea **solo** los ajustes por defecto (el local queda **cerrado a pedidos** hasta que lo abras). No crea productos,
usuarios ni estaciones. Después el administrador:

```bash
sudo ADMIN_USERNAME=<USUARIO_ADMIN> ./deploy/scripts/app-run.sh pnpm db:seed-admin
```

Imprime una clave generada **una sola vez**: copiala en tu gestor de claves en ese momento. (Para elegirla vos:
agregá `ADMIN_PASSWORD=...` antes del comando; queda en el historial de la terminal, así que mejor dejá que se
genere y cambiala después desde Admin → Usuarios.)

Entrá a `https://<TU_DOMINIO>/login` con ese usuario y seguí con la sección 10 (datos de arranque).

### 2.15 Programar y probar el primer backup

```bash
sudo systemctl start burgerhause-backup        # corre ahora (tarda segundos)
sudo systemctl status burgerhause-backup --no-pager
sudo ls -l /var/backups/burgerhause/db/        # tiene que haber un burgerhause-FECHA.dump
sudo cat /var/backups/burgerhause/last-success
systemctl list-timers burgerhause-backup.timer # muestra la próxima ejecución (04:30)
```

Antes de abrir al público hacé la **práctica de restauración** de la sección 4.6.

---

## 3. Deploy de una versión nueva y rollback

### 3.1 Qué hace `deploy.sh` (y en qué orden)

1. Verifica el archivo de variables (nunca imprime los valores).
2. Descarga el código en una carpeta nueva `/opt/burgerhause/releases/<fecha-hora>`.
3. Hace un **backup** de la base (si falla, se cancela el deploy: la versión en uso no se toca).
4. `pnpm install --frozen-lockfile`.
5. `pnpm db:migrate` — **antes** de compilar y antes de tocar la versión en uso. La compilación pre-renderiza el
   menú, así que necesita la base alcanzable y migrada.
6. `pnpm build`.
7. Cambia el enlace `current` a la carpeta nueva (de forma atómica) y reinicia el servicio.
8. Consulta `/api/health` hasta 60 segundos; tiene que responder `status: ok`. Recién entonces marca la versión como
   **buena** (archivo `.deployed-ok` dentro de su carpeta).
9. Si **no** responde bien: vuelve solo a la versión anterior, reinicia y avisa (código de salida 3). La versión que
   falló se renombra `<fecha-hora>.failed`: nunca más es candidata a rollback.
10. Conserva las últimas 5 versiones **buenas** (y las 2 últimas `.failed` para investigar).

Al empezar, cada deploy borra las carpetas a medio construir que haya dejado un deploy anterior interrumpido
(nunca la versión en uso). Dos deploys a la vez no se pueden: el segundo dice "another deploy is running".

Si algo falla en los pasos 2 a 6 (o apretás `Ctrl+C`, o se corta la conexión), la versión en uso sigue funcionando sin
cambios y la carpeta a medio construir se borra. **Si el script muere justo entre el paso 7 y el 8** (por ejemplo
`kill -9`) imprime/deja un aviso `RECOVERY`: corré `sudo ./deploy/scripts/deploy.sh status` y, si el servicio no está
sano, `sudo ./deploy/scripts/deploy.sh rollback`. Cada paso queda en `journalctl -t burgerhause-deploy`.

### 3.2 Hacer un deploy

```bash
cd /opt/burgerhause/repo && sudo git pull --ff-only          # trae la última versión de los scripts
sudo DRY_RUN=1 ./deploy/scripts/deploy.sh                    # opcional: ver el plan
sudo ./deploy/scripts/deploy.sh                              # usa REPO_URL y REF del archivo de variables
sudo REF=v1.2.0 ./deploy/scripts/deploy.sh                   # una rama o etiqueta (tag) concreta
```

(Recordá lanzarlo con `systemd-run` o `tmux`, ver 2.13. `REF` acepta nombres de rama o etiqueta —letras, números, `. _ / -`—;
los hashes de commit no se aceptan.)

Hacelo **fuera del horario de servicio** (el reinicio corta unos segundos las conexiones en vivo; los agentes y
las pantallas reconectan solos). Resultado esperado: la última línea dice `DEPLOY_OK`.

| Código de salida | Significa | Qué hacer |
| --- | --- | --- |
| 0 | Desplegado y sano | Nada |
| 1 | Falló **antes** del cambio (instalar, migrar, compilar, backup, o una migración destructiva rechazada). La versión en uso sigue igual | Leer el error (últimas líneas) y la sección 9 |
| 2 | Configuración incorrecta (variables, falta REPO_URL, otro deploy en curso) | Corregir lo que dice el mensaje |
| 3 | La versión nueva **no** quedó sana; se volvió **sola** a la anterior | Está funcionando la versión anterior. Mirar `journalctl -u burgerhause -n 100` para ver por qué falló la nueva |
| 4 | No sana y no se pudo volver (primer deploy, o la anterior tampoco anda) | **Intervención manual**: sección 9 (502) |

### 3.3 Rollback manual (volver a la versión anterior)

```bash
sudo ./deploy/scripts/deploy.sh status                       # versión actual, versiones buenas y fallidas
sudo ./deploy/scripts/deploy.sh rollback                     # vuelve a la versión BUENA inmediatamente anterior
sudo ./deploy/scripts/deploy.sh rollback <FECHA_HORA>        # a una buena concreta (ej. 20261016134344)
```

**Atención con las migraciones de base de datos**: el rollback cambia el **código**, no revierte la base. Por eso
las migraciones del proyecto deben ser compatibles hacia atrás (agregar tablas/columnas primero, quitar en una
versión posterior). Si una migración rompió datos, la salida es restaurar el backup (sección 4.5): el deploy hizo
uno justo antes de migrar.

**Checklist antes de aprobar una versión con migraciones nuevas:** las migraciones nuevas deben ser **aditivas**:
columnas nullable o con `DEFAULT`, tablas nuevas, índices. Nada de `DROP`, `RENAME` ni `SET NOT NULL` sobre algo que la
versión anterior todavía usa. El deploy lo vigila: si una migración nueva contiene `DROP `, `RENAME ` o `SET NOT NULL`
imprime un aviso grande (el rollback automático no sería seguro) y se detiene (código 1) salvo que lo apruebes a
conciencia con `sudo ALLOW_DESTRUCTIVE_MIGRATION=1 ./deploy/scripts/deploy.sh`.

Solo se puede volver a versiones **buenas** (las que pasaron el chequeo de salud); `rollback` rechaza una versión
`.failed` o a medio construir.

### 3.4 Alternativa: copiar el código desde tu PC (sin Git en el servidor)

```bash
# en tu PC, dentro del repo (sin node_modules ni .next):
rsync -a --delete --exclude node_modules --exclude .next --exclude .env --exclude '.env.*' --exclude .git \
  ./ <TU_USUARIO>@<IP_DE_LA_VPS>:/tmp/burgerhause-src/
# en la VPS:
sudo SOURCE_DIR=/tmp/burgerhause-src APP_COMMIT=<ETIQUETA_DE_LA_VERSION> /opt/burgerhause/repo/deploy/scripts/deploy.sh
```

(`APP_COMMIT` es solo una etiqueta que se muestra en `/api/health`.)

### 3.5 Tareas manuales con el entorno de producción

```bash
sudo ./deploy/scripts/app-run.sh pnpm db:migrate             # aplicar migraciones a mano (normalmente lo hace deploy.sh)
sudo ADMIN_USERNAME=admin ./deploy/scripts/app-run.sh pnpm db:seed-admin    # resetear la clave del admin (imprime una nueva)
```

---

## 4. Backups

### 4.1 Qué se guarda, dónde y por cuánto tiempo

| Qué | Dónde | Cuánto |
| --- | --- | --- |
| Base de datos (`pg_dump -Fc`, comprimido, permisos 0600) | `/var/backups/burgerhause/db/burgerhause-AAAAMMDD-HHMMSS.dump` | 14 días (los más viejos se borran solos) |
| Fotos subidas | `/var/backups/burgerhause/uploads/` (copia incremental; no borra nada) | Sin límite (son archivos inmutables; ocupan poco) |
| Copia fuera de la VPS (opcional pero **recomendada**) | `BACKUP_REMOTE` (4.4) | La que defina el otro equipo |
| Marca de "último backup completo" | `/var/backups/burgerhause/last-success` | — |

El backup entra a la base por el socket local con autenticación `peer` como el usuario `burgerhause` (**sin clave**:
ninguna clave aparece en comandos ni en `ps`).

Corre todos los días a las **04:30** (`burgerhause-backup.timer`). Si la VPS estaba apagada a esa hora, corre al
prenderse. El deploy hace además un backup antes de migrar.

**Lo que NO está en el backup**: el archivo `/etc/burgerhause/burgerhause.env` (guardalo vos, cifrado, en tu gestor
de claves: sin el `SESSION_SECRET` solo se cierran las sesiones, pero la `DATABASE_URL` hay que poder rehacerla) y
los tokens de estación (se regeneran en Admin → Estaciones).

### 4.2 Cómo verificar que el backup corrió

```bash
systemctl list-timers burgerhause-backup.timer               # LAST = cuándo corrió por última vez
sudo cat /var/backups/burgerhause/last-success               # fecha del último backup COMPLETO (UTC)
sudo /opt/burgerhause/current/deploy/scripts/check-backup.sh # BACKUP_FRESH (ok) o BACKUP_STALE / BACKUP_MISSING (mal; sale con 1)
journalctl -u burgerhause-backup -n 40 --no-pager            # termina con BACKUP_OK
sudo ls -lh /var/backups/burgerhause/db/                     # los archivos .dump: tamaño razonable (no 0)
```

Si `check-backup.sh` dice `STALE` o `MISSING`, el backup **no** está funcionando: ver la tabla de la sección 9.

### 4.3 Hacer un backup ahora

```bash
sudo systemctl start burgerhause-backup && journalctl -u burgerhause-backup -n 20 --no-pager
```

### 4.4 Copiar los backups fuera de la VPS

Un backup en la misma máquina no protege de perder la VPS. Necesitás **otro equipo** con SSH y `rsync` (otro
servidor, un NAS en el local, otra VPS barata). En ese equipo creá un usuario `<USUARIO_BACKUP>` y la carpeta
`<CARPETA_REMOTA>`. Después, en la VPS:

```bash
# clave propia para los backups (la app corre como "burgerhause")
sudo -u burgerhause mkdir -p /var/lib/burgerhause/.ssh
sudo -u burgerhause chmod 700 /var/lib/burgerhause/.ssh
sudo -u burgerhause ssh-keygen -t ed25519 -f /var/lib/burgerhause/.ssh/backup_ed25519 -N "" -C "burgerhause-backup"
sudo cat /var/lib/burgerhause/.ssh/backup_ed25519.pub        # agregar esta línea a ~<USUARIO_BACKUP>/.ssh/authorized_keys del otro equipo

# confiar en el otro equipo (verificá la huella que muestra contra la del otro equipo)
sudo -u burgerhause sh -c 'ssh-keyscan -H <HOST_REMOTO> >> /var/lib/burgerhause/.ssh/known_hosts'
sudo -u burgerhause ssh -i /var/lib/burgerhause/.ssh/backup_ed25519 <USUARIO_BACKUP>@<HOST_REMOTO> 'echo conexion ok'
```

> El servicio de backup tiene `ReadOnlyPaths=/var/lib/burgerhause`: puede leer la clave y `known_hosts`, pero no
> escribir ahí. Por eso `known_hosts` se completa a mano como arriba.

Activar en `/etc/burgerhause/burgerhause.env` (sacar el `#` y completar):

```
BACKUP_REMOTE=<USUARIO_BACKUP>@<HOST_REMOTO>:<CARPETA_REMOTA>
BACKUP_SSH_KEY=/var/lib/burgerhause/.ssh/backup_ed25519
```

Probar: `sudo systemctl start burgerhause-backup && journalctl -u burgerhause-backup -n 20 --no-pager` debe incluir
`remote copy ok`. La copia remota **no borra** nada en el otro equipo (sin `--delete`): limpiá allá lo viejo cada
tanto. Si falla la copia remota, el backup local queda hecho y el servicio termina con error (código 4): se ve en
`systemctl status burgerhause-backup`.

### 4.5 Restaurar: paso a paso

Hay dos formas. **Practicá la A** (4.6); usá la **B** en una emergencia real.

Preparación común: el script `restore-db.sh` se corre como `root`, usa `sudo -u postgres` para hablar con
PostgreSQL y siempre verifica el archivo antes de tocar nada. Para que el nuevo contenido quede a nombre del
usuario de la app, se indica `RESTORE_OWNER=burgerhause`.

```bash
cd /opt/burgerhause/repo
export PSQL_CMD="sudo -u postgres psql"
export PGRESTORE_CMD="sudo -u postgres pg_restore"
export RESTORE_OWNER=burgerhause
sudo -E ls -1t /var/backups/burgerhause/db/ | head          # elegí el .dump (el primero es el más nuevo)
```

**A) Restaurar en una base NUEVA (no toca la base en uso; sirve para practicar y para inspeccionar):**

```bash
sudo -E ./deploy/scripts/restore-db.sh /var/backups/burgerhause/db/<ARCHIVO>.dump
#   crea burgerhause_restore_AAAAMMDD_HHMMSS, restaura, y muestra la cantidad de filas de cada tabla
#   (comparalas con lo que esperás: pedidos, productos, usuarios...). Termina con RESTORE_OK.
```

Para usar esa copia en lugar de la base en uso (sin borrar la actual): apagar la app, editar `DATABASE_URL`
en `/etc/burgerhause/burgerhause.env` para que apunte a la base nueva, y `sudo systemctl start burgerhause`.
Para volver, deshacer ese cambio.

**B) Emergencia: reemplazar la base en uso por el backup (`--force-live`):**

```bash
sudo systemctl stop burgerhause                              # 1) apagar la app
sudo systemctl start burgerhause-backup                      # 2) guardar lo que haya ahora (por si acaso)
sudo -E ./deploy/scripts/restore-db.sh --force-live /var/backups/burgerhause/db/<ARCHIVO>.dump
#   3) pide que escribas el nombre de la base (burgerhause) para confirmar; si no coincide NO hace nada
sudo systemctl start burgerhause                             # 4) arrancar
curl -s http://127.0.0.1:3000/api/health                     # 5) verificar
sudo systemctl restart burgerhause                           # (el reinicio también refresca el menú en memoria)
```

Después entrá al sistema y revisá: pedidos del día, menú, ajustes y que los agentes de impresión estén
conectados (sección 5). Los pedidos hechos entre el backup y la caída **no están**: se recuperan de las libretas
a mano (sección 11).

**Restaurar las fotos** (si se perdieron):

```bash
sudo rsync -a /var/backups/burgerhause/uploads/ /var/lib/burgerhause/uploads/
sudo chown -R burgerhause:burgerhause /var/lib/burgerhause/uploads
sudo chmod 2750 /var/lib/burgerhause/uploads
```

**Si se perdió la VPS entera**: nueva VPS → secciones 2.1 a 2.6 (incluida la base vacía de 2.8 y el archivo de
variables de 2.10) → traer el último `.dump` y las fotos del lugar externo a la VPS nueva (`scp`) → hacer la
restauración B (`--force-live`, **antes** del primer deploy: la base vacía se reemplaza) y restaurar las fotos →
primer deploy (2.13; no hay migraciones pendientes porque el backup las incluye) → NO correr `db:init-prod` ni
`db:seed-admin` (los datos y el admin vienen del backup).

### 4.6 Práctica de restauración (obligatoria)

Un backup que nunca se restauró no es un backup. Hacela **antes de abrir al público** y después **una vez por
mes** (por ejemplo, el primer lunes) y cada vez que cambies algo de los backups:

```bash
cd /opt/burgerhause/repo
export PSQL_CMD="sudo -u postgres psql" PGRESTORE_CMD="sudo -u postgres pg_restore" RESTORE_OWNER=burgerhause
LAST="$(sudo ls -1t /var/backups/burgerhause/db/*.dump | head -1)"; echo "$LAST"
sudo -E ./deploy/scripts/restore-db.sh "$LAST" burgerhause_practica
#   → mirá las filas por tabla y que termine en RESTORE_OK
sudo -u postgres psql -d burgerhause_practica -c 'select count(*) from orders;'     # tiene que ser coherente con la base real
sudo -u postgres dropdb burgerhause_practica                                         # limpiar
```

Anotá la fecha de la práctica y el resultado.

---

## 5. Monitoreo mínimo

### 5.1 Estado y logs

```bash
systemctl status burgerhause --no-pager                      # ¿activo? ¿desde cuándo?
journalctl -u burgerhause -f                                 # log de la app en vivo (Ctrl+C para salir)
journalctl -u burgerhause --since "1 hour ago" --no-pager    # última hora
journalctl -u burgerhause -p err --since today --no-pager    # solo errores de hoy
journalctl -t burgerhause-deploy -n 50 --no-pager            # historial de deploys
journalctl -u burgerhause-backup -n 40 --no-pager            # backups
sudo tail -n 50 /var/log/nginx/burgerhause.error.log         # errores de Nginx
sudo tail -n 50 /var/log/nginx/burgerhause.access.log        # accesos
systemctl status postgresql --no-pager
df -h /                                                      # disco (ojo si pasa del 85 %)
free -h                                                      # memoria
```

La app **no escribe** contraseñas, tokens ni cadenas de conexión en los logs.

### 5.2 Monitor externo gratuito de `/api/health`

Registrate en un servicio gratuito de monitoreo (por ejemplo UptimeRobot, o BetterStack/Freshping) y creá un
monitor **HTTP(s)** a `https://<TU_DOMINIO>/api/health`, cada 5 minutos, con aviso por email/WhatsApp a
`<TU_EMAIL>`. Responde `200` con `{"status":"ok","db":"ok",...}` cuando todo anda y `503` si la base no responde.
El campo `realtime` (`live` o `down`) informa si el canal de tiempo real está conectado a la base: es solo
informativo (la app se recupera sola). El endpoint tiene un límite de 60 consultas por minuto por IP.

Lo mismo para el vencimiento del certificado y el espacio en disco: el monitor de HTTPS ya avisa si el
certificado vence; el disco se mira con `df -h` (sección 5.1) una vez por semana.

### 5.3 "No imprime": qué mirar, en orden

1. **En la pantalla de pedidos de esa estación** (**Retiro en local** en el mostrador, **Gestión Delivery** en delivery;
   antes "la Caja"): ¿hay un aviso rojo de impresión fallida? ¿La estación dice **"Sin agente"**? Eso ya dice si
   el problema es el programa de impresión (agente) o la impresora. Con el aviso rojo, apretar **Reimprimir**.
2. **En la PC de esa estación** (PowerShell como Administrador, ver `docs/ops/print-agent-install.md`, sección 9):
   - Estado: `powershell -NoProfile -ExecutionPolicy Bypass -File .\status.ps1` (debe decir "Servidor: OK").
   - Log: `Get-Content C:\BurgerHouseAgent\data\logs\agent.log -Tail 30`
   - Reiniciar el agente: `Stop-ScheduledTask BurgerHouseAgent; Start-ScheduledTask BurgerHouseAgent`
3. **Spooler de impresión de Windows** (si la impresora figura "desconectada" o los trabajos quedan trabados):
   `Get-Service Spooler` (debe ser `Running`). Reiniciarlo: `Restart-Service Spooler`. Mirar también la cola de la
   impresora en Windows (Impresoras y escáneres → la impresora → Abrir cola) y cancelar trabajos trabados.
4. **Físico**: papel, tapa cerrada, cable USB, encendida.
5. **En el servidor** (si ninguna estación imprime):
   `curl -s https://<TU_DOMINIO>/api/health` (¿`db: ok`?) y `journalctl -u burgerhause --since "30 min ago" --no-pager`.
   Si el servicio se reinició, los agentes reconectan solos y los trabajos pendientes se imprimen una sola vez.
6. Otro agente con el mismo token: el log dice "Otro agente se conectó para esta estación" → dejar un solo agente por
   estación y rotar el token (sección 6).
7. La alerta roja dice **"Ticket cliente: documento inválido"** y no sale papel: el agente de esa PC es **anterior al logo**
   (versión 0.1.x sin soporte del bloque `logo`). Actualizarlo con el ZIP nuevo (`update.ps1`, `print-agent-install.md`
   sección 9) y apretar **Reimprimir**. El ticket de delivery no usa el logo, por eso ese sí sale.

---

## 6. Rotación de secretos

| Qué | Cómo | Efecto |
| --- | --- | --- |
| `SESSION_SECRET` | `openssl rand -base64 48`, pegar en `/etc/burgerhause/burgerhause.env` y `sudo systemctl restart burgerhause` | **Cierra la sesión de todos** (cajeras, encargada, admin). Los clientes no se ven afectados. Hacerlo si se sospecha filtración |
| Token de estación | Admin → Estaciones → **Rotar token**; después actualizarlo en la PC (`print-agent-install.md`, sección 9) | El token viejo deja de servir al instante; esa estación no imprime hasta cargar el nuevo |
| Clave de un usuario | Admin → Usuarios → editar | Cierra sus sesiones |
| Clave del admin (olvidada) | `sudo ADMIN_USERNAME=<USUARIO_ADMIN> /opt/burgerhause/repo/deploy/scripts/app-run.sh pnpm db:seed-admin` | Genera una clave nueva (se muestra una sola vez), reactiva al admin y revoca sus sesiones |
| Clave de PostgreSQL | `sudo -u postgres psql -c '\password burgerhause'` (pide la clave nueva por teclado; no la escribas en el comando), actualizar `DATABASE_URL` en el archivo de variables y `sudo systemctl restart burgerhause` | Hay unos segundos sin servicio |
| Clave SSH de la VPS / de despliegue | Generar una nueva (2.2 / 2.6), agregar la nueva, comprobar que entra, **recién ahí** quitar la vieja | — |

Después de cualquier rotación: `curl -s https://<TU_DOMINIO>/api/health`.

---

## 7. Actualizar el sistema operativo y Node

Cada 2 a 4 semanas (los parches de seguridad ya se aplican solos):

```bash
sudo apt update && apt list --upgradable
sudo apt -y upgrade
[ -f /var/run/reboot-required ] && echo "HAY QUE REINICIAR" || echo "no hace falta reiniciar"
```

Si hay que reiniciar la VPS: avisar al local, `sudo reboot`, esperar 2 minutos, entrar y verificar:
`systemctl status burgerhause postgresql nginx --no-pager` y `curl -s https://<TU_DOMINIO>/api/health`. Los tres
servicios arrancan solos (están habilitados).

- **PostgreSQL**: las actualizaciones menores llegan con `apt upgrade` y reinician la base unos segundos (el
  canal en tiempo real reconecta solo). Un cambio de versión **mayor** (14→16) no se hace con `apt upgrade`:
  se hace con un backup + restauración en la versión nueva (secciones 4.5 y 2.8); coordinarlo con el soporte.
- **Node.js**: mantené la línea 22 LTS (`sudo apt upgrade nodejs`). Para pasar a otra versión mayor: cambiar el
  repositorio de NodeSource (2.7), `node --version`, y hacer un deploy completo (la compilación se hace con la
  versión nueva). Si algo falla, volver a la versión anterior con el rollback (3.3).
- **Nginx / certbot**: llegan con `apt upgrade`. Después de actualizar Nginx: `sudo nginx -t && sudo systemctl reload nginx`.

---

## 8. Checklist de seguridad

Revisalo antes de abrir al público y después cada 3 meses.

| Control | Cómo comprobarlo | Esperado |
| --- | --- | --- |
| Puerto 5432 cerrado | Desde **tu PC**: `nmap -p 5432 <IP_DE_LA_VPS>` (o `Test-NetConnection <IP_DE_LA_VPS> -Port 5432`) | `closed` / `filtered` / `TcpTestSucceeded : False` |
| PostgreSQL escucha solo en local | En la VPS: `sudo ss -tlnp \| grep 5432` | Solo `127.0.0.1:5432` (y `[::1]`) |
| La app escucha solo en local | `sudo ss -tlnp \| grep 3000` | `127.0.0.1:3000` |
| Solo 22/80/443 abiertos | `sudo ufw status verbose` | Default deny incoming; 22, 80, 443 permitidos |
| SSH sin contraseña ni root | `sudo sshd -T \| grep -E "passwordauthentication\|permitrootlogin"` | `passwordauthentication no`, `permitrootlogin no` |
| fail2ban activo | `sudo fail2ban-client status sshd` | `Currently banned` con valores; servicio activo |
| Parches automáticos | `systemctl is-enabled unattended-upgrades` | `enabled` |
| Archivo de variables protegido | `ls -l /etc/burgerhause/burgerhause.env` | `-rw-r----- root burgerhause` |
| Sin datos de demo | Admin → Menú: solo tus productos; `grep ALLOW_DEMO_SEED /etc/burgerhause/burgerhause.env` | Sin resultados |
| HTTPS y HSTS | `curl -sI https://<TU_DOMINIO>/ \| grep -i strict-transport` | `max-age=31536000` |
| HTTP redirige a HTTPS | `curl -sI http://<TU_DOMINIO>/ \| head -3` | `301` con `Location: https://…` |
| Dotfiles y mapas bloqueados | `curl -s -o /dev/null -w "%{http_code}\n" https://<TU_DOMINIO>/.env` | `404` |
| Certificado renueva solo | `sudo certbot renew --dry-run` | Sin errores |
| Backups probados | Sección 4.6, con fecha anotada | Menos de 1 mes |
| Backup fuera de la VPS | `journalctl -u burgerhause-backup -n 20` | `remote copy ok` |
| Una sola instancia | `pgrep -fc "next/dist/bin/next start"` | `1` |
| Tokens de estación | Admin → Estaciones: rotar los que vayan a PCs que se cambiaron | — |

---

## 9. Problemas comunes (síntoma → causa → solución)

| Síntoma | Causa probable | Solución |
| --- | --- | --- |
| El navegador muestra **502 Bad Gateway** | La app no está corriendo o no responde en `127.0.0.1:3000` | `systemctl status burgerhause --no-pager`; `journalctl -u burgerhause -n 100 --no-pager`; `sudo systemctl restart burgerhause`; `curl -s http://127.0.0.1:3000/api/health`. Si arrancó y cae enseguida: el log dice por qué (variable faltante, base caída). Si fue después de un deploy: `sudo ./deploy/scripts/deploy.sh rollback` |
| **503 en `/api/health`** (`db: down`) | PostgreSQL parado o clave de `DATABASE_URL` incorrecta | `systemctl status postgresql --no-pager`; `sudo systemctl start postgresql`; probar `sudo -u burgerhause psql -d burgerhause -c 'select 1'` (entra por el socket, sin clave; si funciona y la app no, la clave de `DATABASE_URL` no coincide con la del rol: `\password`); revisar `df -h` (disco lleno frena a PostgreSQL) |
| **429 Too Many Requests** | Tope de volumen por IP de Nginx (login: 30 por minuto con ráfaga de 30; pedidos: 10/s con ráfaga de 20; el local entero comparte una IP). La app además limita los intentos de login por su cuenta (5 por usuario+IP y 20 por IP cada 15 minutos): ese es el que frena la fuerza bruta | Esperar un minuto (o 15 si fueron intentos de clave). Si pasa seguido en el local, subir `rate`/`burst` de la zona `bh_login` en `/etc/nginx/conf.d/00-burgerhause-zones.conf` y `/etc/nginx/sites-available/burgerhause.conf`, `sudo nginx -t && sudo systemctl reload nginx` |
| "Sin conexión" en pantallas / **el tiempo real se corta** | Se cortó el stream (`/api/events`): reinicio de la app, Nginx con buffering o timeouts, o internet del local | El navegador reconecta solo (3 s) y recarga datos. Si pasa cada minuto: `sudo nginx -T \| grep -A8 "location = /api/events"` debe mostrar `proxy_buffering off` y `proxy_read_timeout 1h`; comprobar que no haya otro proxy/Cloudflare delante con timeout corto. `curl -sN https://<TU_DOMINIO>/api/events` debe devolver 401 (sin sesión), no colgarse |
| **No se puede subir una imagen** (413 o "imagen demasiado grande") | La app limita a 5 MB por imagen; Nginx a 6 MB en `/api/uploads` | Reducir la foto (menos de 5 MB). Si es menor y falla: `grep client_max_body_size /etc/nginx/sites-available/burgerhause.conf` (debe haber `6m` en `/api/uploads`) |
| La imagen sube pero **no se ve** | Nginx no puede leer la carpeta (permisos/grupo) | `sudo -u www-data ls /var/lib/burgerhause/uploads \| head`; si dice "Permission denied": `id www-data` (debe incluir `burgerhause`), `sudo usermod -aG burgerhause www-data && sudo systemctl restart nginx`, `ls -ld /var/lib/burgerhause` (750, grupo burgerhause) |
| **"No se puede iniciar sesión"** | Usuario/clave mal, usuario inactivo, demasiados intentos (429), sesión invalidada por cambio de `SESSION_SECRET`, o se entró por `http://` (la cookie solo funciona con HTTPS) | Probar con `https://`; esperar 1 minuto si hubo muchos intentos; reiniciar la clave del admin (sección 6); revisar que el usuario esté activo en Admin → Usuarios. `journalctl -u burgerhause --since "10 min ago"` |
| **El menú no se actualiza** en la web pública | Los cambios hechos desde Admin se reflejan al instante. Si se cambió la base por fuera (restauración, SQL manual) el menú en memoria queda viejo hasta 1 hora | `sudo systemctl restart burgerhause` |
| **Pedidos duplicados** | El cliente apretó dos veces (la app los deduplica por clave) o hay **dos instancias** de la app | `pgrep -fc "next/dist/bin/next start"` debe dar `1`; `systemctl status burgerhause` debe mostrar un solo proceso principal. Si hay dos: `sudo systemctl stop burgerhause`, `sudo pkill -f "next/dist/bin/next start"`, `sudo systemctl start burgerhause`. Nunca levantar otra copia a mano |
| Un **ticket sale dos veces** | Dos agentes con el mismo token, o reimpresión manual | Ver 5.3, punto 6; dejar un agente por estación |
| **No imprime** | Agente caído, impresora, Spooler | Sección 5.3 |
| `deploy.sh` falla en **migrate** | Base caída/clave mal, o una migración con error | La versión en uso no se tocó. Leer el mensaje (código de PostgreSQL). `sudo -u burgerhause psql -d burgerhause -c 'select 1'`. Si el aviso dice "destructive migration refused": ver el checklist de 3.3. Si es un error de la migración: avisar al soporte con las últimas 30 líneas (sin la URL de la base) |
| `deploy.sh` falla en **build** con "Killed" o "out of memory" | Poca RAM | Agregar swap (2.3) y repetir |
| `deploy.sh` dice "another deploy is running" | Hay otro deploy en curso, o quedó un candado viejo | Esperar; si no hay ninguno: `ps aux \| grep deploy.sh`; el script limpia solo un candado de un proceso muerto |
| `deploy.sh` terminó en **código 3** | La versión nueva no pasó el chequeo de salud y se volvió a la anterior | Está funcionando la anterior. `journalctl -u burgerhause --since "15 min ago" --no-pager` muestra por qué falló la nueva |
| El **certificado venció** / el navegador avisa "no seguro" | Falló la renovación | `sudo certbot renew` y leer el error; que el DNS apunte a la VPS y el puerto 80 esté abierto (`sudo ufw status`); `sudo systemctl status certbot.timer`; después `sudo systemctl reload nginx` |
| `nginx -t` falla tras copiar la configuración | Falta el certificado, o quedó `burgerhause.example.com` sin reemplazar | `sudo grep -n example.com /etc/nginx/sites-available/burgerhause.conf` (no debe haber nada); ver 2.11 |
| El backup no corrió (`check-backup.sh` dice STALE/MISSING) | El timer no está activo, falló el dump (clave/base) o no hay disco | `systemctl list-timers burgerhause-backup.timer`; `journalctl -u burgerhause-backup -n 50 --no-pager`; `df -h`; correr a mano (4.3) |
| El backup termina con error pero hay `.dump` nuevo | Falló la copia de fotos o la copia remota (códigos 3 y 4) | El log dice cuál; revisar `BACKUP_REMOTE`, la clave y `known_hosts` (4.4) |
| Disco lleno | Logs, backups o releases | `sudo du -xh /var /opt --max-depth=2 \| sort -h \| tail`; `sudo journalctl --vacuum-size=500M`; borrar releases viejas: `ls /opt/burgerhause/releases` (dejar la actual y la anterior) |
| Cambió la hora / los reportes salen corridos | Zona horaria o NTP | `timedatectl` (2.4) |

---

## 10. Datos de arranque del día 1 (orden de carga)

Con el sistema recién instalado (2.14) está vacío y **cerrado a pedidos**. Cargá en este orden, entrando como
administrador a `https://<TU_DOMINIO>/admin`:

1. **Administrador**: ya creado en 2.14. Guardá su clave en un gestor de claves.
2. **Ajustes** (Admin → Ajustes): nombre del local, dirección, teléfono, WhatsApp, alias y CBU para transferencias,
   costo de envío, horarios (texto que ven los clientes). El interruptor de **aceptar pedidos** sigue apagado.
3. **Estaciones** (Admin → Estaciones): crear las 9 (4 de mostrador y 5 de delivery). Al crear/rotar se muestra el
   **token una sola vez**: anotarlo en la planilla de `print-agent-install.md` (sección 12) y cargarlo en el
   instalador de cada PC. El token no se guarda en ningún archivo del servidor.
4. **Usuarios** (Admin → Usuarios): una cuenta por persona (cajeras, encargada de delivery). Claves iniciales
   largas; cada una la cambia luego.
5. **Cadetes** (Admin → Cadetes): los repartidores.
6. **Menú real**: categorías (Admin → Menú), productos con **foto** (hasta 5 MB cada una), precios, y los
   **modificadores** (Admin → Modificadores: quitar ingredientes, agregados, cambios) asociados a cada producto.
7. **Instalar los agentes de impresión** en las 9 PCs (`docs/ops/print-agent-install.md`) y hacer un ticket de
   prueba en cada una (tiene que salir el **logo** arriba y "GRACIAS POR TU COMPRA"; si no, el agente es viejo: `update.ps1`).
   Delivery imprime ticket de delivery + ticket del cliente; Mostrador imprime solo el del cliente; no hay comanda de cocina.
8. **Pedido de prueba completo**: hacer un pedido desde el celular, aprobarlo en la pantalla del sector (un pedido de
   **delivery** se aprueba en **Gestión Delivery**; uno de **retiro** en **Retiro en local**), ver que imprime en la
   estación que lo aprobó y cobrarlo. Comprobar también que el de delivery NO aparece en el mostrador y viceversa. Después anularlo/borrarlo según el procedimiento del local.
9. **Práctica de restauración** (4.6) y **monitor externo** (5.2).
10. **Abrir pedidos**: Admin → Ajustes → activar **aceptar pedidos**. Probar desde un celular fuera de la red
    del local que `https://<TU_DOMINIO>` carga el menú.

`pnpm db:init-prod` deja en la base una marca (`deployment = production` en los ajustes): desde ese momento el seed de demo
se **niega** a correr sobre esa base aunque alguien lo intente desde SSH sin `NODE_ENV` (solo `ALLOW_DEMO_SEED=1` lo
fuerza; no lo uses en el servidor).

Si en algún momento ves productos de ejemplo ("Ranchita simple", "Melt simple"...), alguien cargó el seed de demo:
avisalo al soporte antes de seguir (los datos de prueba se borran con cuidado, no con SQL a ciegas).

---

## 11. Plan de contingencia

Principio: **el local nunca deja de vender porque falle el sistema.** El procedimiento detallado para el personal
(pedidos a mano, reimpresión, qué hacer al volver) está en `docs/ops/print-agent-install.md`, sección 13. Resumen:

| Situación | Qué hace el local | Qué hacés vos |
| --- | --- | --- |
| **Falla una impresora** | La Caja avisa en rojo y reintenta sola. Resolver papel/cable/tapa y apretar **Reimprimir**. Mientras, la cocina lee el pedido en la pantalla de la Caja (no hay comanda impresa) | Sección 5.3 |
| **Se cae el sistema (502/503)** | Tomar pedidos **a mano** en un block (número correlativo, hora, productos, aclaraciones, dirección/teléfono, forma de pago, total) y pasarlos a cocina en papel | Diagnóstico: sección 9 (502). Si no se resuelve en 15 minutos: `sudo systemctl restart burgerhause`; si fue un deploy: `deploy.sh rollback`; si es la base: sección 4.5. Avisar al local el estado cada 15 minutos |
| **Se cae internet en el local** | Igual: pedidos a mano. Las pantallas y los agentes reconectan solos al volver internet; los pedidos aprobados durante la caída se imprimen en orden, una sola vez cada uno | Nada en el servidor; verificar luego `/api/health` |
| **Se cae la VPS entera** | Pedidos a mano. Los clientes que piden por la web no pueden entrar: avisar por WhatsApp/redes | Reiniciar desde el panel de Contabo; si no vuelve, reconstruir con 4.5 ("si se perdió la VPS entera") |
| **Se perdió información** | Pedidos de la libreta: cargar en la Caja solo lo necesario para totales/rendición | Restaurar el último backup (4.5); explicar al local que faltan los pedidos posteriores al backup (hasta 24 horas en el peor caso) |
| **Fuga de una clave/token** | — | Sección 6 inmediatamente |

Al volver el sistema: **no reimprimir** pedidos ya entregados y cargar los pedidos de la libreta solo si hacen
falta para la rendición, marcándolos en la libreta para no duplicarlos.

Contactos a completar por la persona dueña: soporte técnico `<TELÉFONO_SOPORTE>`, Contabo `<DATOS_DE_CUENTA>`,
proveedor de internet del local `<TELÉFONO_ISP>`, dominio/DNS `<PROVEEDOR_DNS>`.

---

## 12. Mejoras futuras (pendientes conocidos, no bloquean el uso)

- Chequeo de espacio libre en disco antes de un backup o deploy, y borrado de archivos `.partial` huérfanos de backups interrumpidos.
- `restore-db.sh --force-live`: renombrar la base actual en vez de borrarla (quedaría una copia de seguridad extra hasta confirmar).
- Acotar `ProtectSystem=strict` de la app (hoy permite escribir en `/opt/burgerhause/releases` por el caché de Next): enlazar `.next/cache` a una carpeta propia.
- Crecimiento de la copia remota de backups (no se borra nada allá): tarea periódica de limpieza en el otro equipo.
- Memoria durante el `build` en VPS chicas: correrlo con `nice` y/o `NODE_OPTIONS=--max-old-space-size`.
