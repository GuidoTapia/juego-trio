# Trio — versión web

Implementación web del juego de cartas Trio (Happy Camper Games) para jugar online de 3 a 6 personas en una sala, en tiempo real, sin recargar la página. Incluye modo en solitario contra bots.

Solo se ha implementado el **modo simple**: gana quien primero junte 3 trios o el trio del 7.

## Estructura

El servidor está en capas: el dominio (reglas puras) no conoce sockets ni
timers; la orquestación vive aparte; los handlers de socket son solo la API.

```
.
├── server/
│   ├── index.js            Bootstrap: Express + estáticos + Socket.IO
│   ├── socket-handlers.js  Capa API: traduce eventos de socket a llamadas
│   ├── orchestrator.js     Timers, turnos de bots, takeover, broadcast
│   ├── rooms.js            Registro de salas en memoria + códigos
│   ├── game.js             Máquina de estado pura del juego (sin I/O)
│   ├── modes.js            Reglas por modo (reparto + condición de victoria)
│   ├── bot.js              IA con memoria pública de extremos revelados
│   └── test-*.js           Tests: sim, e2e, rejoin, takeover
├── public/
│   ├── index.html          Vista única (home + sala + mesa)
│   ├── style.css           Estilos
│   ├── client.js           Cliente Socket.IO + rendering
│   ├── i18n.js             Traducciones (en / es) y helper t()
│   ├── trio-logo.webp      Logo
│   └── cartas/             carta-trio-1.webp … carta-trio-12.webp
├── scripts/
│   └── process-cards.mjs   Pipeline de imágenes (PNG → WebP estandarizado)
├── cartas/                 Originales en alta resolución (no se sirven)
└── package.json
```

### Modos de juego

`server/modes.js` define cada modo con su `checkWin(trios)`. Añadir un modo es
añadir una entrada a `MODES`; el resto del motor es agnóstico al modo.

- **simple** — gana con 3 trios o el trio del 7.
- **spicy** — gana con 2 trios *conectados* o el trio del 7. Dos números están
  conectados si suman 7 o se diferencian en 7 (1↔6, 1↔8, 4↔3, 4↔11, …).

## Cómo ejecutar localmente

```bash
npm install
npm start
# o, con auto-reload:
npm run dev
```

Abre `http://localhost:3000`. Crea una sala, comparte el código de 4 letras con tus amigos para que se unan, o añade bots desde el lobby de la sala.

Para verificar la lógica sin levantar el servidor:

```bash
node server/test-sim.js
```

## Cómo se juega

1. Escribe tu nombre y crea o únete a una sala con un código.
2. En el lobby, el anfitrión puede **añadir bots** (cada uno se sienta como un jugador más) hasta tener entre 3 y 6 jugadores.
3. Al empezar, cada jugador recibe sus cartas (ya ordenadas de menor a mayor) y se reparten cartas boca abajo al centro.
4. En tu turno, eliges una de estas dos acciones, revelando carta por carta:
   - Pedir la carta **más baja** o **más alta** a cualquier jugador (incluido tú).
   - Destapar una carta del **centro**.
5. La primera carta revelada fija el número objetivo. Sigues revelando hasta:
   - **Coincidir tres veces** → te llevas el trio.
   - **No coincidir** → todas las cartas vuelven a su sitio y termina tu turno.
6. Gana quien primero junte **3 trios cualesquiera** o **el trio del 7** (que vale como victoria inmediata).

Las cartas marcadas de tus extremos (más baja/más alta) se resaltan en amarillo cuando es tu turno para facilitar la jugada.

## Bots

El bot tiene memoria pública de qué números se vieron como "más baja" o "más alta" de cada jugador en turnos previos (igual que un humano que mira la mesa). Usa esa información para asegurar coincidencias cuando puede. Sin memoria, cualquier carta extrema vista por última vez sigue siendo válida hasta que ese jugador participe en un trio ganador.

Los bots son razonables, no implacables: en partidas bot-vs-bot ganan en ~70% de los casos antes del límite interno; con humanos en la mesa el ritmo es mucho más rápido.

## Despliegue gratuito

El servidor es un único proceso Node ≥18 que sirve estáticos y WebSockets desde el mismo puerto. Para servicios gratuitos:

### Render (recomendado, ~3 min)
1. Sube el repo a GitHub.
2. En Render: **New +** → Web Service → conecta el repo.
3. Build command: `npm install`. Start command: `npm start`. Plan: Free.
4. Render asigna `PORT` automáticamente (el servidor lo lee con `process.env.PORT`).
5. El free tier duerme tras 15 min de inactividad — la primera petición tras dormir tarda ~30 s.

### Fly.io
1. Instala el CLI y `fly launch` en la carpeta del proyecto.
2. Acepta el `Dockerfile` autogenerado (o crea uno simple `FROM node:20-alpine`).
3. `fly deploy`. El plan gratuito incluye 3 VMs pequeñas, suficiente para varias salas simultáneas.

### Railway / Glitch / Replit
Funcionan igual: build = `npm install`, start = `npm start`.

> **Importante**: el estado de las salas vive en memoria del proceso. Si el servicio reinicia (deploy nuevo, o el free tier de Render duerme y se despierta) las salas activas se pierden. Para una versión "seria" haría falta persistir partidas en Redis o similar — fuera del alcance de esta versión ligera.

## Lo que falta / no implementado

- **Spicy mode**: la lógica de victoria ya existe en `modes.js`, falta el
  selector de modo en la sala para poder elegirlo.
- **Team variant** (4 ó 6 jugadores en equipos con swap inicial).
- Persistencia de salas (todas viven en memoria del proceso).
- Sonido / animaciones más elaboradas.
