#!/bin/sh
set -eu

# The ORM and the database must always move as one release. Running Alembic
# before Gunicorn prevents requests from reaching a process whose model expects
# columns that have not been installed yet. Alembic is transactional on
# PostgreSQL, so a failed migration stops the container instead of serving with
# a partially upgraded schema.
python -m alembic -c /app/alembic.ini upgrade head

exec "$@"
