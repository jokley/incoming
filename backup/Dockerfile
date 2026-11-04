FROM python:3.13-alpine

RUN apk add --no-cache postgresql17-client
WORKDIR /opt/backup
COPY backup/requirements.txt .
RUN --mount=type=secret,id=proxy_ca if [ -f /run/secrets/proxy_ca ]; then export PIP_CERT=/run/secrets/proxy_ca; fi; pip install --no-cache-dir -r requirements.txt
COPY backup/backup_service.py backup/restore_jobs.py .
COPY backend/restore_coordination.py /opt/backend/restore_coordination.py
COPY backend/alembic.ini /opt/backend/alembic.ini
COPY backend/migrations /opt/backend/migrations
# Alembic env imports model metadata, including its projection dependencies.
COPY backend/config.py backend/models.py backend/accommodation_rates.py backend/accommodation_requirements.py backend/competitions.py backend/quota_catalogue.py backend/quota_rules.py backend/event_ownership.py backend/event_ownership_runtime.py backend/accommodation_scope.py /opt/backend/
COPY backend/imports/__init__.py backend/imports/event_context.py /opt/backend/imports/
# Referenced by the World Champion migration when restoring older dumps.
COPY backend/reference_data /opt/backend/reference_data

VOLUME ["/backups"]
EXPOSE 8080
ENTRYPOINT ["python", "/opt/backup/backup_service.py"]
CMD ["serve"]
