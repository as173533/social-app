"""password reset otps

Revision ID: 202605130002
Revises: 202605130001
Create Date: 2026-05-13
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "202605130002"
down_revision: Union[str, None] = "202605130001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "password_reset_otps",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("code_hash", sa.String(length=255), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("consumed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_password_reset_otps_expires_at", "password_reset_otps", ["expires_at"])
    op.create_index("ix_password_reset_otps_user_id", "password_reset_otps", ["user_id"])


def downgrade() -> None:
    op.drop_index("ix_password_reset_otps_user_id", table_name="password_reset_otps")
    op.drop_index("ix_password_reset_otps_expires_at", table_name="password_reset_otps")
    op.drop_table("password_reset_otps")
