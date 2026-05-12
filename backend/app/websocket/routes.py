from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.db.session import AsyncSessionLocal
from app.repositories.friends import FriendRepository
from app.services.calls import CallService
from app.services.chat import ChatService
from app.schemas.chat import MessageCreate
from app.utils.serialization import jsonable_model
from app.websocket.auth import authenticate_websocket
from app.websocket.manager import call_manager, chat_manager

websocket_router = APIRouter()


async def friend_ids_for(user_id: int) -> list[int]:
    async with AsyncSessionLocal() as session:
        pairs = await FriendRepository(session).list_friends(user_id)
        return [friend.id for _, friend in pairs]


@websocket_router.websocket("/ws/chat")
async def chat_socket(websocket: WebSocket):
    user_id = await authenticate_websocket(websocket)
    if user_id is None:
        return
    await chat_manager.connect(user_id, websocket)
    await chat_manager.broadcast_presence(user_id, True, await friend_ids_for(user_id))
    try:
        while True:
            payload = await websocket.receive_json()
            await chat_manager.heartbeat(user_id)
            event_type = payload.get("type")
            if event_type == "message":
                conversation_id = int(payload["conversation_id"])
                body = str(payload.get("body", "")).strip()
                message_payload = MessageCreate(
                    body=body,
                    message_type=str(payload.get("message_type", "text")),
                    attachment_url=payload.get("attachment_url"),
                    attachment_name=payload.get("attachment_name"),
                    attachment_mime=payload.get("attachment_mime"),
                    attachment_size=payload.get("attachment_size"),
                )
                async with AsyncSessionLocal() as session:
                    message = await ChatService(session).create_message(user_id, conversation_id, message_payload)
                    conversation = await ChatService(session).chat.get_conversation_for_user(conversation_id, user_id)
                peer_id = conversation.user2_id if conversation.user1_id == user_id else conversation.user1_id
                event = {"type": "message", "message": {**jsonable_model(message), "read_by": []}}
                await chat_manager.send_to_user(user_id, event)
                await chat_manager.send_to_user(peer_id, event)
            elif event_type == "typing":
                conversation_id = int(payload["conversation_id"])
                is_typing = bool(payload.get("is_typing", True))
                async with AsyncSessionLocal() as session:
                    conversation = await ChatService(session).chat.get_conversation_for_user(conversation_id, user_id)
                if conversation:
                    peer_id = conversation.user2_id if conversation.user1_id == user_id else conversation.user1_id
                    await chat_manager.send_to_user(
                        peer_id,
                        {"type": "typing", "conversation_id": conversation_id, "user_id": user_id, "is_typing": is_typing},
                    )
            elif event_type == "read":
                conversation_id = int(payload["conversation_id"])
                message_ids = [int(message_id) for message_id in payload.get("message_ids", [])]
                async with AsyncSessionLocal() as session:
                    await ChatService(session).mark_read(user_id, conversation_id, message_ids)
                    conversation = await ChatService(session).chat.get_conversation_for_user(conversation_id, user_id)
                if conversation:
                    peer_id = conversation.user2_id if conversation.user1_id == user_id else conversation.user1_id
                    event = {"type": "read", "conversation_id": conversation_id, "user_id": user_id, "message_ids": message_ids}
                    await chat_manager.send_to_user(user_id, event)
                    await chat_manager.send_to_user(peer_id, event)
    except WebSocketDisconnect:
        await chat_manager.disconnect(user_id, websocket)
        await chat_manager.broadcast_presence(user_id, False, await friend_ids_for(user_id))


@websocket_router.websocket("/ws/call")
async def call_socket(websocket: WebSocket):
    user_id = await authenticate_websocket(websocket)
    if user_id is None:
        return
    await call_manager.connect(user_id, websocket)
    async with AsyncSessionLocal() as session:
        active_calls, expired_calls = await CallService(session).sync_active_calls_for_user(user_id)
    for call in expired_calls:
        event = {"type": "call:state", "call": jsonable_model(call)}
        await call_manager.send_to_user(call.caller_id, event)
        await call_manager.send_to_user(call.callee_id, event)
    for call in active_calls:
        event_type = "call:ringing" if call.state == "ringing" else "call:state"
        await call_manager.send_to_user(user_id, {"type": event_type, "call": jsonable_model(call)})
    try:
        while True:
            payload = await websocket.receive_json()
            await call_manager.heartbeat(user_id)
            event_type = payload.get("type")
            if event_type == "call:start":
                callee_id = int(payload["callee_id"])
                call_type = str(payload.get("call_type", "audio"))
                async with AsyncSessionLocal() as session:
                    call = await CallService(session).start_call(user_id, callee_id, call_type)
                event = {"type": "call:ringing", "call": jsonable_model(call)}
                await call_manager.send_to_user(callee_id, event)
                await call_manager.send_to_user(user_id, event)
            elif event_type == "call:state":
                call_id = int(payload["call_id"])
                state = str(payload["state"])
                async with AsyncSessionLocal() as session:
                    call = await CallService(session).update_state(user_id, call_id, state)
                peer_id = call.callee_id if call.caller_id == user_id else call.caller_id
                event = {"type": "call:state", "call": jsonable_model(call)}
                await call_manager.send_to_user(peer_id, event)
                await call_manager.send_to_user(user_id, event)
            elif event_type in {"webrtc:offer", "webrtc:answer", "webrtc:ice"}:
                peer_id = int(payload["peer_id"])
                async with AsyncSessionLocal() as session:
                    allowed = await FriendRepository(session).are_friends(user_id, peer_id)
                if allowed:
                    await call_manager.send_to_user(peer_id, {**payload, "from_user_id": user_id})
    except WebSocketDisconnect:
        await call_manager.disconnect(user_id, websocket)
        if not call_manager.has_connections(user_id):
            async with AsyncSessionLocal() as session:
                ended_calls = await CallService(session).end_disconnected_calls_for_user(user_id)
            for call in ended_calls:
                event = {"type": "call:state", "call": jsonable_model(call)}
                await call_manager.send_to_user(call.caller_id, event)
                await call_manager.send_to_user(call.callee_id, event)
