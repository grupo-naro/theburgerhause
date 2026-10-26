# Plan de contingencia

**Principio: el local nunca deja de vender porque falle el sistema.** Con papel y lapicera se sigue vendiendo. Este plan es para
el personal (parte 1) y para quien da soporte (parte 2). Complementa `docs/ops/runbook.md` secciones 5.3, 9 y 11 y
`docs/ops/print-agent-install.md` sección 13.

Cómo llega el pedido a la cocina: con el **ticket de cocina impreso** (sale primero, en la misma impresora que el ticket del cliente). La cocina ya no tiene pantalla propia; el **televisor del mostrador** (`/pantalla`) solo muestra números a los clientes (ver [Guía de cocina y del televisor](guia-cocina.md)). Si la impresora falla, la cocina no recibe el papel: reimprimí el ticket de cocina (cuadro rojo o **Recientes → Reimprimir → Ticket cocina**) o dictalo; mientras tanto la cocina puede leer el pedido en **En preparación** de la pantalla de la cajera y la encargada. Si el televisor falla (se apagó la PC, se cortó internet), la venta y la cocina **no se frenan**: la cajera sigue marcando **Listo** / **Entregado** como siempre y llama a los clientes en voz alta; al volver, el televisor muestra el estado correcto solo.

## Parte 1: Qué hace el personal

### Cómo darse cuenta de qué falló

| Señal en pantalla | Significa |
| --- | --- |
| **Sin conexión** / **Reconectando…** arriba, o la página no carga | Internet del local o el sistema |
| **Sin agente** (rojo) pero **En vivo** | Falló solo el programa de impresión de esa PC |
| Cuadro rojo **"N impresión(es) falló / fallaron"** | La impresora no imprimió (papel, tapa, cable, apagada) |
| Cartel de error / 502 / 503 al abrir el sistema | Se cayó el servidor |

### Papel de contingencia (block de comandas)

Tener **siempre** en cada puesto un block con renglones: **N.º correlativo** (empezar cada día en 1, con prefijo de la PC: M1-1, D2-1...),
**hora**, **productos y aclaraciones** (sin cebolla, etc.), **cliente + dirección + teléfono** (delivery), **forma de pago** (efectivo / transferencia
verificada), **total**, y para mostrador el **n.º de llamador**.

### Qué hacer en cada caso

| Situación | Qué hace el local | Cuándo vuelve a lo normal |
| --- | --- | --- |
| **Falla una impresora** (papel, cable, tapa) | Resolver lo básico; **Reimprimir** en el cuadro rojo. Mientras tanto el pedido sigue en la pantalla (y en el **televisor**, que no depende de la impresora) o se escribe a mano; **el ticket de cocina también sale por esa impresora**, así que dictalo o reimprimilo apenas se arregle. Si no se recupera: reimprimir desde otra estación (entrar a esa PC, **Recientes → Reimprimir**; sale en la estación en la que estás). | Sale un solo papel por reimpresión (el que elegiste). |
| **Agente caído** (**Sin agente** pero hay internet) | Esperar hasta **6 minutos**: se recupera solo. Seguir trabajando en la pantalla (los pedidos se aprueban igual; sus tickets quedan pendientes y salen al volver). Si pasan 10 minutos: llamar a soporte; mientras, anotar a mano lo que no salió. | Los tickets pendientes salen **una sola vez, en orden**, quizá todos juntos. Cortar el papel y **no** reimprimir esos. |
| **Se cae internet del local** | Pasar a **pedidos a mano** en el block (con cobro como siempre). Los pedidos web ya aprobados siguen su camino al volver; los que no se aprobaron esperan. Avisar al proveedor de internet. Si es posible, usar los datos del celular para entrar al sistema. | Las pantallas y los agentes reconectan **solos**. Verificar **En vivo** e **Impresora lista**. |
| **Se cae el sistema (servidor)** | **Pedidos a mano**. Los clientes no pueden pedir por la web: avisar por WhatsApp/redes (los pedidos web que ya habían entrado siguen en el sistema). Llamar a soporte. | Cuando entre, no reimprimir lo ya entregado. |
| **Se cae todo** | Igual: block, efectivo y transferencias (mirar el banco desde el celular). | Al volver, ver abajo. |

### Al volver el sistema

1. Verificar **En vivo** e **Impresora lista**.
2. **No reimprimir** pedidos ya entregados.
3. Cargar los pedidos de la libreta **solo si hacen falta** para los totales o la rendición de los cadetes. Marcar en la libreta cada pedido cargado
   para no duplicar. (Una venta de mostrador cargada tarde imprimirá un ticket: es esperable, descartarlo.)
4. Si faltan pedidos web que el cliente dice haber hecho, no inventar: buscar en **Recientes** y pedir a soporte revisar.

## Parte 2: Qué hace soporte

| Situación | Diagnóstico y acción |
| --- | --- |
| **Internet del local** | Ver si otros dispositivos andan; reiniciar router; llamar al proveedor `<TELÉFONO_ISP>`. El sistema está bien; no tocar la VPS. |
| **Agente caído en una PC** | `status.ps1`; `Get-Content C:\BurgerHouseAgent\data\logs\agent.log -Tail 30`; `Stop-ScheduledTask BurgerHouseAgent; Start-ScheduledTask BurgerHouseAgent`. Tabla de problemas: `print-agent-install.md` sección 11. Si el log dice "Otro agente se conectó para esta estación" hay dos agentes con el mismo token: dejar uno y rotar el token. |
| **Impresora** | Spooler (`Restart-Service Spooler`), cola de la impresora en Windows, driver y cable. Runbook sección 5.3 punto 3-4. |
| **Alerta "Ticket cliente: documento inválido"** | Agente anterior al logo: actualizarlo con `update.ps1` (agente 0.2.0). |
| **Servidor caído (502/503)** | `curl -s https://<TU_DOMINIO>/api/health`; `systemctl status burgerhause`; `journalctl -u burgerhause -n 100 --no-pager`; `sudo systemctl restart burgerhause`. Si falló después de un deploy: `sudo ./deploy/scripts/deploy.sh rollback` (runbook 3.3). Si es la base: `systemctl status postgresql`. Avisar al local **cada 15 minutos**. Runbook sección 9. |
| **VPS completa caída** | Reiniciar desde el panel de Contabo; si no vuelve, reconstruir con runbook 4.5 ("si se perdió la VPS entera"). |
| **Se perdió información** | Restaurar el último backup (runbook 4.5). Decirle al local que faltan los pedidos posteriores al backup (hasta 24 horas en el peor caso). Los pedidos en la libreta sirven. |
| **Fuga de clave o token** | Runbook sección 6 de inmediato. |

**Regla de tiempo**: si el sistema no vuelve en **15 minutos**, el local ya está trabajando en papel (no esperar). Si dura más de **1 hora**, el
dueño decide si se informa a los clientes web.

## Quién llama a quién (completar antes de salir)

| Rol | Nombre | Teléfono |
| --- | --- | --- |
| Responsable del local (decide) | | |
| Soporte técnico (primer llamado) | | |
| Soporte técnico (suplente) | | |
| Proveedor de internet del local | | |
| Contabo (cuenta) / dominio-DNS | | |

## Ensayo

Hacer **un simulacro** antes del primer día real (escenario F5 de `docs/guias/uat-prueba-de-aceptacion.md`): cortar el sistema 10 minutos y
operar con block. Verificar que cada puesto tiene el block, lapicera y el teléfono de soporte pegado.
