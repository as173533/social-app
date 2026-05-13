from pathlib import Path
from uuid import uuid4

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.db.session import get_session
from app.models.user import User
from app.schemas.chat import AttachmentOut, ConversationOut, GroupCreate, MarkReadRequest, MessageCreate, MessageDeleteRequest, MessageOut, MessageReactionOut, MessageReactionRequest, MessageReplyOut
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


async def message_out(message, service: ChatService, current_user_id: int) -> MessageOut:
    deleted = message.deleted_for_everyone_at is not None
    reply_to = None
    if message.reply_to_message_id:
        reply_message = await service.chat.get_message_for_user(message.reply_to_message_id, current_user_id)
        if reply_message:
            reply_deleted = reply_message.deleted_for_everyone_at is not None
            reply_to = MessageReplyOut(
                id=reply_message.id,
                sender_id=reply_message.sender_id,
                body="" if reply_deleted else reply_message.body,
                message_type=reply_message.message_type,
                attachment_name=None if reply_deleted else reply_message.attachment_name,
            )
    reads = await service.chat.read_user_ids_for_messages([message.id])
    reactions = await service.chat.reactions_for_messages([message.id])
    return MessageOut.model_validate(message).model_copy(
        update={
            "body": "" if deleted else message.body,
            "attachment_url": None if deleted else message.attachment_url,
            "attachment_name": None if deleted else message.attachment_name,
            "attachment_mime": None if deleted else message.attachment_mime,
            "attachment_size": None if deleted else message.attachment_size,
            "deleted_for_everyone": deleted,
            "reply_to": reply_to,
            "read_by": reads.get(message.id, []),
            "reactions": [MessageReactionOut.model_validate(reaction) for reaction in reactions.get(message.id, [])],
        }
    )


async def conversation_out(conversation, service: ChatService, user_service: UserService, current_user_id: int) -> ConversationOut:
    output = ConversationOut.model_validate(conversation)
    if conversation.conversation_type == "group":
        members = []
        for member in await service.chat.list_members(conversation.id):
            member_user = await user_service.get(member.user_id)
            members.append(UserPublic.model_validate(member_user).model_copy(update={"online": await user_service.is_online(member.user_id)}))
        return output.model_copy(update={"members": members, "role": await service.member_role(conversation.id, current_user_id)})
    peer_id = conversation.user2_id if conversation.user1_id == current_user_id else conversation.user1_id
    peer = await user_service.get(peer_id)
    public = UserPublic.model_validate(peer).model_copy(update={"online": await user_service.is_online(peer_id)})
    return output.model_copy(update={"peer": public})


@router.post("/groups", response_model=ConversationOut, status_code=status.HTTP_201_CREATED)
async def create_group(
    payload: GroupCreate,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    service = ChatService(session)
    user_service = UserService(session)
    conversation = await service.create_group(current_user.id, payload)
    return await conversation_out(conversation, service, user_service, current_user.id)


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
    service = ChatService(session)
    conversations = await service.list_conversations(current_user.id)
    return [await conversation_out(conversation, service, user_service, current_user.id) for conversation in conversations]


@router.get("/conversations/{conversation_id}/messages", response_model=list[MessageOut])
async def list_messages(
    conversation_id: int,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    service = ChatService(session)
    messages = await service.list_messages(current_user.id, conversation_id)
    return [await message_out(message, service, current_user.id) for message in messages]


@router.post("/conversations/{conversation_id}/messages", response_model=MessageOut, status_code=status.HTTP_201_CREATED)
async def create_message(
    conversation_id: int,
    payload: MessageCreate,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    service = ChatService(session)
    message = await service.create_message(current_user.id, conversation_id, payload)
    return await message_out(message, service, current_user.id)


@router.delete("/messages/{message_id}", response_model=MessageOut)
async def delete_message(
    message_id: int,
    payload: MessageDeleteRequest,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    service = ChatService(session)
    message = await service.delete_message(current_user.id, message_id, payload.scope)
    return await message_out(message, service, current_user.id)


@router.post("/messages/{message_id}/reactions", response_model=MessageOut)
async def react_to_message(
    message_id: int,
    payload: MessageReactionRequest,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    service = ChatService(session)
    message = await service.react_to_message(current_user.id, message_id, payload.emoji)
    return await message_out(message, service, current_user.id)


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
