# Instalación del Print Agent en las PCs del local (guía paso a paso)

Esta guía es para quien instala el programa que **imprime los tickets y comandas** en cada PC del local
(4 de mostrador y 5 de delivery). No hace falta saber programar: solo seguir los pasos en orden, copiando
y pegando los comandos. Tiempo: unos 15 a 20 minutos por PC.

Qué hace el instalador: copia el programa a `C:\BurgerHouseAgent`, guarda la configuración (con el token
protegido para que solo lo lean Administradores), comprueba que el servidor y el token funcionan, y crea una
**tarea programada de Windows** que arranca el agente sola cuando se prende la PC y lo reinicia si se cae.
No hace falta iniciar sesión ni dejar nada abierto. Solo hace conexiones hacia afuera (no abre puertos).

Documentos relacionados: protocolo del lado servidor `docs/ops/print-agent-protocol.md`, README del paquete
`packages/print-agent/README.md`.

## 0. Antes de empezar: qué necesitás tener

Por cada PC:

| Qué | Cómo comprobarlo |
| --- | --- |
| Windows 10 u 11, con internet | Se abre una página web cualquiera |
| La impresora térmica **instalada en Windows** y que imprime la **página de prueba de Windows** | Paso 1 |
| Poder entrar al sistema con un usuario **admin** | Entrás a `https://<tu-servidor>/admin` |
| Un usuario de Windows que sea **Administrador** de la PC | Paso 5 |
| La dirección del sistema (la que empieza con `https://`) | Es la misma que usan en el navegador |

Además, el ZIP del instalador: `burgerhause-print-agent-<versión>.zip` (y su archivo `.sha256`).

## 1. Dejar la impresora lista en Windows

1. Conectá la impresora por USB y prendela. Cargá el papel.
2. Instalá su driver (el que trae el CD o la web del fabricante). Si no tenés driver, sirve el driver
   **Generic / Text Only**. No hace falta Zadig ni cambiar el driver.
3. Abrí **Inicio → Configuración → Dispositivos → Impresoras y escáneres**, hacé clic en la impresora →
   **Administrar** → **Imprimir página de prueba**.
4. Tiene que **salir papel** con la página de prueba de Windows. Si no sale, no sigas: primero hay que arreglar
   la impresora (cable, papel, driver).
5. Anotá el **nombre exacto** de la impresora tal como aparece en esa lista (por ejemplo `POS-80`). Si el
   nombre tiene comillas, `;`, `|`, `%`, `<`, `>`, `*` o `?`, renombrala (clic en la impresora → *Administrar* →
   *Propiedades de la impresora* → pestaña *General* → cambiar el nombre) por algo simple como `Ticketera`.

## 2. Obtener el token de la estación

Cada PC tiene su propia **estación** (Mostrador 1, 2, 3, 4; Delivery 1 a 5) y cada estación su propio token.
**Nunca usar el mismo token en dos PCs**: la segunda desconecta a la primera.

1. En el navegador entrá a `https://<tu-servidor>/admin/estaciones` con un usuario admin.
2. Buscá la estación de esta PC y apretá **Generar token** (o **Rotar token** si ya tenía).
3. Aparece el token, una sola vez. Empieza con `bhst_` y tiene 48 caracteres. **Copialo** (botón de copiar o
   seleccionar y Ctrl+C) y dejalo a mano (no lo mandes por chat ni lo escribas en papeles que queden a la vista).
   Si lo perdés, se vuelve a **Rotar** y se genera otro.

## 3. Bajar y descomprimir el instalador

1. Copiá el ZIP a la PC (pendrive o descarga). Si tenés el archivo `.sha256`, podés comprobar que no se dañó:
   en PowerShell `Get-FileHash .\burgerhause-print-agent-0.1.0.zip -Algorithm SHA256` debe mostrar el mismo
   código largo que dentro del archivo `.sha256`.
