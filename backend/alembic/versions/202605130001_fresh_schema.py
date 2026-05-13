"""fresh schema

Revision ID: 202605130001
Revises:
Create Date: 2026-05-13
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "202605130001"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "users",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("email", sa.String(length=255), nullable=False),
        sa.Column("phone", sa.String(length=32), nullable=False),
        sa.Column("password_hash", sa.String(length=255), nullable=False),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("avatar", sa.String(length=500), nullable=True),
        sa.Column("bio", sa.String(length=500), nullable=True),
        sa.Column("e2ee_public_key", sa.Text(), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("email"),
        sa.UniqueConstraint("phone"),
    )
    op.create_index("ix_users_email", "users", ["email"], unique=True)
    op.create_index("ix_users_name", "users", ["name"])
    op.create_index("ix_users_phone", "users", ["phone"], unique=True)

    op.create_table(
        "refresh_tokens",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("token_hash", sa.String(length=255), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("token_hash"),
    )
    op.create_index("ix_refresh_tokens_user_id", "refresh_tokens", ["user_id"])

    op.create_table(
        "friend_requests",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("sender_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("receiver_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False, server_default="pending"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("responded_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint("sender_id <> receiver_id", name="ck_friend_requests_not_self"),
        sa.UniqueConstraint("sender_id", "receiver_id", name="uq_friend_requests_pair"),
    )
    op.create_index("ix_friend_requests_receiver_id", "friend_requests", ["receiver_id"])
    op.create_index("ix_friend_requests_sender_id", "friend_requests", ["sender_id"])

    op.create_table(
        "friendships",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("friend_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint("user_id <> friend_id", name="ck_friendships_not_self"),
        sa.UniqueConstraint("user_id", "friend_id", name="uq_friendships_pair"),
    )
    op.create_index("ix_friendships_friend_id", "friendships", ["friend_id"])
    op.create_index("ix_friendships_user_id", "friendships", ["user_id"])

    op.create_table(
        "conversations",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user1_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("user2_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=True),
        sa.Column("conversation_type", sa.String(length=20), nullable=False, server_default="direct"),
        sa.Column("title", sa.String(length=120), nullable=True),
        sa.Column("avatar", sa.String(length=500), nullable=True),
        sa.Column("owner_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint(
            "(conversation_type = 'direct' AND user1_id < user2_id) OR (conversation_type = 'group' AND user2_id IS NULL)",
            name="ck_conversations_direct_pair_or_group",
        ),
        sa.UniqueConstraint("user1_id", "user2_id", name="uq_conversations_pair"),
    )
    op.create_index("ix_conversations_owner_id", "conversations", ["owner_id"])
    op.create_index("ix_conversations_user1_id", "conversations", ["user1_id"])
    op.create_index("ix_conversations_user2_id", "conversations", ["user2_id"])

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

    op.create_table(
        "messages",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("conversation_id", sa.Integer(), sa.ForeignKey("conversations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("sender_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("message_type", sa.String(length=20), nullable=False, server_default="text"),
        sa.Column("attachment_url", sa.String(length=500), nullable=True),
        sa.Column("attachment_name", sa.String(length=255), nullable=True),
        sa.Column("attachment_mime", sa.String(length=120), nullable=True),
        sa.Column("attachment_size", sa.BigInteger(), nullable=True),
        sa.Column("reply_to_message_id", sa.Integer(), sa.ForeignKey("messages.id", ondelete="SET NULL"), nullable=True),
        sa.Column("deleted_for_everyone_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_messages_conversation_id", "messages", ["conversation_id"])
    op.create_index("ix_messages_created_at", "messages", ["created_at"])
    op.create_index("ix_messages_reply_to_message_id", "messages", ["reply_to_message_id"])
    op.create_index("ix_messages_sender_id", "messages", ["sender_id"])

    op.create_table(
        "message_reads",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("message_id", sa.Integer(), sa.ForeignKey("messages.id", ondelete="CASCADE"), nullable=False),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("read_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("message_id", "user_id", name="uq_message_reads_once"),
    )
    op.create_index("ix_message_reads_message_id", "message_reads", ["message_id"])
    op.create_index("ix_message_reads_user_id", "message_reads", ["user_id"])

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

    op.create_table(
        "call_logs",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("caller_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("callee_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("call_type", sa.String(length=10), nullable=False),
        sa.Column("state", sa.String(length=20), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("answered_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("ended_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_call_logs_callee_id", "call_logs", ["callee_id"])
    op.create_index("ix_call_logs_caller_id", "call_logs", ["caller_id"])


def downgrade() -> None:
    op.drop_index("ix_call_logs_caller_id", table_name="call_logs")
    op.drop_index("ix_call_logs_callee_id", table_name="call_logs")
    op.drop_table("call_logs")
    op.drop_index("ix_message_deletions_user_id", table_name="message_deletions")
    op.drop_index("ix_message_deletions_message_id", table_name="message_deletions")
    op.drop_table("message_deletions")
    op.drop_index("ix_message_reads_user_id", table_name="message_reads")
    op.drop_index("ix_message_reads_message_id", table_name="message_reads")
    op.drop_table("message_reads")
    op.drop_index("ix_messages_sender_id", table_name="messages")
    op.drop_index("ix_messages_reply_to_message_id", table_name="messages")
    op.drop_index("ix_messages_created_at", table_name="messages")
    op.drop_index("ix_messages_conversation_id", table_name="messages")
    op.drop_table("messages")
    op.drop_index("ix_conversation_members_user_id", table_name="conversation_members")
    op.drop_index("ix_conversation_members_conversation_id", table_name="conversation_members")
    op.drop_table("conversation_members")
    op.drop_index("ix_conversations_user2_id", table_name="conversations")
    op.drop_index("ix_conversations_user1_id", table_name="conversations")
    op.drop_index("ix_conversations_owner_id", table_name="conversations")
    op.drop_table("conversations")
    op.drop_index("ix_friendships_user_id", table_name="friendships")
    op.drop_index("ix_friendships_friend_id", table_name="friendships")
    op.drop_table("friendships")
    op.drop_index("ix_friend_requests_sender_id", table_name="friend_requests")
    op.drop_index("ix_friend_requests_receiver_id", table_name="friend_requests")
    op.drop_table("friend_requests")
    op.drop_index("ix_refresh_tokens_user_id", table_name="refresh_tokens")
    op.drop_table("refresh_tokens")
    op.drop_index("ix_users_phone", table_name="users")
    op.drop_index("ix_users_name", table_name="users")
    op.drop_index("ix_users_email", table_name="users")
    op.drop_table("users")
