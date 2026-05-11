import json
from collections import defaultdict
from typing import Any

from fastapi import WebSocket

from app.core.redis import redis_client


class ConnectionManager:
    def __init__(self) -> None:
        self.active: dict[int, set[WebSocket]] = defaultdict(set)

    async def connect(self, user_id: int, websocket: WebSocket) -> None:
        await websocket.accept()
        self.active[user_id].add(websocket)
        await redis_client.sadd(f"sockets:{user_id}", id(websocket))
        await redis_client.set(f"online:{user_id}", "1", ex=90)

    async def disconnect(self, user_id: int, websocket: WebSocket) -> None:
        self.active[user_id].discard(websocket)
        await redis_client.srem(f"sockets:{user_id}", id(websocket))
        if not self.active[user_id]:
            self.active.pop(user_id, None)
            await redis_client.delete(f"online:{user_id}")

    async def heartbeat(self, user_id: int) -> None:
        await redis_client.set(f"online:{user_id}", "1", ex=90)

    async def send_to_user(self, user_id: int, payload: dict[str, Any]) -> None:
        message = json.dumps(payload, default=str)
        stale: list[WebSocket] = []
        for websocket in self.active.get(user_id, set()):
            try:
                await websocket.send_text(message)
            except RuntimeError:
                stale.append(websocket)
        for websocket in stale:
            self.active[user_id].discard(websocket)

    async def broadcast_presence(self, user_id: int, online: bool, friend_ids: list[int]) -> None:
        for friend_id in friend_ids:
            await self.send_to_user(friend_id, {"type": "presence", "user_id": user_id, "online": online})


chat_manager = ConnectionManager()
call_manager = ConnectionManager()
