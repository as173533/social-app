from fastapi import APIRouter, Depends, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.db.session import get_session
from app.models.user import User
from app.schemas.friend import FriendOut, FriendRequestCreate, FriendRequestOut
from app.schemas.user import UserPublic
from app.services.friends import FriendService
from app.services.users import UserService
from app.websocket.manager import chat_manager

router = APIRouter()


@router.post("/requests", response_model=FriendRequestOut, status_code=status.HTTP_201_CREATED)
async def send_request(
    payload: FriendRequestCreate,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    await UserService(session).get(payload.receiver_id)
    request = await FriendService(session).send_request(current_user.id, payload.receiver_id)
    await chat_manager.send_to_user(payload.receiver_id, {"type": "friend_request:updated", "request_id": request.id, "status": request.status})
    return request


@router.get("/requests", response_model=list[FriendRequestOut])
async def list_requests(current_user: User = Depends(get_current_user), session: AsyncSession = Depends(get_session)):
    user_service = UserService(session)
    requests = await FriendService(session).list_requests(current_user.id)
    result = []
    for request in requests:
        sender = await user_service.get(request.sender_id)
        receiver = await user_service.get(request.receiver_id)
        result.append(
            FriendRequestOut.model_validate(request).model_copy(
                update={
                    "sender": UserPublic.model_validate(sender).model_copy(update={"online": await user_service.is_online(sender.id)}),
                    "receiver": UserPublic.model_validate(receiver).model_copy(update={"online": await user_service.is_online(receiver.id)}),
                }
            )
        )
    return result


@router.post("/requests/{request_id}/accept", response_model=FriendRequestOut)
async def accept_request(
    request_id: int,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    request = await FriendService(session).respond(request_id, current_user.id, accepted=True)
    await chat_manager.send_to_user(request.sender_id, {"type": "friend_request:updated", "request_id": request.id, "status": request.status})
    return request


@router.post("/requests/{request_id}/reject", response_model=FriendRequestOut)
async def reject_request(
    request_id: int,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    request = await FriendService(session).respond(request_id, current_user.id, accepted=False)
    await chat_manager.send_to_user(request.sender_id, {"type": "friend_request:updated", "request_id": request.id, "status": request.status})
    return request


@router.get("", response_model=list[FriendOut])
async def list_friends(current_user: User = Depends(get_current_user), session: AsyncSession = Depends(get_session)):
    service = UserService(session)
    pairs = await FriendService(session).list_friends(current_user.id)
    result = []
    for friendship, friend in pairs:
        public = UserPublic.model_validate(friend).model_copy(update={"online": await service.is_online(friend.id)})
        result.append(FriendOut(friendship_id=friendship.id, user=public))
    return result


@router.delete("/{friend_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_friend(
    friend_id: int,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    await FriendService(session).remove_friend(current_user.id, friend_id)
