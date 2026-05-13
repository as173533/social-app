from fastapi import HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.conversation import Conversation
from app.models.message import Message
from app.repositories.chat import ChatRepository
from app.repositories.friends import FriendRepository
from app.schemas.chat import GroupCreate, MessageCreate, MessageEditRequest

VALID_MESSAGE_TYPES = {"text", "emoji", "sticker", "gif", "file", "image", "audio", "video", "call"}


class ChatService:
    def __init__(self, session: AsyncSession):
        self.session = session
        self.chat = ChatRepository(session)
        self.friends = FriendRepository(session)

    async def get_or_create_conversation(self, user_id: int, peer_id: int) -> Conversation:
        if not await self.friends.are_friends(user_id, peer_id):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only friends can chat")
        conversation = await self.chat.get_or_create_conversation(user_id, peer_id)
        await self.session.commit()
        await self.session.refresh(conversation)
        return conversation

    async def create_group(self, user_id: int, payload: GroupCreate) -> Conversation:
        member_ids = list(dict.fromkeys(payload.member_ids))
        if user_id in member_ids:
            member_ids.remove(user_id)
        for member_id in member_ids:
            if not await self.friends.are_friends(user_id, member_id):
                raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Groups can include friends only")
        conversation = await self.chat.create_group_conversation(user_id, payload.title.strip(), member_ids)
        await self.session.commit()
        await self.session.refresh(conversation)
        return conversation

    async def list_conversations(self, user_id: int) -> list[Conversation]:
        return await self.chat.list_conversations(user_id)

    async def member_ids(self, conversation_id: int) -> list[int]:
        return [member.user_id for member in await self.chat.list_members(conversation_id)]

    async def member_role(self, conversation_id: int, user_id: int) -> str | None:
        member = await self.chat.get_member(conversation_id, user_id)
        return member.role if member else None

    async def list_messages(self, user_id: int, conversation_id: int) -> list[Message]:
        conversation = await self.chat.get_conversation_for_user(conversation_id, user_id)
        if not conversation:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Conversation not found")
        return await self.chat.list_messages_for_user(conversation_id, user_id)

    async def list_messages_page(self, user_id: int, conversation_id: int, limit: int = 50, before_id: int | None = None) -> list[Message]:
        conversation = await self.chat.get_conversation_for_user(conversation_id, user_id)
        if not conversation:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Conversation not found")
        return await self.chat.list_messages_for_user(conversation_id, user_id, limit=limit, before_id=before_id)

    async def create_message(self, user_id: int, conversation_id: int, payload: MessageCreate | str) -> Message:
        conversation = await self.chat.get_conversation_for_user(conversation_id, user_id)
        if not conversation:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Conversation not found")
        if conversation.conversation_type == "direct":
            peer_id = conversation.user2_id if conversation.user1_id == user_id else conversation.user1_id
            if not peer_id or not await self.friends.are_friends(user_id, peer_id):
                raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only friends can chat")
        elif not await self.chat.get_member(conversation_id, user_id):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only friends can chat")
        if isinstance(payload, str):
            payload = MessageCreate(body=payload)
        if payload.message_type not in VALID_MESSAGE_TYPES:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid message type")
        body = payload.body.strip()
        if not body and not payload.attachment_url:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Message body or attachment is required")
        if payload.reply_to_message_id:
            reply_to = await self.chat.get_message_for_user(payload.reply_to_message_id, user_id)
            if not reply_to or reply_to.conversation_id != conversation_id:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid reply target")
        message = await self.chat.create_message(
            conversation_id=conversation_id,
            sender_id=user_id,
            body=body,
            message_type=payload.message_type,
            attachment_url=payload.attachment_url,
            attachment_name=payload.attachment_name,
            attachment_mime=payload.attachment_mime,
            attachment_size=payload.attachment_size,
            reply_to_message_id=payload.reply_to_message_id,
        )
        await self.session.commit()
        await self.session.refresh(message)
        return message

    async def delete_message(self, user_id: int, message_id: int, scope: str) -> Message:
        message = await self.chat.get_message_for_user(message_id, user_id)
        if not message:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Message not found")
        if scope == "me":
            await self.chat.delete_message_for_user(message_id, user_id)
        elif scope == "everyone":
            if message.sender_id != user_id:
                raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only the sender can delete for everyone")
            message = await self.chat.delete_message_for_everyone(message)
        else:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid delete scope")
        await self.session.commit()
        await self.session.refresh(message)
        return message

    async def edit_message(self, user_id: int, message_id: int, payload: MessageEditRequest) -> Message:
        message = await self.chat.get_message_for_user(message_id, user_id)
        if not message:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Message not found")
        if message.sender_id != user_id:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only the sender can edit this message")
        if message.deleted_for_everyone_at is not None:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Deleted messages cannot be edited")
        if message.attachment_url:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Attachment messages cannot be edited")
        if payload.message_type not in {"text", "emoji", "sticker", "gif"}:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid message type")
        body = payload.body.strip()
        if not body:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Message body is required")
        message = await self.chat.update_message_body(message, body, payload.message_type)
        await self.session.commit()
        await self.session.refresh(message)
        return message

    async def mark_read(self, user_id: int, conversation_id: int, message_ids: list[int]) -> None:
        conversation = await self.chat.get_conversation_for_user(conversation_id, user_id)
        if not conversation:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Conversation not found")
        await self.chat.mark_read(message_ids, user_id)
        await self.session.commit()

    async def react_to_message(self, user_id: int, message_id: int, emoji: str) -> Message:
        message = await self.chat.get_message_for_user(message_id, user_id)
        if not message:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Message not found")
        clean_emoji = emoji.strip()
        if not clean_emoji:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Reaction is required")
        await self.chat.set_reaction(message_id, user_id, clean_emoji[:16])
        await self.session.commit()
        await self.session.refresh(message)
        return message
