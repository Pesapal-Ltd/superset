import sqlalchemy as sa
from alembic import op

revision = '9142fb185440'
down_revision = '20260402_111200'
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table('email_verification_log') as batch_op:
        batch_op.add_column(sa.Column('confirmation_code', sa.String(255), nullable=True))
        batch_op.create_index('ix_ev_log_cc', ['confirmation_code'], unique=False)


def downgrade() -> None:
    with op.batch_alter_table('email_verification_log') as batch_op:
        batch_op.drop_index('ix_ev_log_cc')
        batch_op.drop_column('confirmation_code')
