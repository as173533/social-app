"""add user e2ee private key backup

Revision ID: 202605140001
Revises: 202605130005
Create Date: 2026-05-14
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "202605140001"
down_revision: Union[str, None] = "202605130005"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    existing = {column["name"] for column in sa.inspect(bind).get_columns("users")}
    if "e2ee_private_key" not in existing:
        op.add_column("users", sa.Column("e2ee_private_key", sa.Text(), nullable=True))


def downgrade() -> None:
    bind = op.get_bind()
    existing = {column["name"] for column in sa.inspect(bind).get_columns("users")}
    if "e2ee_private_key" in existing:
        op.drop_column("users", "e2ee_private_key")
