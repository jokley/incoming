"""Admin scenario downloads; authentication and auditing remain app-wide."""

import io
from pathlib import Path
import tempfile
import zipfile

from flask import Blueprint, jsonify, send_file

from scenario_generator import SCENARIOS, generate_complete_suite, generate_scenario


admin_scenarios = Blueprint('admin_scenarios', __name__)


@admin_scenarios.route('/api/admin/scenarios', methods=['GET'])
def list_scenarios():
    """Return immutable scenario metadata; generation happens only on demand."""
    return jsonify([scenario.public_dict() for scenario in SCENARIOS])


@admin_scenarios.route('/api/admin/scenarios/<number>/generate', methods=['POST'])
def download_scenario(number):
    """Build one self-contained, deterministic scenario archive in memory."""
    memory_file = io.BytesIO()
    try:
        with tempfile.TemporaryDirectory() as tmp_dir:
            generated = generate_scenario(number, Path(tmp_dir))
            with zipfile.ZipFile(memory_file, mode='w', compression=zipfile.ZIP_DEFLATED) as archive:
                for path in sorted(generated['root'].rglob('*')):
                    if not path.is_file():
                        continue
                    info = zipfile.ZipInfo(str(path.relative_to(generated['root'].parent)), (2027, 1, 1, 0, 0, 0))
                    info.compress_type = zipfile.ZIP_DEFLATED
                    info.external_attr = 0o600 << 16
                    archive.writestr(info, path.read_bytes())
    except KeyError:
        return jsonify({'error': 'SCENARIO_NOT_FOUND', 'message': 'Unbekanntes Szenario'}), 404
    memory_file.seek(0)
    return send_file(memory_file, mimetype='application/zip', as_attachment=True,
                     download_name=f'wm-scenario-{number}.zip')


@admin_scenarios.route('/api/admin/scenarios/complete/generate', methods=['POST'])
def download_complete_scenarios():
    """Build the complete chronological regression workspace."""
    memory_file = io.BytesIO()
    with tempfile.TemporaryDirectory() as tmp_dir:
        root = generate_complete_suite(Path(tmp_dir))
        with zipfile.ZipFile(memory_file, mode='w', compression=zipfile.ZIP_DEFLATED) as archive:
            for path in sorted(root.rglob('*')):
                if path.is_file():
                    archive.write(path, path.relative_to(root.parent))
    memory_file.seek(0)
    return send_file(memory_file, mimetype='application/zip', as_attachment=True,
                     download_name='Kompletter_Testordner.zip')
