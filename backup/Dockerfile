FROM python:3.13-alpine

RUN apk add --no-cache postgresql17-client
WORKDIR /opt/backup
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY backup_service.py .

VOLUME ["/backups"]
EXPOSE 8080
ENTRYPOINT ["python", "/opt/backup/backup_service.py"]
CMD ["serve"]

