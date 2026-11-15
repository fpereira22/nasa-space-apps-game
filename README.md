# HOUSTON, WE HAVE A PROBLEM — U.S.S. Aether + NASA Open MCT

Desarrollado por:

- **Leidalí Carrillo Fernández**
- **Felipe Pereira Alarcón**
- **Name Last_Name Participante 3**
- **Name Last_Name Participante 4**



Juego cooperativo estilo *Keep Talking and Nobody Explodes*:

- **Astronauta** → juega el tablero de reparación (`/tablero.html`).
- **Control en tierra** → monitorea la nave en **[NASA Open MCT](https://github.com/nasa/openmct)** (`/`) y guía al astronauta por voz con el manual (`/manual.html`, también dentro de Open MCT).

El astronauta **no** tiene el manual. Control en tierra **no** ve el tablero, pero ve en Open MCT datos de la nave
que el astronauta no tiene, y algunas reglas dependen de ellos. Ninguno de los dos puede ganar solo.

```
 Tablero (astronauta) ──ws /game──▶ server.js ──ws /realtime──▶ Open MCT (control en tierra)
                                       └──── GET /history/:id ──▶ Open MCT (históricos)
 Tablero (astronauta) ◀──ws /chat──▶ server.js ◀──ws /chat──▶ chat.html (dentro de Open MCT)
 Tablero (astronauta) ◀═══ voz WebRTC directa (server.js solo presenta: ws /rtc) ═══▶ chat.html
```

## Cómo correrlo

Requiere Node 18+.

```bash
npm install
npm start
```

- Control en tierra (Open MCT): http://localhost:8080/
- Tablero del astronauta: http://localhost:8080/tablero.html

Para jugar en **varios computadores** de la misma red, usa las direcciones que muestra `npm start` al arrancar,
que usan **https** y el puerto **8443** (ej. `https://192.168.1.20:8443/tablero.html`). Se necesita https para que el
navegador permita usar el **micrófono** de la radio. El certificado lo genera el propio servidor (carpeta `.cert/`),
así que la primera vez el navegador muestra un aviso: **Configuración avanzada → Continuar**.
Con `http://IP:8080` también se puede jugar, pero sin micrófono (solo escuchar la radio).

Puertos distintos: `PORT=3000 HTTPS_PORT=3443 npm start`. Para desactivar HTTPS: `HTTPS=off npm start`.

El tablero también funciona solo (doble clic al archivo, sin telemetría). Para mandar telemetría
estando abierto como archivo: `tablero.html?telemetry=ws://IP:8080/game`. Para apagarla: `?telemetry=off`.

## Telemetría disponible en Open MCT (carpeta "U.S.S. Aether")

| Medición | Tipo | Límites |
|---|---|---|
| Tiempo restante | s | amarillo ≤ 60, rojo ≤ 30 |
| Strikes (errores) | 0–3 | amarillo 1, rojo ≥ 2 |
| Módulos reparados | 0–4 | — |
| Temperatura del reactor 📡 | K (simulada) | amarillo ≥ 1400, rojo ≥ 1800 |
| Polaridad de fase 📡 | POSITIVA / NEGATIVA (al azar por partida) | — |
| Integridad del casco | % | amarillo < 75, rojo < 40 |
| Estado de propulsores | NOMINAL / CRÍTICO | rojo en CRÍTICO |
| Estado de la misión | EN CURSO / REPARADA / DESTRUIDA | rojo en DESTRUIDA |
| Módulo 01–04 | FALLA / REPARADO | amarillo en FALLA |
| Registro de eventos | texto | — |

**Diseño a propósito:** no se envían los datos que ve el astronauta (colores de cables, serial, baterías,
frecuencia), así que el experto depende de que se los describa por voz. A la inversa, las mediciones 📡 solo
están en Open MCT y cambian las reglas:

- **Botón del núcleo:** si el reactor está en 1400 K o más al presionar, hay que pulsar y soltar rápido.
- **Sintonización de fase:** si la polaridad es NEGATIVA, los 3 símbolos van en orden inverso.

Sin servidor (tablero abierto como archivo o con `?telemetry=off`) estas dos reglas se desactivan.

### Consola del experto (ya viene armada)

En Open MCT abre **U.S.S. Aether → Consola del experto**. Muestra el estado de la misión, los datos 📡, el gráfico
del reactor, el registro de eventos y el estado de los módulos. **U.S.S. Aether → Manual de reparación** muestra el manual.

La consola es de solo lectura. Para personalizarla: clic derecho → **Duplicate** → guárdala en *My Items* y edita la copia.

## Comunicación: radio de voz y chat

Los dos lados tienen **radio de voz** (mantener presionado para hablar, como un walkie-talkie) y **chat de texto**.

| | Astronauta (tablero) | Control en tierra (Open MCT) |
|---|---|---|
| Radio | Botón **📻 ACTIVAR RADIO** arriba a la derecha. Luego mantén **🎙** o la tecla **T** para hablar | En la **Consola del experto** (columna derecha) o en **U.S.S. Aether → Radio y chat con el astronauta**: **Activar radio de voz**, luego mantén el botón o **T** |
| Chat | Botón **💬 CHAT CON TIERRA**, abajo a la izquierda | Mismo panel que la radio, debajo |

- Al activar la radio, el navegador pide permiso para el micrófono. Si no se da, igual se puede **escuchar**.
- Mientras alguien habla, el otro lado ve **🔊 … HABLANDO** y escucha un "chasquido" de radio al empezar y terminar.
- El audio va directo entre los navegadores (WebRTC); el servidor solo los presenta. Funciona en la red local.
- Si hay varias personas en tierra, todas se escuchan entre sí y con el astronauta. Cada una puede poner su nombre.
- El chat guarda los últimos 100 mensajes en memoria (quien entra tarde los ve). Se borran al reiniciar el servidor.
- Sin servidor (tablero abierto como archivo) no hay radio ni chat.

## Modo 2D / 3D

Botón **2D | 3D** arriba a la derecha del tablero. La elección se recuerda en ese navegador.

- **2D:** el tablero de siempre, con los 4 módulos a la vista.
- **3D:** controlas a un **astronauta que camina por dentro de la nave**. Cada módulo está en **su propia sala**:

```
                 [ SALA DE ENERGÍA ]      → 01 CABLES
                          |
 [ COMUNICACIONES ] — [ PUENTE ] — [ NÚCLEO DEL REACTOR ]
      → 04 FASE        (inicio)          → 02 NÚCLEO
                          |
                 [ ESCUDO TÉRMICO ]       → 03 ESCUDO
```

  Cada consola tiene el módulo como un **panel 3D real**: acércate, **apunta y haz clic** directo sobre los cables,
  el botón, las luces o los símbolos. El panel muestra lo mismo que el tablero 2D (también el reloj, el serial y las
  pilas), y las reglas son idénticas. Si prefieres verlo plano, presiona **E** (vista de cerca): se abre el mismo
  tablero mostrando solo ese módulo. El tiempo sigue corriendo mientras caminas.

| Control | Teclado / mouse | Pantalla táctil |
|---|---|---|
| Moverse | **WASD** o flechas (**Shift** para correr) | Arrastrar en la mitad izquierda |
| Saltar con baja gravedad | **Espacio** (soltar y volver a pulsar para otro salto) | — |
| Mirar | Mouse (clic en la nave para capturarlo, **Esc** lo suelta) | Arrastrar en la mitad derecha |
| Usar el panel 3D | Apuntar (mira del centro) y **clic**; el botón del núcleo se **mantiene** presionado | Tocar la parte del panel |
| Vista de cerca (tablero plano) | **E** (o clic en el aviso) | Tocar el aviso |
| Cámara | **V** recorre 3ª persona, cinemática, gran angular y 1ª persona | Botón 🎥 CÁMARA |
| Panel de muñeca (1ª persona) | **Q** sube/baja el panel; **1–6** o clic para radio, chat, voz, sonido, música y cerrar | Botón **📟 PANEL**; tocar las opciones |
| Sonido del 3D | **M** (o botón 🔊 SONIDO) | Botón 🔊 SONIDO |
| Hablar por radio | Mantener **T** | Mantener 🎙 |

Arriba se ven el tiempo, los strikes, el serial y las baterías; abajo a la derecha, un minimapa (rojo = módulo en
falla, verde = reparado). La nave se dibuja con [Three.js](https://threejs.org/), que viene incluido en `npm install`:
el modo 3D necesita el servidor.

### Lo que hace realista el modo 3D

- **Astronauta con traje estilo EMU** (el de las caminatas espaciales de la NASA): torso rígido, panel de control en
  el pecho, mochila de soporte vital con la unidad de rescate SAFER, mangueras, casco con visera dorada y luces/cámaras,
  anillos metálicos en las articulaciones, franjas rojas de comandante, guantes y botas. Camina doblando rodillas y codos.
- **Movimiento con baja gravedad:** caminata más lenta (2 m/s; 3,4 m/s con Shift) y saltos con gravedad artificial
  de tipo lunar (1,62 m/s²), ascenso y caída suaves. El casco respeta techos y dinteles y no suenan pasos en el aire.
- **Primera persona desde el casco:** se ve el borde interior del casco, la visera con tinte dorado y reflejos, el vaho
  de la respiración y una pantalla en el visor (O₂, presión, pulso que sube con el peligro). La linterna del casco
  ilumina hacia donde miras.
- **Interior:** paredes y piso con texturas fotográficas (planchas de acero con rayones y piso diamantado, de
  [Poly Haven](https://polyhaven.com), licencia CC0, en `public/textures/`) con relieve y reflejos; puertas corredizas
  automáticas, pasamanos, tuberías, rejillas, bolsas de carga, extintores, tanques de O₂, pantallas animadas, racks de
  comunicaciones, bancos de energía, la bobina del escudo y letreros técnicos.
- **Sonido 3D generado por código:** zumbido y ventilación de la nave, alarma en cada sala con falla (se apaga al
  repararla), reactor, pasos metálicos, puertas neumáticas, respiración dentro del casco (más rápida con peligro),
  cortes de cable, botones y teclas. Se oye según dónde estás y hacia dónde miras.
- Al cometer un error: destello rojo, sacudida y un zumbido corto (la voz de la nave anuncia el strike).

## Voz de la nave

Una voz de mujer (español de España) avisa el tiempo ("Faltan dos minutos", "Falta un minuto", "Treinta segundos"…
y la cuenta regresiva de 10 a 1), felicita al reparar un módulo y dice cuántos quedan, y en cada error dice cuántos
strikes te quedan. Botón **🔊 VOZ** arriba a la derecha para silenciarla; lo que dice aparece también como subtítulo.

- **2D:** suena por el intercomunicador de la cabina.
- **3D:** suena desde un lugar de la nave: los aciertos y errores desde la consola del módulo, y los avisos de tiempo
  desde el altavoz del techo de la sala donde estás. Se oye según dónde estés y hacia dónde mires (HRTF), con reflejos
  en las paredes de esa sala y una reverberación calculada por código con las medidas de cada espacio (fórmula de
  Sabine). Si estás en otra sala, se oye apagada, como a través de las paredes.

Los audios están pregrabados en `public/voice/` (no se necesita internet ni claves para jugar). Para cambiar frases o
la voz: editar `tools/generate_voice.py` y correrlo (instrucciones dentro del archivo). Funciona con las voces
neuronales de Azure (gratis, sin clave) o con ElevenLabs (clave en la variable `ELEVENLABS_API_KEY`, nunca en el código).

## Archivos

- `public/tablero.html`: juego (corregido + módulos `Telemetry`, `Chat`, `RadioUI` y `ViewMode`)
- `public/ship3d.js`: modo 3D (plano de la nave, cámaras, movimiento, minimapa) y une los módulos de `public/ship3d/`:
  `textures.js` (texturas), `astronaut.js` (traje EMU), `props.js` (puertas y equipos), `panels.js` (módulos 3D
  clicables), `sfx.js` (efectos de sonido) y `helmet.js` (casco en 1ª persona, mira)
- `public/textures/`: texturas fotográficas CC0 de Poly Haven (ver `LICENSE.txt`)
- `public/radio.js`: radio de voz "mantener para hablar" (la usan el tablero y `chat.html`)
- `public/manual.html`: manual del experto (solo control en tierra)
- `public/chat.html`: radio y chat de control en tierra (se muestra dentro de Open MCT)
- `public/index.html`: app Open MCT
- `public/voice.js`: voz de la nave (cola de avisos, subtítulos y acústica 2D/3D) · `public/voice/`: audios y textos
- `tools/generate_voice.py`: genera los audios de `public/voice/`
- `public/dictionary.json`: definición de las mediciones (agregar una nueva = agregarla aquí y enviarla desde `Telemetry.sample()`)
- `public/plugins/*.js`: plugins de diccionario (incluye la consola ya armada), histórico, tiempo real y límites
- `tablero_de_reparacion_espacial.html`: copia del tablero **original**, de antes de estos cambios (respaldo)
- `server.js`: Express + WebSocket (telemetría, tiempo real, chat y radio), HTTP + HTTPS, historial en memoria
- `.cert/`: certificado HTTPS que genera el servidor la primera vez (se puede borrar: se crea otro)

## Correcciones al HTML original

1. **CSS:** faltaba el `}` de `@keyframes pulseGlow`, así que se perdían `.metal-panel`, `.hazard-border`, `.module-box`, `.screw` y el scrollbar.
2. **JS (crítico):** `animateRearview()` leía `GameState` antes de su declaración `const` → `ReferenceError`; el script se detenía y el juego nunca arrancaba.
3. Las clases `.alarm-flash` y `.crt-overlay` se usaban pero no estaban definidas.
4. El destello del Simón no se veía (Tailwind aplicaba `bg-*-950` por encima de `bg-*-400`); ahora usa estilo inline.
5. El botón del núcleo quedaba "pegado" si soltabas el mouse fuera de él; ahora salir del botón cuenta como soltarlo.
6. Reiniciar con el botón presionado dejaba el temporizador de retención activo.
7. La mezcla del teclado de símbolos estaba sesgada (`sort(random)`); ahora es Fisher-Yates.
8. Se reanuda el `AudioContext` si Chrome lo deja suspendido.
