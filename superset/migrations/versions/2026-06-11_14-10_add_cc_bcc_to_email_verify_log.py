"""Add cc_address and bcc_address to email_verification_log

Revision ID: add_cc_bcc_ev_log
Revises: 9142fb185440
Create Date: 2026-06-11 14:10:00
"""

import sqlalchemy as sa
from alembic import op

revision = 'add_cc_bcc_ev_log'
down_revision = '9142fb185440'
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table('email_verification_log') as batch_op:
        batch_op.add_column(sa.Column('cc_address', sa.Text(), nullable=True))
        batch_op.add_column(sa.Column('bcc_address', sa.Text(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table('email_verification_log') as batch_op:
        batch_op.drop_column('bcc_address')
        batch_op.drop_column('cc_address')
