from datetime import datetime, timezone

from sqlalchemy import and_, or_, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.conversation import Conversation, ConversationMember
from app.models.message import Message, MessageDeletion, MessageRead


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
        membership = select(ConversationMember.conversation_id).where(
            ConversationMember.conversation_id == conversation_id,
            ConversationMember.user_id == user_id,
        )
        result = await self.session.execute(
            select(Conversation).where(
                Conversation.id == conversation_id,
                or_(Conversation.user1_id == user_id, Conversation.user2_id == user_id, Conversation.id.in_(membership)),
            )
        )
        return result.scalar_one_or_none()

    async def list_conversations(self, user_id: int) -> list[Conversation]:
        membership = select(ConversationMember.conversation_id).where(ConversationMember.user_id == user_id)
        result = await self.session.execute(
            select(Conversation)
            .where(or_(Conversation.user1_id == user_id, Conversation.user2_id == user_id, Conversation.id.in_(membership)))
            .order_by(Conversation.created_at.desc())
        )
        return list(result.scalars().all())

    async def create_group_conversation(self, owner_id: int, title: str, member_ids: list[int]) -> Conversation:
        conversation = Conversation(
            user1_id=owner_id,
            user2_id=None,
            conversation_type="group",
            title=title,
            owner_id=owner_id,
        )
        self.session.add(conversation)
        await self.session.flush()
        unique_member_ids = [owner_id, *[member_id for member_id in member_ids if member_id != owner_id]]
        for member_id in dict.fromkeys(unique_member_ids):
            self.session.add(
                ConversationMember(
                    conversation_id=conversation.id,
                    user_id=member_id,
                    role="owner" if member_id == owner_id else "member",
                )
            )
        await self.session.flush()
        return conversation

    async def list_members(self, conversation_id: int) -> list[ConversationMember]:
        result = await self.session.execute(
            select(ConversationMember).where(ConversationMember.conversation_id == conversation_id).order_by(ConversationMember.id)
        )
        return list(result.scalars().all())

    async def get_member(self, conversation_id: int, user_id: int) -> ConversationMember | None:
        result = await self.session.execute(
            select(ConversationMember).where(
                ConversationMember.conversation_id == conversation_id,
                ConversationMember.user_id == user_id,
            )
        )
        return result.scalar_one_or_none()

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
        reply_to_message_id: int | None = None,
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
            reply_to_message_id=reply_to_message_id,
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

    async def list_messages_for_user(self, conversation_id: int, user_id: int, limit: int = 50, before_id: int | None = None) -> list[Message]:
        hidden_message_ids = select(MessageDeletion.message_id).where(MessageDeletion.user_id == user_id)
        query = select(Message).where(Message.conversation_id == conversation_id, ~Message.id.in_(hidden_message_ids))
        if before_id:
            query = query.where(Message.id < before_id)
        result = await self.session.execute(query.order_by(Message.id.desc()).limit(limit))
        return list(reversed(result.scalars().all()))

    async def get_message_for_user(self, message_id: int, user_id: int) -> Message | None:
        result = await self.session.execute(
            select(Message)
            .join(Conversation, Conversation.id == Message.conversation_id)
            .where(
                Message.id == message_id,
                or_(
                    Conversation.user1_id == user_id,
                    Conversation.user2_id == user_id,
                    Conversation.id.in_(select(ConversationMember.conversation_id).where(ConversationMember.user_id == user_id)),
                ),
            )
        )
        return result.scalar_one_or_none()

    async def delete_message_for_user(self, message_id: int, user_id: int) -> None:
        stmt = insert(MessageDeletion).values(message_id=message_id, user_id=user_id).on_conflict_do_nothing(
            index_elements=["message_id", "user_id"]
        )
        await self.session.execute(stmt)

    async def delete_message_for_everyone(self, message: Message) -> Message:
        message.deleted_for_everyone_at = datetime.now(timezone.utc)
        message.body = ""
        message.attachment_url = None
        message.attachment_name = None
        message.attachment_mime = None
        message.attachment_size = None
        await self.session.flush()
        return message

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