2. Clic derecho en el ZIP → **Extraer todo…** → carpeta destino `C:\Instalador` → **Extraer**.
3. Adentro queda una carpeta `burgerhause-print-agent-0.1.0` con los archivos `install.ps1`, `status.ps1`,
   `update.ps1`, `uninstall.ps1`, `print-agent.cjs` y otros. No los abras con doble clic: se usan desde PowerShell.

## 4. Node.js (el programa necesita Node 20 o superior)

Elegí **una** de las dos opciones. El instalador usa primero el Node portable (B) si existe, si no el que esté
instalado en la PC (A).

**Opción A: instalar Node en la PC (necesita ser Administrador)**

1. Entrá a `https://nodejs.org`, descargá la versión **LTS** (20 o más nueva) para Windows (`.msi`, 64 bits).
2. Abrí el `.msi` y seguí el asistente dejando todo por defecto (Siguiente, Siguiente, Instalar).
3. Para comprobar, abrí PowerShell (paso 5) y escribí `node --version`. Esperado: `v20.x.x` o mayor.

**Opción B: Node portable (sin instalador)**

1. Entrá a `https://nodejs.org/dist/latest-v20.x/` y descargá el archivo `node-v20.x.x-win-x64.zip`.
2. Extraelo y copiá **el contenido de la carpeta** (donde está `node.exe`) para que quede exactamente en
   `C:\BurgerHouseAgent\node\node.exe`. (Si la carpeta `C:\BurgerHouseAgent` no existe, creala.)

## 5. Abrir PowerShell como Administrador

1. Apretá el botón **Inicio** de Windows y escribí `PowerShell`.
2. Aparece **Windows PowerShell**. Hacé **clic derecho → Ejecutar como administrador**.
3. Windows pregunta "¿Desea permitir que esta aplicación haga cambios…?": **Sí**.
4. Tiene que decir `PS C:\WINDOWS\system32>` y la barra de arriba dice **Administrador: Windows PowerShell**.
   Si no dice "Administrador", cerrala y repetí.

Entrá a la carpeta del instalador (copiá y pegá con clic derecho, y Enter):

```powershell
cd C:\Instalador\burgerhause-print-agent-0.1.0
```

Esperado: el cursor pasa a `PS C:\Instalador\burgerhause-print-agent-0.1.0>`.

## 6. Elegir ancho de papel y página de códigos

- **Ancho de papel**: medí el ancho del rollo. **58 mm** → 32 caracteres por línea; **80 mm** → 48 caracteres
  por línea. Si dudás, empezá con `80` y mirá el ticket de prueba: si el texto se corta en el borde, probá `58`.
- **Página de códigos** (`-CodePage`): es la tabla de letras que usa la impresora. Empezá con `cp858` (viene por
  defecto). Si en el ticket de prueba los acentos salen mal, repetí la instalación con otra:

| Qué se ve en el ticket de prueba | Qué hacer |
| --- | --- |
| `á é í ó ú ñ ¿ ¡` correctos | Dejar `cp858` |
| Letras raras en vez de acentos | Probar `cp437`, después `cp850`, después `wpc1252` |
| Con `cp437` las mayúsculas acentuadas (Á É Í Ó Ú) salen sin tilde | Es normal en esa tabla: preferir `cp858` o `cp850` |
| Símbolos raros en lugar de letras con todas las tablas | La impresora no entiende la tabla: anotar el modelo y avisar al soporte |

## 7. Instalar

