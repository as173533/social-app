from fastapi import HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.conversation import Conversation
from app.models.message import Message
from app.repositories.chat import ChatRepository
from app.repositories.friends import FriendRepository


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

    async def list_conversations(self, user_id: int) -> list[Conversation]:
        return await self.chat.list_conversations(user_id)

    async def list_messages(self, user_id: int, conversation_id: int) -> list[Message]:
        conversation = await self.chat.get_conversation_for_user(conversation_id, user_id)
        if not conversation:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Conversation not found")
        return await self.chat.list_messages(conversation_id)

    async def create_message(self, user_id: int, conversation_id: int, body: str) -> Message:
        conversation = await self.chat.get_conversation_for_user(conversation_id, user_id)
        if not conversation:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Conversation not found")
        peer_id = conversation.user2_id if conversation.user1_id == user_id else conversation.user1_id
        if not await self.friends.are_friends(user_id, peer_id):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only friends can chat")
        message = await self.chat.create_message(conversation_id, user_id, body)
        await self.session.commit()
        await self.session.refresh(message)
        return message

    async def mark_read(self, user_id: int, conversation_id: int, message_ids: list[int]) -> None:
        conversation = await self.chat.get_conversation_for_user(conversation_id, user_id)
        if not conversation:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Conversation not found")
        await self.chat.mark_read(message_ids, user_id)
        await self.session.commit()
