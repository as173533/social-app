"""message attachments

Revision ID: 202605120001
Revises: 202605090001
Create Date: 2026-05-12
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "202605120001"
down_revision: Union[str, None] = "202605090001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("messages", sa.Column("message_type", sa.String(length=20), nullable=False, server_default="text"))
    op.add_column("messages", sa.Column("attachment_url", sa.String(length=500), nullable=True))
    op.add_column("messages", sa.Column("attachment_name", sa.String(length=255), nullable=True))
    op.add_column("messages", sa.Column("attachment_mime", sa.String(length=120), nullable=True))
    op.add_column("messages", sa.Column("attachment_size", sa.BigInteger(), nullable=True))
    op.alter_column("messages", "message_type", server_default=None)


def downgrade() -> None:
    op.drop_column("messages", "attachment_size")
    op.drop_column("messages", "attachment_mime")
    op.drop_column("messages", "attachment_name")
    op.drop_column("messages", "attachment_url")
    op.drop_column("messages", "message_type")
