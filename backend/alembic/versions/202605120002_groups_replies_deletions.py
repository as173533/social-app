"""groups replies deletions

Revision ID: 202605120002
Revises: 202605120001
Create Date: 2026-05-12
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "202605120002"
down_revision: Union[str, None] = "202605120001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.drop_constraint("ck_conversations_ordered_pair", "conversations", type_="check")
    op.alter_column("conversations", "user2_id", existing_type=sa.Integer(), nullable=True)
    op.add_column("conversations", sa.Column("conversation_type", sa.String(length=20), nullable=False, server_default="direct"))
    op.add_column("conversations", sa.Column("title", sa.String(length=120), nullable=True))
    op.add_column("conversations", sa.Column("avatar", sa.String(length=500), nullable=True))
    op.add_column("conversations", sa.Column("owner_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True))
    op.create_index("ix_conversations_owner_id", "conversations", ["owner_id"])
    op.create_check_constraint(
        "ck_conversations_direct_pair_or_group",
        "conversations",
        "(conversation_type = 'direct' AND user1_id < user2_id) OR (conversation_type = 'group' AND user2_id IS NULL)",
    )

    op.create_table(
        "conversation_members",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("conversation_id", sa.Integer(), sa.ForeignKey("conversations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("role", sa.String(length=20), nullable=False, server_default="member"),
        sa.Column("joined_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("conversation_id", "user_id", name="uq_conversation_members_once"),
    )
    op.create_index("ix_conversation_members_conversation_id", "conversation_members", ["conversation_id"])
    op.create_index("ix_conversation_members_user_id", "conversation_members", ["user_id"])

    op.add_column("messages", sa.Column("reply_to_message_id", sa.Integer(), sa.ForeignKey("messages.id", ondelete="SET NULL"), nullable=True))
    op.add_column("messages", sa.Column("deleted_for_everyone_at", sa.DateTime(timezone=True), nullable=True))
    op.create_index("ix_messages_reply_to_message_id", "messages", ["reply_to_message_id"])

    op.create_table(
        "message_deletions",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("message_id", sa.Integer(), sa.ForeignKey("messages.id", ondelete="CASCADE"), nullable=False),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("message_id", "user_id", name="uq_message_deletions_once"),
    )
    op.create_index("ix_message_deletions_message_id", "message_deletions", ["message_id"])
    op.create_index("ix_message_deletions_user_id", "message_deletions", ["user_id"])


def downgrade() -> None:
    op.drop_index("ix_message_deletions_user_id", table_name="message_deletions")
    op.drop_index("ix_message_deletions_message_id", table_name="message_deletions")
    op.drop_table("message_deletions")
    op.drop_index("ix_messages_reply_to_message_id", table_name="messages")
    op.drop_column("messages", "deleted_for_everyone_at")
    op.drop_column("messages", "reply_to_message_id")
    op.drop_index("ix_conversation_members_user_id", table_name="conversation_members")
    op.drop_index("ix_conversation_members_conversation_id", table_name="conversation_members")
    op.drop_table("conversation_members")
    op.drop_constraint("ck_conversations_direct_pair_or_group", "conversations", type_="check")
    op.drop_index("ix_conversations_owner_id", table_name="conversations")
    op.drop_column("conversations", "owner_id")
    op.drop_column("conversations", "avatar")
    op.drop_column("conversations", "title")
    op.drop_column("conversations", "conversation_type")
    op.alter_column("conversations", "user2_id", existing_type=sa.Integer(), nullable=False)
    op.create_check_constraint("ck_conversations_ordered_pair", "conversations", "user1_id < user2_id")
