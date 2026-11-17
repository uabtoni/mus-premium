# Mus Premium · Juego de mus online (en desarrollo)

Juego de cartas de **mus** multijugador en tiempo real, con arquitectura cliente-servidor: frontend en React, backend en Node.js con WebSockets y persistencia en PostgreSQL.

> 🚧 Proyecto en desarrollo. Ya funcionan el login de usuario, la conexión en tiempo real y el menú principal. La lógica de la partida está en curso.

## Arquitectura

```
Navegador (React + Vite)  ◄── WebSocket (Socket.IO) ──►  Servidor Node.js (Express)  ──►  PostgreSQL
        frontend/                                              backend/                    tabla users
```

- **Frontend** (`frontend/`): React 19 + Vite. Pantallas de login, menú principal y mesa de juego.
- **Backend** (`backend/`): Express + Socket.IO. Gestiona las conexiones de los jugadores y el login, y crea automáticamente la tabla de usuarios (monedas y gemas) si no existe.
- **Base de datos:** PostgreSQL mediante un pool de conexiones (`pg`).

## Puesta en marcha en local

**Requisitos:** Node.js 20 o superior y PostgreSQL.

```bash
# 1. Base de datos
createdb mus_premium

# 2. Backend
cd backend
cp .env.example .env      # y pon tu contraseña de PostgreSQL
npm install
node server.js            # escucha en el puerto 3000

# 3. Frontend (en otra terminal)
cd frontend
npm install
npm run dev
```

## Buenas prácticas aplicadas

- Las credenciales de la base de datos se leen de **variables de entorno** (`.env`) y nunca se suben al repositorio. Hay una plantilla en `backend/.env.example`.
- Las dependencias (`node_modules`) no se versionan: se reinstalan con `npm install` a partir de `package-lock.json`.

## Tecnologías

React · Vite · Node.js · Express · Socket.IO · PostgreSQL

---

Proyecto personal de [Toni Susany](https://github.com/uabtoni).
