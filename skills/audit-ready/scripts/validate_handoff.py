"""Standalone standard-library validator for the AICodeAudit handoff protocol."""
from __future__ import annotations

import argparse
import hashlib
import json
import sys
from datetime import datetime
from pathlib import Path, PurePosixPath


def content_hash(text):
    return hashlib.sha256(text.replace('\r\n', '\n').replace('\r', '\n').encode('utf-8')).hexdigest()


def references(document):
    if not isinstance(document, dict):
        return
    for feature in document.get('features', []) if isinstance(document.get('features'), list) else []:
        if isinstance(feature, dict):
            for field in ('entrypoints', 'flow'):
                for ref in feature.get(field, []) if isinstance(feature.get(field), list) else []:
                    yield ref
    for check in document.get('checks', []) if isinstance(document.get('checks'), list) else []:
        if isinstance(check, dict) and 'evidence' in check:
            yield check['evidence']


def validate(document, files):
    errors, refs = [], []
    if not isinstance(document, dict) or document.get('version') != 1:
        return {'errors': ['交接包必须为 version: 1 的 JSON 对象。'], 'references': [], 'valid': False}
    if not isinstance(document.get('project'), dict) or not isinstance(document['project'].get('summary'), str):
        errors.append('project.summary 必须为字符串。')
    for key in ('features', 'checks', 'risks'):
        if not isinstance(document.get(key), list):
            errors.append(key + ' 必须为数组。')
    ids = set()
    for f in document.get('features', []) if isinstance(document.get('features'), list) else []:
        if not isinstance(f, dict):
            errors.append('功能必须为对象。'); continue
        if not isinstance(f.get('id'), str) or f.get('id') in ids:
            errors.append('功能 id 缺失或重复。')
        ids.add(str(f.get('id')))
        if not isinstance(f.get('title'), str) or not isinstance(f.get('summary'), str):
            errors.append('功能 title 和 summary 必须为字符串。')
        if f.get('status') not in ('implemented', 'partial', 'planned'):
            errors.append('功能状态无效。')
        for field in ('entrypoints', 'flow'):
            if not isinstance(f.get(field, []), list):
                errors.append(field + ' 必须为数组。')
        if f.get('status') in ('implemented', 'partial') and not f.get('entrypoints'):
            errors.append(str(f.get('title')) + ' 缺少源码入口。')
    for c in document.get('checks', []) if isinstance(document.get('checks'), list) else []:
        if not isinstance(c, dict):
            errors.append('检查记录必须为对象。'); continue
        if c.get('status') not in ('passed', 'failed', 'not_run'):
            errors.append('检查状态无效。')
        if c.get('status') in ('passed', 'failed'):
            if type(c.get('exit_code')) is not int or not c.get('evidence'):
                errors.append('已运行检查缺少退出码或证据引用。')
            elif (c['exit_code'] == 0) != (c['status'] == 'passed'):
                errors.append('检查状态与退出码矛盾。')
            try:
                dt = datetime.fromisoformat(c.get('ran_at', '').replace('Z', '+00:00'))
                if dt.tzinfo is None:
                    raise ValueError()
            except (ValueError, TypeError, AttributeError):
                errors.append('已运行检查缺少带时区的有效 ran_at。')
    for ref in references(document):
        if not isinstance(ref, dict):
            errors.append('源码引用必须为对象。'); continue
        path, line = ref.get('path'), ref.get('line')
        state = 'matched'
        if not isinstance(path, str) or not path or '\\' in path or ':' in path or PurePosixPath(path).is_absolute() or '..' in PurePosixPath(path).parts:
            state = 'invalid_path'
        elif path not in files:
            state = 'missing'
        elif type(line) is not int or line < 1 or line > max(1, len(files[path].splitlines())):
            state = 'invalid_line'
        elif not ref.get('sha256'):
            state = 'unpinned'
        elif ref['sha256'] != content_hash(files[path]):
            state = 'stale'
        refs.append({**ref, 'state': state})
        if state != 'matched':
            errors.append(f'{path}:{line} — {state}')
    return {'errors': errors, 'references': refs, 'valid': not errors}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('project')
    parser.add_argument('--stamp', action='store_true', help='Update reference hashes to current content; does not verify behavior')
    args = parser.parse_args()
    root = Path(args.project).resolve(strict=True)
    manifest = root / '.aicodeaudit' / 'handoff.json'
    if not manifest.resolve().is_relative_to(root) or manifest.is_symlink():
        raise ValueError('交接包必须位于项目内。')
    document = json.loads(manifest.read_text(encoding='utf-8-sig'))
    files = {}
    for ref in references(document):
        if not isinstance(ref, dict) or not isinstance(ref.get('path'), str):
            continue
        rel = ref['path']
        path = root / rel
        if path.resolve().is_relative_to(root) and path.is_file() and not path.is_symlink() and path.stat().st_size <= 350_000:
            try:
                files[rel] = path.read_bytes().decode('utf-8-sig')
                if args.stamp:
                    ref['sha256'] = content_hash(files[rel])
            except UnicodeError:
                pass
    if args.stamp:
        manifest.write_text(json.dumps(document, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    result = validate(document, files)
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if result['valid'] else 1


if __name__ == '__main__':
    try:
        sys.exit(main())
    except (OSError, ValueError) as exc:
        print(str(exc), file=sys.stderr)
        sys.exit(1)
