# Checklist de salida a producción (go-live)

Marcá cada punto con fecha e iniciales. Los puntos marcados **(SIN VERIFICAR)** nunca se probaron en el entorno real: hasta ahora solo se
probaron con simulaciones (Docker, impresora simulada, sin permisos de Administrador). **No los des por hechos.** La referencia técnica de cada
paso es `docs/ops/runbook.md` (R) y `docs/ops/print-agent-install.md` (A).

Datos a completar: dominio `__________`, IP de la VPS `__________`, responsable `__________`, fecha `__________`.

## 1. VPS (R sección 2)

- [ ] **(SIN VERIFICAR: VPS real)** VPS Contabo contratada; Ubuntu 22.04/24.04; usuario propio (no root), claves SSH, sin contraseña (R 2.2).
- [ ] **(SIN VERIFICAR)** Firewall ufw (solo SSH/HTTP/HTTPS), fail2ban, actualizaciones automáticas, swap, zona horaria Argentina (R 2.3, 2.4).
- [ ] PostgreSQL instalado, **puerto 5432 no expuesto** (`sudo ss -tlnp | grep 5432` muestra solo `127.0.0.1`) (R 2.8).
- [ ] Usuario de la app sin privilegios y carpetas con permisos (R 2.9).

## 2. DNS y TLS (R 2.11)

- [ ] El dominio apunta a la IP de la VPS (DNS propagado).
- [ ] **(SIN VERIFICAR: certbot real)** Certificado de Let's Encrypt emitido; renovación automática activa (`systemctl status certbot.timer`).
- [ ] `https://<dominio>` abre sin avisos; `http://` redirige a `https://`.
- [ ] `/api/events` no se corta por Nginx (`proxy_buffering off`, `proxy_read_timeout 1h`) (R sección 9).

## 3. Variables de entorno (R 2.10)

- [ ] `/etc/burgerhause/burgerhause.env` con `DATABASE_URL`, `SESSION_SECRET` (**32+ caracteres, generado al azar, distinto al de desarrollo**), `UPLOAD_DIR`.
- [ ] Copia **cifrada** del archivo `.env` guardada fuera de la VPS (gestor de claves). Sin ADMIN_PASSWORD en texto plano.

## 4. Migraciones y primer deploy (R 2.13, sección 3)

- [ ] `sudo ./deploy/scripts/deploy.sh` terminó bien (migra → compila → reinicia → `/api/health`).
- [ ] `curl https://<dominio>/api/health` responde `200` con `db: ok`.
- [ ] **Un solo proceso** de la app (`pgrep -fc "next/dist/bin/next start"` = 1).
- [ ] Rollback ensayado (`deploy.sh rollback`) o al menos leído y entendido por soporte (R 3.3).

## 5. Base de producción (R 2.14, sección 10)

- [ ] `pnpm db:init-prod` ejecutado (**NUNCA `db:seed`** en producción). Local **cerrado a pedidos**.
- [ ] Administrador creado; clave larga guardada en gestor de claves.
- [ ] No hay productos de demo ("Ranchita simple", "Melt simple" de ejemplo). Si aparecen, **parar** y avisar a soporte.

## 6. Datos reales (docs/guias/carga-del-menu.md)

- [ ] **Ajustes**: nombre, dirección, teléfono, WhatsApp, horarios, alias y CBU de transferencias, **costo de envío**.
- [ ] **Menú real**: categorías, productos con precios y **fotos**, modificadores asociados a cada producto. Revisado en el celular contra la carta actual.
- [ ] **Estaciones**: las 9 (Mostrador 1 a 4, Delivery 1 a 5), tipo correcto en cada una.
- [ ] **Usuarios**: una cuenta por persona (cajeras, encargada); contraseñas iniciales largas; cada una la cambia en su primer ingreso (el admin puede resetearla).
- [ ] **Cadetes** cargados.
- [ ] **Tokens** de las 9 estaciones generados y guardados (planilla de A sección 12; **no** por chat).

## 7. Agentes de impresión en las 9 PCs (A, completo)

- [ ] **(SIN VERIFICAR: Windows real con permisos de Administrador)** Prueba previa en UNA PC con tarea de prueba (A sección 14).
- [ ] **(SIN VERIFICAR: impresora real)** Marca, modelo, ancho de papel y página de códigos confirmados (A sección 15).
- [ ] Agente **versión 0.2.0** (o posterior) instalado **en las 9 PCs**. Una PC con agente viejo falla el ticket del cliente (logo) → `update.ps1`.

