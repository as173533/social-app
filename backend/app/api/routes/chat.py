from pathlib import Path
from uuid import uuid4

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.db.session import get_session
from app.models.user import User
from app.schemas.chat import AttachmentOut, ConversationOut, MarkReadRequest, MessageCreate, MessageOut
from app.schemas.user import UserPublic
from app.services.chat import ChatService
from app.services.users import UserService

router = APIRouter()

CHAT_UPLOAD_DIR = Path("static/chat")
CHAT_UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
MAX_ATTACHMENT_SIZE = 25 * 1024 * 1024


def message_type_for_mime(content_type: str) -> str:
    if content_type.startswith("image/"):
        return "image"
    if content_type.startswith("audio/"):
        return "audio"
    if content_type.startswith("video/"):
        return "video"
    return "file"


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
    message = await ChatService(session).create_message(current_user.id, conversation_id, payload)
    return MessageOut.model_validate(message)


@router.post("/conversations/{conversation_id}/attachments", response_model=AttachmentOut, status_code=status.HTTP_201_CREATED)
async def upload_attachment(
    conversation_id: int,
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    await ChatService(session).list_messages(current_user.id, conversation_id)
    content = await file.read()
    if not content:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Attachment cannot be empty")
    if len(content) > MAX_ATTACHMENT_SIZE:
        raise HTTPException(status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, detail="Attachment must be 25MB or smaller")
    content_type = file.content_type or "application/octet-stream"
    original_name = Path(file.filename or "attachment").name
    suffix = Path(original_name).suffix.lower()
    filename = f"{conversation_id}-{current_user.id}-{uuid4().hex}{suffix}"
    path = CHAT_UPLOAD_DIR / filename
    path.write_bytes(content)
    return AttachmentOut(
        url=f"/static/chat/{filename}",
        name=original_name,
        mime=content_type,
        size=len(content),
        message_type=message_type_for_mime(content_type),
    )


@router.post("/conversations/{conversation_id}/read", status_code=status.HTTP_204_NO_CONTENT)
async def mark_read(
    conversation_id: int,
    payload: MarkReadRequest,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    await ChatService(session).mark_read(current_user.id, conversation_id, payload.message_ids)
