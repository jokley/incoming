"""Mock import file downloads; authentication remains app-wide."""

import io
import os
from pathlib import Path
import tempfile
import zipfile

from flask import Blueprint, current_app, jsonify, send_file, send_from_directory

from generate_test_files import generate_mock_files


import_mock_files = Blueprint('import_mock_files', __name__)


def list_mock_fis_files():
    if not os.path.isdir(current_app.config['MOCK_FILES_DIR']):
        return []

    pairs = {}
    for filename in os.listdir(current_app.config['MOCK_FILES_DIR']):
        if not filename.lower().endswith(('.xlsx', '.xls')):
            continue
        upper = filename.upper()
        if upper.startswith('ENTRIES-LIST_'):
            discipline_key = filename.split('ENTRIES-LIST_', 1)[1].rsplit('.', 1)[0]
            entry = pairs.setdefault(discipline_key, {'disciplineKey': discipline_key})
            entry['entriesFile'] = filename
        elif upper.startswith('ENTRIES-ROOM-LIST-DETAILED_'):
            discipline_key = filename.split('ENTRIES-ROOM-LIST-DETAILED_', 1)[1].rsplit('.', 1)[0]
            entry = pairs.setdefault(discipline_key, {'disciplineKey': discipline_key})
            entry['roomFile'] = filename

    result = []
    for discipline_key, entry in sorted(pairs.items()):
        label = discipline_key
        if label.startswith('2027_WM_'):
            label = label.split('2027_WM_', 1)[1]
        label = label.replace('_', ' ').title()
        result.append({
            'discipline': label,
            'disciplineKey': discipline_key,
            'entriesFile': entry.get('entriesFile'),
            'roomFile': entry.get('roomFile'),
            'entriesDownloadUrl': f"/api/import/fis/mock-files/{entry['entriesFile']}" if entry.get('entriesFile') else None,
            'roomDownloadUrl': f"/api/import/fis/mock-files/{entry['roomFile']}" if entry.get('roomFile') else None,
        })
    return result


@import_mock_files.route('/api/import/fis/mock-files', methods=['GET'])
@import_mock_files.route('/api/import/fis/mock-files/', methods=['GET'])
def get_mock_fis_files():
    return jsonify(list_mock_fis_files())


@import_mock_files.route('/api/import/fis/mock-files/<path:filename>', methods=['GET'])
@import_mock_files.route('/api/import/fis/mock-files/<path:filename>/', methods=['GET'])
def download_mock_fis_file(filename):
    return send_from_directory(current_app.config['MOCK_FILES_DIR'], filename, as_attachment=True)


@import_mock_files.route('/api/import/fis/mock-files/download-all', methods=['GET'])
@import_mock_files.route('/api/import/fis/mock-files/download-all/', methods=['GET'])
def download_all_mock_fis_files():
    memory_file = io.BytesIO()
    with tempfile.TemporaryDirectory() as tmp_dir:
        generated = generate_mock_files(Path(tmp_dir))
        with zipfile.ZipFile(memory_file, mode='w', compression=zipfile.ZIP_DEFLATED) as archive:
            for entry in generated:
                entries_path = entry.get('entries_path')
                room_path = entry.get('room_path')
                if entries_path and os.path.exists(entries_path):
                    archive.write(entries_path, arcname=os.path.basename(entries_path))
                if room_path and os.path.exists(room_path):
                    archive.write(room_path, arcname=os.path.basename(room_path))

    memory_file.seek(0)
    return send_file(
        memory_file,
        mimetype='application/zip',
        as_attachment=True,
        download_name='fis-mock-files.zip',
    )
