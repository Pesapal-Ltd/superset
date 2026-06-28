"""Create zoho_desk_token_cache table

Stores a single-row OAuth access-token cache for the Zoho Desk integration.
Avoids fetching a new token on every ticket-creation call; the token is
refreshed only when it is within 60 s of its reported expiry.

Revision ID: add_zoho_desk_token_cache
Revises: add_zoho_ticket_id_ev_log
Create Date: 2026-06-27 22:51:00
"""

import sqlalchemy as sa
from alembic import op

revision = 'add_zoho_desk_token_cache'
down_revision = 'add_zoho_ticket_id_ev_log'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'zoho_desk_token_cache',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('service', sa.String(50), nullable=False),
        sa.Column('access_token', sa.Text(), nullable=False),
        sa.Column('expires_at', sa.DateTime(), nullable=False),
        sa.Column('refreshed_at', sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('service', name='uq_zoho_desk_token_cache_service'),
    )


def downgrade() -> None:
    op.drop_table('zoho_desk_token_cache')
