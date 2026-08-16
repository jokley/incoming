"""Alembic runtime wired to the application's settings and model metadata."""

from logging.config import fileConfig

from alembic import context
from sqlalchemy import engine_from_config, pool

from config import RuntimeSettings
from models import db


config = context.config
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

settings = RuntimeSettings.from_environment()
database_url = settings.database_url
# ConfigParser treats percent signs in escaped credentials as interpolation.
config.set_main_option("sqlalchemy.url", database_url.replace("%", "%%"))
target_metadata = db.metadata


def run_migrations_offline() -> None:
    """Render SQL without opening a database connection."""
    context.configure(
        url=database_url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        compare_type=True,
        compare_server_default=True,
    )

    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    """Run migrations transactionally against the configured database."""
    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )

    with connectable.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            compare_type=True,
            compare_server_default=True,
        )

        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
