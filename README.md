# Chat System

Production-oriented one-to-one social communication app built with FastAPI, PostgreSQL, Redis, WebSockets, WebRTC signaling, React, Vite, TypeScript, Zustand, Axios, and Tailwind CSS.

## Folder Structure

```text
backend/
  app/
    core/          settings, security, Redis
    db/            SQLAlchemy session/base
    models/        database models
    schemas/       Pydantic v2 request/response contracts
    repositories/  database access only
    services/      business logic
    api/           thin HTTP routes and dependencies
    websocket/     chat/call socket managers and routes
    utils/         shared helpers
  alembic/         migrations
frontend/
  src/
    api/           Axios clients
    components/    reusable UI
    pages/         route screens
    router/        React Router setup
    stores/        Zustand stores
    types/         TypeScript contracts
    utils/         WebRTC helper
```

## Quick Start With Docker

```bash
docker compose up --build
```

Open:

- Frontend: http://localhost:5173
- Backend API docs: http://localhost:8000/docs

## Local Backend Setup

```bash
cd backend
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
copy .env.example .env
alembic upgrade head
uvicorn app.main:app --reload
```

## Local Frontend Setup

```bash
cd frontend
npm install
npm run dev
```

## Notes

- Passwords are hashed with bcrypt through passlib.
- Private APIs require JWT bearer access tokens.
- Refresh tokens are stored hashed and can be revoked.
- Only accepted friends can create conversations, chat, read messages, or call.
- Chat WebSocket: `ws://localhost:8000/ws/chat?token=<access_token>`
- Call WebSocket: `ws://localhost:8000/ws/call?token=<access_token>`
