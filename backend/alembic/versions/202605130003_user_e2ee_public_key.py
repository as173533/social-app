"""add user e2ee public key

Revision ID: 202605130003
Revises: 202605130002
Create Date: 2026-05-13
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "202605130003"
down_revision: Union[str, None] = "202605130002"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    existing = {column["name"] for column in sa.inspect(bind).get_columns("users")}
    if "e2ee_public_key" not in existing:
        op.add_column("users", sa.Column("e2ee_public_key", sa.Text(), nullable=True))


def downgrade() -> None:
    bind = op.get_bind()
    existing = {column["name"] for column in sa.inspect(bind).get_columns("users")}
    if "e2ee_public_key" in existing:
        op.drop_column("users", "e2ee_public_key")
