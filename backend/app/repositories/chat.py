from sqlalchemy import and_, or_, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.conversation import Conversation
from app.models.message import Message, MessageRead


class ChatRepository:
    def __init__(self, session: AsyncSession):
        self.session = session

    @staticmethod
    def ordered_pair(user_id: int, peer_id: int) -> tuple[int, int]:
        return (user_id, peer_id) if user_id < peer_id else (peer_id, user_id)

    async def get_or_create_conversation(self, user_id: int, peer_id: int) -> Conversation:
        user1_id, user2_id = self.ordered_pair(user_id, peer_id)
        result = await self.session.execute(
            select(Conversation).where(Conversation.user1_id == user1_id, Conversation.user2_id == user2_id)
        )
        conversation = result.scalar_one_or_none()
        if conversation:
            return conversation
        conversation = Conversation(user1_id=user1_id, user2_id=user2_id)
        self.session.add(conversation)
        await self.session.flush()
        return conversation

    async def get_conversation_for_user(self, conversation_id: int, user_id: int) -> Conversation | None:
        result = await self.session.execute(
            select(Conversation).where(
                Conversation.id == conversation_id,
                or_(Conversation.user1_id == user_id, Conversation.user2_id == user_id),
            )
        )
        return result.scalar_one_or_none()

    async def list_conversations(self, user_id: int) -> list[Conversation]:
        result = await self.session.execute(
            select(Conversation)
            .where(or_(Conversation.user1_id == user_id, Conversation.user2_id == user_id))
            .order_by(Conversation.created_at.desc())
        )
        return list(result.scalars().all())

    async def create_message(
        self,
        conversation_id: int,
        sender_id: int,
        body: str,
        message_type: str = "text",
        attachment_url: str | None = None,
        attachment_name: str | None = None,
        attachment_mime: str | None = None,
        attachment_size: int | None = None,
    ) -> Message:
        message = Message(
            conversation_id=conversation_id,
            sender_id=sender_id,
            body=body,
            message_type=message_type,
            attachment_url=attachment_url,
            attachment_name=attachment_name,
            attachment_mime=attachment_mime,
            attachment_size=attachment_size,
        )
        self.session.add(message)
        await self.session.flush()
        return message

    async def list_messages(self, conversation_id: int, limit: int = 50, before_id: int | None = None) -> list[Message]:
        query = select(Message).where(Message.conversation_id == conversation_id)
        if before_id:
            query = query.where(Message.id < before_id)
        result = await self.session.execute(query.order_by(Message.id.desc()).limit(limit))
        return list(reversed(result.scalars().all()))

    async def mark_read(self, message_ids: list[int], user_id: int) -> None:
        for message_id in message_ids:
            stmt = insert(MessageRead).values(message_id=message_id, user_id=user_id).on_conflict_do_nothing(
                index_elements=["message_id", "user_id"]
            )
            await self.session.execute(stmt)

    async def read_user_ids_for_messages(self, message_ids: list[int]) -> dict[int, list[int]]:
        if not message_ids:
            return {}
        result = await self.session.execute(select(MessageRead).where(MessageRead.message_id.in_(message_ids)))
        reads: dict[int, list[int]] = {}
        for read in result.scalars().all():
            reads.setdefault(read.message_id, []).append(read.user_id)
        return reads
