"""Use the same portable validator shipped with the generator skill."""
import importlib.util
import json
from pathlib import Path

_path = Path(__file__).resolve().parent.parent / 'skills/audit-ready/scripts/validate_handoff.py'
_spec = importlib.util.spec_from_file_location('handoff_validator', _path)
_module = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_module)
validate = _module.validate


def inspect(files):
    raw = files.get('.aicodeaudit/handoff.json')
    if raw is None:
        return {'present': False, 'document': None, 'errors': [], 'references': []}
    try:
        document = json.loads(raw)
    except ValueError:
        return {'present': True, 'document': None, 'valid': False, 'errors': ['交接包 JSON 无效。'], 'references': []}
    result = validate(document, files)
    # Invalid documents remain readable as source without breaking product rendering.
    return {'present': True, 'document': document if isinstance(document, dict) and isinstance(document.get('features'), list) and all(isinstance(f, dict) for f in document['features']) else None, **result}