Pegá este comando **en una sola línea**, cambiando lo que está entre `<>`:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\install.ps1 -ServerUrl https://<tu-servidor> -PrinterName "<nombre de la impresora>" -PaperWidth 80 -CodePage cp858
```

(`powershell … -ExecutionPolicy Bypass -File` evita el aviso de Windows de que "la ejecución de scripts está
deshabilitada". Solo vale para este comando.)

Qué pasa y qué tenés que hacer:

1. Si no pusiste `-PrinterName`, muestra una lista numerada de impresoras: escribí el número y Enter.
2. Pide el token: **"Pegá el token de la estación…"**. Pegalo con clic derecho (no se ve nada mientras se pega: es
   normal) y apretá Enter.
3. Pregunta **"Imprimir un ticket de prueba ahora (s/N)"**: escribí `s` y Enter. **Tiene que salir un ticket** con
   el título grande, acentos, negrita, tamaño doble y el corte.

Salida esperada (resumida):

```
== Revisando los datos
  [OK] Datos válidos
== Buscando el programa y Node.js
  [OK] Node.js v20.x.x: C:\Program Files\nodejs\node.exe
== Copiando archivos
  [OK] Archivos en C:\BurgerHouseAgent (config.json solo legible por Administradores y SYSTEM)
== Verificando la configuración y la conexión con el servidor
  Servidor: OK (https://...), la estación quedó marcada como activa. Diferencia de reloj con el servidor: 0 s
  [OK] Servidor y token verificados
== Ticket de prueba
  [OK] Ticket de prueba enviado: revisá el papel (acentos, negrita, corte)
== Registrando la tarea programada
  [OK] Tarea 'BurgerHouseAgent' registrada
  [OK] El agente está conectado al servidor
=== Instalación terminada ===
```

Si algo falla, el instalador **no deja nada a medias**: se detiene con un mensaje en rojo que explica el motivo y
cómo arreglarlo (ver la tabla de problemas de la sección 11) y se puede volver a correr el mismo comando.
Si ya había una instalación, pide agregar `-Force` al final.

Si querés **ver qué haría sin cambiar nada**, agregá `-DryRun` al final del comando.

## 8. Comprobar que funciona

1. Estado desde PowerShell (como Administrador):

   ```powershell
   powershell -NoProfile -ExecutionPolicy Bypass -File .\status.ps1
   ```

   Esperado al final: `Todo bien.` (estado de la tarea `Running`, proceso corriendo, chequeo correcto).
2. En el sistema, entrá a la **Caja** desde esa PC eligiendo **la estación de esa PC**. Arriba tiene que decir
   **"Impresora lista"** (si dice "Sin agente", mirá la tabla de problemas).
3. Hacé un **pedido de prueba** (por ejemplo una venta de mostrador de un producto barato), aprobalo y
   comprobá que salen **los dos papeles**: la comanda de cocina y el ticket, y que los chips del pedido pasan a
   "Impresión: ok". Después cancelá o anulá ese pedido de prueba según la rutina del local.
4. **Prueba de reinicio**: reiniciá la PC (Inicio → Reiniciar). **No inicies sesión ni abras nada.** Esperá 2 minutos,
   y desde otra PC mirá en `Admin → Estaciones` que la estación aparezca **Conectada**, o entrá a la Caja de esa
   PC y comprobá "Impresora lista". Tiene que volver sola.

Si pasó todo, completá la fila de esta PC en la lista de la sección 12.

## 9. Uso diario y mantenimiento

Todos los comandos se escriben en PowerShell abierto **como Administrador**, dentro de la carpeta del instalador
(`cd C:\Instalador\burgerhause-print-agent-0.1.0`). Para `update.ps1` hay que usar la carpeta de la versión nueva.

| Qué querés hacer | Comando |
| --- | --- |
| Ver el estado completo | `powershell -NoProfile -ExecutionPolicy Bypass -File .\status.ps1` |
| Ver el log en vivo (Ctrl+C para salir) | `Get-Content C:\BurgerHouseAgent\data\logs\agent.log -Tail 30 -Wait` |
| Imprimir un ticket de prueba | `& "C:\BurgerHouseAgent\node\node.exe" "C:\BurgerHouseAgent\print-agent.cjs" test-print` (con Node instalado: `node C:\BurgerHouseAgent\print-agent.cjs test-print`) |
| Reiniciar el agente | `Stop-ScheduledTask BurgerHouseAgent; Start-ScheduledTask BurgerHouseAgent` |
| Actualizar a una versión nueva | Descomprimir el ZIP nuevo y, en esa carpeta: `powershell -NoProfile -ExecutionPolicy Bypass -File .\update.ps1` |
| Desinstalar (conserva configuración y logs) | `powershell -NoProfile -ExecutionPolicy Bypass -File .\uninstall.ps1` |
| Desinstalar y borrar todo | `powershell -NoProfile -ExecutionPolicy Bypass -File .\uninstall.ps1 -RemoveData` |

El log está en `C:\BurgerHouseAgent\data\logs\agent.log` (rota solo a 1 MB, guarda 5 archivos). Los tokens nunca
aparecen en el log (se muestran como `bhst_***`). La carpeta `C:\BurgerHouseAgent` solo la pueden abrir
Administradores: por eso hay que usar PowerShell como Administrador para leer el log.

**Rotar el token** (si se perdió, se filtró o se cambia la PC):

1. `Admin → Estaciones` → botón **Rotar token** de esa estación → copiar el nuevo token. **El token anterior deja de
   funcionar al instante**: la impresión de esa estación queda en pausa hasta cargar el nuevo.
2. En la PC, PowerShell como Administrador, en la carpeta del instalador, repetí el comando de instalación con
   `-Force` (pide el token nuevo, lo verifica y reinicia el agente):

   ```powershell
   powershell -NoProfile -ExecutionPolicy Bypass -File .\install.ps1 -ServerUrl https://<tu-servidor> -PrinterName "<nombre de la impresora>" -PaperWidth 80 -CodePage cp858 -Force
   ```

   Los trabajos que quedaron pendientes se imprimen al reconectar, una sola vez cada uno.

## 10. Opciones del instalador (referencia)

| Parámetro | Para qué | Por defecto |
| --- | --- | --- |
| `-ServerUrl` | Dirección `https://` del sistema (obligatorio) | |
| `-Token` | Token de la estación. Mejor **no** escribirlo en el comando: si se omite, se pide sin mostrarlo | se pide |
| `-PrinterName` | Nombre exacto de la impresora en Windows. Si se omite, muestra la lista para elegir | se elige |
| `-PaperWidth` | `58` o `80` | `80` |
| `-CodePage` | `cp858`, `cp437`, `cp850` o `wpc1252` | `cp858` |
| `-InstallDir` | Carpeta de instalación | `C:\BurgerHouseAgent` |
| `-NodeExe` | Ruta a un `node.exe` (si no está el portable ni en el PATH) | |
| `-TaskName` | Nombre de la tarea programada | `BurgerHouseAgent` |
| `-TestPrint` | Imprime el ticket de prueba sin preguntar | pregunta |
| `-NoPrompt` | No hace ninguna pregunta (para automatizar) | |
| `-DryRun` | Muestra qué haría y el XML de la tarea, sin cambiar nada | |
| `-Force` | Reinstala/actualiza una instalación existente (conserva el historial) | |
| `-AllowInsecure` | Permite `http://localhost` (solo pruebas) | |

Códigos de salida (`$LASTEXITCODE`): 0 listo · 1 error inesperado · 2 datos inválidos · 3 falta ser Administrador ·
4 ya instalado (usar `-Force`) · 5 Node.js ausente o menor a 20 · 6 falló la verificación (token/servidor/impresora) ·
7 la tarea no se pudo iniciar o no se conectó en 30 s · 8 no hay instalación (status/update).

La tarea programada: se llama `BurgerHouseAgent`, usuario SYSTEM, arranca 30 s después de prender Windows, se
reinicia sola cada 1 minuto si se cae (hasta 999 veces), sin límite de tiempo, no se ve ninguna ventana.

## 11. Problemas frecuentes

| Qué pasa | Causa probable | Qué hacer |
| --- | --- | --- |
| "Este programa necesita permisos de Administrador. Abrí PowerShell como Administrador…" | La ventana no es de Administrador | Paso 5: Inicio → PowerShell → clic derecho → Ejecutar como administrador |
| "La ejecución de scripts está deshabilitada en este sistema" | Política de PowerShell | Usar el comando completo con `powershell -NoProfile -ExecutionPolicy Bypass -File …` |
| "El token no tiene el formato esperado" | Token cortado o con espacios | Copiar de nuevo completo desde Admin → Estaciones (empieza con `bhst_`, 48 caracteres) |
| "Token inválido o rotado: generá uno nuevo en Admin → Estaciones" | El token está mal, se rotó o es de otra estación | Rotar el token y reinstalar con `-Force` (sección 9) |
| "La dirección del servidor debe empezar con https://" | URL mal escrita | Usar la dirección exacta del sistema, con `https://` y sin nada después del dominio |
| "No se pudo conectar con el servidor" | Sin internet, firewall, proxy o URL mal | Abrir la URL en el navegador de esa PC; en PowerShell: `Test-NetConnection <dominio> -Port 443` debe decir `TcpTestSucceeded : True`; revisar firewall/proxy del local |
| "Diferencia de reloj con el servidor" de varios minutos | Fecha/hora de la PC mal | Configuración → Hora e idioma → Fecha y hora → **Sincronizar ahora**; zona horaria correcta |
| "Hace falta Node.js 20 o superior" / "No se encontró Node.js" | Falta Node o es viejo | Sección 4 |
| "La impresora no está lista: desconectada / sin papel / tapa abierta…" | La impresora informa a Windows un problema | Prender, conectar el USB, poner papel, cerrar la tapa; el sistema reintenta solo y, si pasan 3 intentos, avisa en rojo en la Caja con el botón **Reimprimir** |
| "No se encontró la impresora …" / "PRINTER_NAME no coincide" | El nombre cambió o está mal escrito | Mirar el nombre exacto en Impresoras y escáneres y reinstalar con `-Force -PrinterName "…"` |
| El ticket sale pero con acentos raros | Página de códigos incorrecta | Tabla de la sección 6; reinstalar con `-Force -CodePage cp437` (u otra) |
| El texto se corta en el borde / sobra margen | Ancho de papel mal | Reinstalar con `-Force -PaperWidth 58` (u 80) |
| Log: "Otro agente se conectó para esta estación…" (`replaced`) | Hay **otra PC o proceso con el mismo token** | Dejar un solo agente por estación; en la PC equivocada correr `uninstall.ps1`, y rotar el token de la estación |
| La Caja dice "Sin agente" | El agente no está conectado | `status.ps1`; si la tarea no corre: `Start-ScheduledTask BurgerHouseAgent`; mirar el log; comprobar internet |
| Dice "impreso" pero no sale papel | El driver no informa el estado de la impresora (algunos genéricos) | Anotar modelo y driver en la planilla y avisar al soporte: no se puede detectar desde el software |
| Se instaló pero la PC reiniciada no imprime | La tarea no arrancó | `status.ps1` y revisar "Último resultado" de la tarea y el log |

Si ninguna fila ayuda: sacar una foto de la ventana de PowerShell con el mensaje rojo, copiar las últimas 30 líneas
del log (`Get-Content C:\BurgerHouseAgent\data\logs\agent.log -Tail 30`) y enviarlas al soporte. **No enviar el token.**

## 12. Planilla de las 9 PCs

Completar una fila por PC al terminar. "Token rotado" es la fecha en que se generó el token que está cargado.

| Estación | PC (nombre / lugar) | Impresora (nombre en Windows) | Ancho | Código | Token rotado (fecha) | Instalado por | Ticket de prueba OK | Reinicio OK |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Mostrador 1 | | | | | | | [ ] | [ ] |
| Mostrador 2 | | | | | | | [ ] | [ ] |
| Mostrador 3 | | | | | | | [ ] | [ ] |
| Mostrador 4 | | | | | | | [ ] | [ ] |
| Delivery 1 | | | | | | | [ ] | [ ] |
| Delivery 2 | | | | | | | [ ] | [ ] |
| Delivery 3 | | | | | | | [ ] | [ ] |
| Delivery 4 | | | | | | | [ ] | [ ] |
| Delivery 5 | | | | | | | [ ] | [ ] |

(Las estaciones se crean en `Admin → Estaciones`; el nombre de la planilla tiene que coincidir con el del sistema.)

## 13. Plan de contingencia (si falla el sistema o una impresora)

**Si una impresora no imprime** (sin papel, apagada, desconectada):

1. La Caja avisa en rojo y reintenta sola (3 veces). Resolver lo básico: papel, cable, encendido, tapa.
2. Cuando la impresora vuelve, apretar **Reimprimir** en el aviso rojo (o en **Recientes → Reimprimir** y elegir
   comanda o ticket). Sale una sola vez.
3. Mientras tanto, la cocina puede trabajar **leyendo el pedido desde la pantalla de la Caja** o escribiéndolo a mano.
4. Si la impresora de una estación no se puede recuperar en el momento, usar la de otra estación: en esa PC
   entrar a la Caja y reimprimir el pedido desde **Recientes** (se imprime en la estación en la que estás).

**Si el sistema no responde o se cae internet en el local:**

1. Seguir **tomando pedidos a mano** en un block, con número correlativo, fecha/hora, productos, aclaraciones
   (sin cebolla, etc.), dirección o teléfono si es delivery, forma de pago y total.
2. Pasar el papel a cocina igual que siempre. El cobro sigue como siempre (efectivo/transferencia).
3. Los agentes **reconectan solos** cuando vuelve internet y no repiten tickets ya impresos. Los pedidos que se
   aprobaron mientras estaba caído se imprimen en orden al reconectar (pueden salir juntos, de golpe).
4. Al volver el sistema: cargar los pedidos anotados a mano desde la Caja **solo si todavía hacen falta para los
   totales/rendición** y marcarlos en la libreta como cargados, para no duplicar. **No** reimprimir pedidos que ya
   fueron entregados.
5. Si el problema es de internet y dura más de unos minutos, avisar al proveedor; si el sistema web está caído con
   internet funcionando, avisar al soporte.

## 14. Lo que falta confirmar con la impresora real (a cargo de la persona dueña del local)

El software se probó con una impresora simulada y con la cola de Windows, **no con la impresora definitiva**. Falta
confirmar en el local, con el modelo real (anotar resultado en la planilla):

- [ ] Marca, modelo, ancho de papel y página de códigos que funcionan (pregunta abierta 2 del diseño).
- [ ] El ticket de prueba sale completo: título grande, acentos (`á é í ó ú ñ ¿ ¡ °`), negrita, tamaño doble y el **corte** (que sea
      parcial y no desperdicie mucho papel).
- [ ] Impresora desenchufada/apagada/sin papel: el agente informa el problema y la cola de Windows no acumula
      trabajos (algunos drivers no informan su estado; ver tabla de problemas).
- [ ] Un tiempo de impresión aceptable en la PC más lenta (cada ticket arranca PowerShell: 1 a 3 s es lo normal;
      si pasa de ~6 s, avisar).
- [ ] Reinicio en frío en cada una de las 9 PCs: el agente vuelve solo, sin iniciar sesión.
- [ ] Prueba completa con pedidos reales: salen la comanda y el ticket, y los chips pasan a "Impresión: ok".
- [ ] Que el instalador funcione con el Windows y las políticas de seguridad (antivirus, usuarios sin permisos) de
      las PCs reales.

Los pasos técnicos detallados de esa verificación están en la lista del README del paquete
(`packages/print-agent/README.md`, "Verificación manual con la impresora real").
