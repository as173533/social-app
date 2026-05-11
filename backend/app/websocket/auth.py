from fastapi import WebSocket

from app.core.security import decode_token
from app.db.session import AsyncSessionLocal
from app.repositories.users import UserRepository


async def authenticate_websocket(websocket: WebSocket) -> int | None:
    token = websocket.query_params.get("token")
    if not token:
        await websocket.close(code=4401)
        return None
    try:
        payload = decode_token(token, expected_type="access")
        user_id = int(payload["sub"])
    except (ValueError, KeyError):
        await websocket.close(code=4401)
        return None
    async with AsyncSessionLocal() as session:
        user = await UserRepository(session).get_by_id(user_id)
        if not user or not user.is_active:
            await websocket.close(code=4401)
            return None
    return user_id
