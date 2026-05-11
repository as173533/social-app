from fastapi import APIRouter, Depends, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.db.session import get_session
from app.models.user import User
from app.schemas.chat import ConversationOut, MarkReadRequest, MessageCreate, MessageOut
from app.schemas.user import UserPublic
from app.services.chat import ChatService
from app.services.users import UserService

router = APIRouter()


@router.post("/conversations/{peer_id}", response_model=ConversationOut, status_code=status.HTTP_201_CREATED)
async def create_conversation(
    peer_id: int,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    return await ChatService(session).get_or_create_conversation(current_user.id, peer_id)


@router.get("/conversations", response_model=list[ConversationOut])
async def list_conversations(current_user: User = Depends(get_current_user), session: AsyncSession = Depends(get_session)):
    user_service = UserService(session)
    conversations = await ChatService(session).list_conversations(current_user.id)
    result = []
    for conversation in conversations:
        peer_id = conversation.user2_id if conversation.user1_id == current_user.id else conversation.user1_id
        peer = await user_service.get(peer_id)
        public = UserPublic.model_validate(peer).model_copy(update={"online": await user_service.is_online(peer_id)})
        result.append(ConversationOut.model_validate(conversation).model_copy(update={"peer": public}))
    return result


@router.get("/conversations/{conversation_id}/messages", response_model=list[MessageOut])
async def list_messages(
    conversation_id: int,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    messages = await ChatService(session).list_messages(current_user.id, conversation_id)
    reads = await ChatService(session).chat.read_user_ids_for_messages([message.id for message in messages])
    return [MessageOut.model_validate(message).model_copy(update={"read_by": reads.get(message.id, [])}) for message in messages]


@router.post("/conversations/{conversation_id}/messages", response_model=MessageOut, status_code=status.HTTP_201_CREATED)
async def create_message(
    conversation_id: int,
    payload: MessageCreate,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    message = await ChatService(session).create_message(current_user.id, conversation_id, payload.body)
    return MessageOut.model_validate(message)


@router.post("/conversations/{conversation_id}/read", status_code=status.HTTP_204_NO_CONTENT)
async def mark_read(
    conversation_id: int,
    payload: MarkReadRequest,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    await ChatService(session).mark_read(current_user.id, conversation_id, payload.message_ids)
