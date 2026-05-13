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
    op.add_column("users", sa.Column("e2ee_public_key", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("users", "e2ee_public_key")