| Estación | Instalado y versión | `test-print` OK (logo + GRACIAS) | Reinicio en frío OK | Agente caído se recupera (≤6 min) | Impresora lista en pantalla |
| --- | --- | --- | --- | --- | --- |
| Mostrador 1 | | [ ] | [ ] | [ ] | [ ] |
| Mostrador 2 | | [ ] | [ ] | [ ] | [ ] |
| Mostrador 3 | | [ ] | [ ] | [ ] | [ ] |
| Mostrador 4 | | [ ] | [ ] | [ ] | [ ] |
| Delivery 1 | | [ ] | [ ] | [ ] | [ ] |
| Delivery 2 | | [ ] | [ ] | [ ] | [ ] |
| Delivery 3 | | [ ] | [ ] | [ ] | [ ] |
| Delivery 4 | | [ ] | [ ] | [ ] | [ ] |
| Delivery 5 | | [ ] | [ ] | [ ] | [ ] |

- [ ] **(SIN VERIFICAR: impresora real)** Tiempo de impresión aceptable en la PC más lenta (≤ ~6 s por ticket).
- [ ] Papeles probados con **pedidos reales**: Mostrador imprime 1 ticket (cliente con logo); Delivery imprime 2 (delivery + cliente con logo).
- [ ] Antivirus y políticas de las PCs no bloquean el instalador ni la tarea programada.

## 8. Backups (R sección 4)

- [ ] Timer diario activo (`systemctl list-timers burgerhause-backup.timer`); un backup completo existe y `check-backup.sh` dice `BACKUP_FRESH`.
- [ ] **Práctica de restauración hecha** en una base vacía con `restore-db.sh` hasta `RESTORE_OK`, y conteo de filas coherente (R 4.6). Fecha: ______
- [ ] **(SIN VERIFICAR: copia remota real)** Copia fuera de la VPS configurada (`BACKUP_REMOTE`) y probada (R 4.4).
- [ ] Proceso de "VPS perdida" leído por soporte (R 4.5).

## 9. Monitoreo (R sección 5)

- [ ] Monitor externo (UptimeRobot, etc.) sobre `https://<dominio>/api/health` cada 5 minutos, con aviso a un teléfono real.
- [ ] Revisión semanal anotada: `df -h`, backups, certificado.
- [ ] Soporte sabe mirar logs (`journalctl -u burgerhause`) y estado.

## 10. Seguridad (R secciones 8 y 13)

- [ ] Checklist de seguridad del runbook (sección 8) recorrido.
- [ ] `pnpm test:security` verde en el código desplegado; cabeceras y cookies `secure` comprobadas con `https://`.
- [ ] Ninguna clave en chats, mails ni papeles a la vista.

## 11. Capacitación y papeles

- [ ] Cajeras y encargada capacitadas con su guía de una página (`guia-cajera-mostrador.md`, `guia-encargada-delivery.md`); administrador con `guia-administrador.md`.
- [ ] Tarjeta **Primer día** impresa y pegada en cada PC, con teléfonos completados.
- [ ] **Block de contingencia** en cada puesto; plan de contingencia entregado; simulacro hecho (UAT F5).
- [ ] Rol de cada persona confirmado: ¿cajera en estación Mostrador? ¿encargada en Delivery?

## 12. UAT y operación en paralelo

- [ ] UAT completa y firmada (`uat-prueba-de-aceptacion.md`).
- [ ] Jornada en paralelo con pxw con **go** (`operacion-en-paralelo.md`).

## 13. Salida

- [ ] Backup manual hecho justo antes de abrir (`sudo systemctl start burgerhause-backup`, R 4.3).
- [ ] Ajustes → **Reanudar pedidos** (abre la tienda al público). Desde un celular fuera del local: la tienda carga y se puede hacer un pedido de prueba (cancelarlo).
- [ ] Soporte presente la primera jornada; teléfonos publicados.
- [ ] **Rollback listo**: `deploy.sh rollback` conocido; pxw disponible una semana; marcha atrás definida (`operacion-en-paralelo.md`).

## 14. Cierre del MVP

- [ ] Una semana estable sin incidentes graves. Lista de mejoras anotada. **Recién entonces** planificar la Fase 2.
