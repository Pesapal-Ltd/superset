"""Add zoho_ticket_id to email_verification_log

Revision ID: add_zoho_ticket_id_ev_log
Revises: add_cc_bcc_ev_log
Create Date: 2026-06-27 20:42:00
"""

import sqlalchemy as sa
from alembic import op

revision = 'add_zoho_ticket_id_ev_log'
down_revision = 'add_cc_bcc_ev_log'
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table('email_verification_log') as batch_op:
        batch_op.add_column(
            sa.Column('zoho_ticket_id', sa.String(255), nullable=True)
        )


def downgrade() -> None:
    with op.batch_alter_table('email_verification_log') as batch_op:
        batch_op.drop_column('zoho_ticket_id')
