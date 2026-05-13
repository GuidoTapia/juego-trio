# Trio — versión web

Implementación web del juego de cartas Trio (Happy Camper Games) para jugar online de 3 a 6 personas en una sala, en tiempo real, sin recargar la página. Incluye modo en solitario contra bots.

Solo se ha implementado el **modo simple**: gana quien primero junte 3 trios o el trio del 7.

## Estructura

```
.
├── server/
│   ├── index.js       Express + Socket.IO, orquesta partidas y bots
│   ├── game.js        Lógica pura del juego (deck, turnos, trios)
│   ├── bot.js         IA con memoria pública de extremos revelados
│   └── test-sim.js    Simulaciones bot-vs-bot para verificar la lógica
├── public/
│   ├── index.html     Vista única (lobby + sala + mesa)
│   ├── style.css      Estilos
│   ├── client.js      Cliente Socket.IO + rendering
│   └── cartas/        carta-trio-1.png … carta-trio-12.png
├── cartas/            Originales (alta resolución, no se sirven al web)
└── package.json
```

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

- **Spicy mode** (trios conectados por los números de las esquinas).
- **Team variant** (4 ó 6 jugadores en equipos con swap inicial).
- Reconexión automática tras perder la red (si te desconectas y vuelves, ahora mismo entras como nuevo jugador).
- Persistencia de salas (todas viven en memoria).
- Sonido / animaciones más elaboradas.
