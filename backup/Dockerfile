FROM python:3.13-alpine

RUN apk add --no-cache postgresql17-client
WORKDIR /opt/backup
COPY backup/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY backup/backup_service.py .
COPY backend/alembic.ini /opt/backend/alembic.ini
COPY backend/migrations /opt/backend/migrations
COPY backend/config.py backend/models.py /opt/backend/

VOLUME ["/backups"]
EXPOSE 8080
ENTRYPOINT ["python", "/opt/backup/backup_service.py"]
CMD ["serve"]
