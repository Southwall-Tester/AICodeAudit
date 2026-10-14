"""Bounded, read-only project indexing. Never imports or executes target code."""
from __future__ import annotations

import ast
import fnmatch
import hashlib
import json
import os
import posixpath
import re
from collections import Counter, deque
from pathlib import Path, PurePosixPath

MAX_FILES = 1500
MAX_FILE_BYTES = 350_000
MAX_TOTAL_BYTES = 12_000_000
SKIP_DIRS = {'.git', '.svn', '.hg', 'node_modules', '.venv', 'venv', 'env', '__pycache__', 'dist', 'build', '.next', '.nuxt', '.local', 'coverage', '.idea', '.vscode', 'vendor', 'artifacts'}
EXTENSIONS = {'.py', '.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs', '.vue', '.svelte', '.json', '.md', '.toml', '.yaml', '.yml', '.html', '.css', '.scss', '.sql', '.go', '.rs', '.java', '.sh', '.bat', '.ps1', '.txt'}
LANGUAGES = {'.py': 'Python', '.js': 'JavaScript', '.jsx': 'JavaScript', '.mjs': 'JavaScript', '.cjs': 'JavaScript', '.ts': 'TypeScript', '.tsx': 'TypeScript', '.vue': 'Vue', '.svelte': 'Svelte', '.go': 'Go', '.rs': 'Rust', '.java': 'Java', '.css': 'CSS', '.scss': 'CSS', '.html': 'HTML', '.sql': 'SQL'}


def eligible(path: str) -> bool:
    p = PurePosixPath(path)
    if p.is_absolute() or '..' in p.parts or ':' in path or not p.parts:
        return False
    lower = p.name.lower()
    if any(x.lower() in SKIP_DIRS for x in p.parts[:-1]):
        return False
    if lower.startswith('.env') or any(x in lower for x in ('credential', 'secret', 'private_key', 'id_rsa')):
        return False
    if lower in {'package-lock.json', 'pnpm-lock.yaml', 'yarn.lock', 'uv.lock', 'poetry.lock'} or lower.endswith(('.min.js', '.min.css', '.map')):
        return False
    return p.suffix.lower() in EXTENSIONS or lower in {'dockerfile', 'makefile', 'procfile', '.gitignore'}


def read_directory(root: str) -> tuple[dict[str, str], dict]:
    base = Path(root).expanduser().resolve(strict=True)
    if not base.is_dir():
        raise ValueError('请选择项目文件夹。')
    files, skipped, total = {}, Counter(), 0
    patterns = []
    ignore = base / '.gitignore'
    if ignore.is_file() and ignore.stat().st_size < MAX_FILE_BYTES:
        patterns = [s.strip() for s in ignore.read_text(encoding='utf-8', errors='replace').splitlines() if s.strip() and not s.startswith(('#', '!'))]
    def ignored(rel):
        for pat in patterns:
            pat = pat.lstrip('/').rstrip('/')
            if fnmatch.fnmatch(rel, pat) or rel.startswith(pat + '/') or ('/' not in pat and any(fnmatch.fnmatch(x, pat) for x in rel.split('/'))):
                return True
        return False
    for directory, dirs, names in os.walk(base, followlinks=False):
        dirs[:] = sorted(d for d in dirs if d.lower() not in SKIP_DIRS and not (Path(directory) / d).is_symlink() and not (Path(directory) / d).is_junction() and not ignored((Path(directory) / d).relative_to(base).as_posix()))
        for name in sorted(names):
            path = Path(directory) / name
            rel = path.relative_to(base).as_posix()
            if not eligible(rel) or ignored(rel):
                skipped['excluded'] += 1
                continue
            try:
                if path.is_symlink() or not path.resolve().is_relative_to(base):
                    skipped['links'] += 1
                    continue
                size = path.stat().st_size
                if size > MAX_FILE_BYTES:
                    skipped['large'] += 1
                    continue
                if len(files) >= MAX_FILES or total + size > MAX_TOTAL_BYTES:
                    skipped['limit'] += 1
                    continue
                raw = path.read_bytes()
                if b'\x00' in raw:
                    skipped['binary'] += 1
                    continue
                files[rel] = raw.decode('utf-8-sig')
                total += len(raw)
            except (OSError, UnicodeError):
                skipped['unreadable'] += 1
    return files, {'name': base.name, 'root': str(base), 'skipped': dict(skipped), 'bytes': total, 'source': 'directory'}


def uploaded_files(items: list, name: str) -> tuple[dict[str, str], dict]:
    files, skipped, total = {}, Counter(), 0
    if not isinstance(items, list) or len(items) > 10000:
        raise ValueError('文件清单无效或过大。')
    for item in items:
        path = str(item.get('path', '')).replace('\\', '/')
        content = item.get('content', '')
        if not isinstance(content, str) or not eligible(path):
            skipped['excluded'] += 1
            continue
        size = len(content.encode('utf-8'))
        if size > MAX_FILE_BYTES or len(files) >= MAX_FILES or total + size > MAX_TOTAL_BYTES:
            skipped['limit'] += 1
            continue
        if '\x00' in content:
            skipped['binary'] += 1
            continue
        files[path] = content
        total += size
    return files, {'name': str(name)[:120] or 'Imported project', 'root': '', 'skipped': dict(skipped), 'bytes': total, 'source': 'upload'}


def role_for(path: str) -> str:
    p = path.lower()
    parts = re.split(r'[/_.-]', p)
    if 'test' in parts or 'tests' in parts or 'spec' in parts:
        return 'tests'
    if p.endswith('.md'):
        return 'docs'
    if any(x in parts for x in ('model', 'models', 'schema', 'schemas', 'db', 'database', 'repository', 'repositories', 'migrations')) or p.endswith('.sql'):
        return 'data'
    if any(x in parts for x in ('route', 'routes', 'router', 'routers', 'api', 'controller', 'controllers')):
        return 'api'
    if any(x in parts for x in ('service', 'services', 'core', 'domain', 'lib', 'utils')):
        return 'logic'
    if p.endswith(('.tsx', '.jsx', '.vue', '.svelte', '.html', '.css', '.scss')) or any(x in parts for x in ('components', 'pages', 'views', 'frontend', 'web', 'static')):
        return 'ui'
    if PurePosixPath(p).name in {'package.json', 'pyproject.toml', 'requirements.txt', 'dockerfile', 'makefile'} or p.endswith(('.toml', '.yaml', '.yml')):
        return 'config'
    return 'logic'


def parse_python(path, source):
    symbols, imports, routes, warnings = [], [], [], []
    try:
        tree = ast.parse(source)
    except (SyntaxError, RecursionError) as exc:
        return [], [], [], [str(exc).splitlines()[0]]
    for node in ast.walk(tree):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            symbols.append({'name': node.name, 'line': node.lineno, 'end': node.end_lineno, 'kind': 'class' if isinstance(node, ast.ClassDef) else 'function', 'doc': (ast.get_docstring(node) or '')[:400]})
            for dec in node.decorator_list:
                if isinstance(dec, ast.Call) and isinstance(dec.func, ast.Attribute) and dec.func.attr in {'get', 'post', 'put', 'delete', 'patch', 'route', 'websocket'} and dec.args and isinstance(dec.args[0], ast.Constant) and isinstance(dec.args[0].value, str):
                    routes.append({'method': dec.func.attr.upper(), 'route': dec.args[0].value, 'line': node.lineno, 'name': node.name, 'confidence': 'ast'})
        elif isinstance(node, ast.Import):
            imports.extend({'spec': a.name, 'line': node.lineno, 'kind': 'python'} for a in node.names)
        elif isinstance(node, ast.ImportFrom):
            spec = '.' * node.level + (node.module or '')
            imports.append({'spec': spec, 'line': node.lineno, 'kind': 'python'})
            for a in node.names:
                if a.name != '*':
                    imports.append({'spec': spec + ('.' if node.module else '') + a.name, 'line': node.lineno, 'kind': 'python'})
    return symbols, imports, routes, warnings


def parse_js(source):
    symbols, imports, routes = [], [], []
    # Heuristic extraction, explicitly not an AST or proof of execution.
    for i, line in enumerate(source.splitlines(), 1):
        if line.lstrip().startswith(('//', '*', '/*')):
            continue
        for m in re.finditer(r'''(?:\bfrom\s*|\bimport\s*\(?|\brequire\s*\()\s*['"]([^'"]+)['"]''', line):
            imports.append({'spec': m[1], 'line': i, 'kind': 'js'})
        m = re.search(r'\b(?:function|class)\s+(\w+)|\b(?:const|let)\s+(\w+)\s*=\s*(?:async\s*)?(?:\([^)]*\)|\w+)\s*=>', line)
        if m:
            symbols.append({'name': m[1] or m[2], 'line': i, 'end': i, 'kind': 'function', 'doc': ''})
        m = re.search(r'''\b(?:app|router|server)\.(get|post|put|patch|delete)\s*\(\s*['"]([^'"]+)['"]''', line)
        if m:
            routes.append({'method': m[1].upper(), 'route': m[2], 'line': i, 'name': m[2], 'confidence': 'heuristic'})
    return symbols, imports, routes, []


def resolve_import(path, imp, paths):
    spec = imp['spec']
    candidates = []
    if imp['kind'] == 'python':
        if spec.startswith('.'):
            count = len(spec) - len(spec.lstrip('.'))
            parent = PurePosixPath(path).parent
            for _ in range(count - 1):
                parent = parent.parent
            stem = (parent / spec.lstrip('.').replace('.', '/')).as_posix()
            candidates.extend([stem + '.py', stem + '/__init__.py'])
        else:
            stem = spec.replace('.', '/')
            candidates.extend([stem + '.py', stem + '/__init__.py', 'src/' + stem + '.py', 'src/' + stem + '/__init__.py'])
    else:
        if spec.startswith('.'):
            stem = posixpath.normpath(posixpath.join(posixpath.dirname(path), spec))
        else:
            return None
        candidates = [stem] + [stem + x for x in ('.ts', '.tsx', '.js', '.jsx', '.mjs', '.vue', '.svelte')] + [stem + '/index' + x for x in ('.ts', '.tsx', '.js', '.jsx')]
    return next((c for c in candidates if c in paths and c != path), None)


def analyze(files: dict[str, str], meta: dict) -> dict:
    if not files:
        raise ValueError('没有可分析的文本源码。请选择包含 Python、JS/TS 等源码的项目文件夹。')
    digest = hashlib.sha256()
    for path, source in sorted(files.items()):
        digest.update(path.encode()); digest.update(b'\0'); digest.update(source.encode()); digest.update(b'\0')
    snapshot = digest.hexdigest()[:16]
    project_id = hashlib.sha256((meta.get('root') or meta['name']).encode()).hexdigest()[:12]
    records, edges, endpoints, issues, entries, commands, dependencies = [], [], [], [], [], [], []
    raw_imports = {}
    for path, source in sorted(files.items()):
        suffix = PurePosixPath(path).suffix.lower()
        symbols, imports, routes, warnings = [], [], [], []
        if suffix == '.py':
            symbols, imports, routes, warnings = parse_python(path, source)
        elif suffix in {'.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs', '.vue', '.svelte'}:
            symbols, imports, routes, warnings = parse_js(source)
        raw_imports[path] = imports
        role = role_for(path)
        records.append({'path': path, 'lines': len(source.splitlines()), 'language': LANGUAGES.get(suffix, 'Text'), 'role': role, 'symbols': symbols, 'parsed': 'ast' if suffix == '.py' and not warnings else 'heuristic' if imports or symbols else 'text'})
        endpoints.extend(dict(r, path=path) for r in routes)
        for warning in warnings:
            issues.append({'path': path, 'line': 1, 'kind': 'parse', 'title': 'Python 语法解析未完成', 'detail': warning})
        for i, line in enumerate(source.splitlines(), 1):
            if re.search(r'\b(?:TODO|FIXME|NotImplementedError)\b', line) and role != 'docs':
                issues.append({'path': path, 'line': i, 'kind': 'todo', 'title': '待完成标记', 'detail': line.strip()[:200]})
        name = PurePosixPath(path).name
        if name.lower().startswith('readme'):
            entries.append({'path': path, 'line': 1, 'reason': '先核对项目宣称的用途、安装方式和边界。', 'type': 'readme'})
        if name in {'main.py', 'app.py', 'server.py', 'index.html', 'main.ts', 'main.tsx', 'main.js', 'index.ts', 'server.js'} or (suffix == '.py' and re.search(r'''if\s+__name__\s*==\s*['"]__main__['"]''', source)):
            entries.append({'path': path, 'line': 1, 'reason': '候选启动入口；查看初始化和模块装配。', 'type': 'entry'})
        if name == 'package.json':
            try:
                package = json.loads(source)
                commands.extend({'name': k, 'command': v, 'path': path, 'runner': 'npm run ' + k} for k, v in package.get('scripts', {}).items() if isinstance(v, str))
                dependencies.extend({'name': k, 'version': str(v), 'path': path} for k, v in {**package.get('dependencies', {}), **package.get('devDependencies', {})}.items())
            except (ValueError, AttributeError, TypeError):
                issues.append({'path': path, 'line': 1, 'kind': 'parse', 'title': '依赖清单解析失败', 'detail': 'package.json 不是预期的 JSON 对象。'})
        if name == 'requirements.txt':
            dependencies.extend({'name': s.strip(), 'version': '', 'path': path} for s in source.splitlines() if s.strip() and not s.startswith(('#', '-')))
    paths = set(files)
    unresolved = []
    for path, imports in raw_imports.items():
        seen = set()
        for imp in imports:
            target = resolve_import(path, imp, paths)
            if target and target not in seen:
                edges.append({'source': path, 'target': target, 'line': imp['line'], 'kind': 'import', 'spec': imp['spec']})
                seen.add(target)
            elif not target and imp['spec'].startswith(('.', '@/','~/')):
                unresolved.append({'path': path, 'line': imp['line'], 'spec': imp['spec']})
    roles = {'ui': '界面与交互', 'api': '接口与路由', 'logic': '业务与通用逻辑', 'data': '数据与模型', 'tests': '测试', 'config': '配置与依赖', 'docs': '项目文档'}
    modules = [{'id': role, 'name': title, 'files': [f['path'] for f in records if f['role'] == role], 'lines': sum(f['lines'] for f in records if f['role'] == role)} for role, title in roles.items() if any(f['role'] == role for f in records)]
    ranked = sorted(records, key=lambda f: (-sum(e['target'] == f['path'] for e in edges), f['path']))
    tour, used = [], set()
    def step(path, line, title, why):
        if path not in used and len(tour) < 14:
            used.add(path)
            tour.append({'id': path, 'path': path, 'line': line, 'title': title, 'why': why})
    for e in sorted(entries, key=lambda x: x['type'] != 'readme')[:5]:
        step(e['path'], e['line'], '了解项目约定' if e['type'] == 'readme' else '找到运行入口', e['reason'])
    for r in endpoints[:3]:
        step(r['path'], r['line'], '追踪一个功能入口', f"从 {r['method']} {r['route']} 开始，检查输入和返回值。")
    for role, title, why in [('logic', '理解核心逻辑', '查看复用的函数与业务规则，再沿导入关系阅读上下文。'), ('data', '理解数据结构', '核对数据字段、持久化方式和约束。'), ('ui', '连接用户操作', '观察页面事件如何触发请求及状态变化。'), ('tests', '核对已有验证', '阅读测试的输入和预期；测试存在并不代表已运行通过。'), ('config', '检查启动条件', '确认依赖、脚本和环境配置。')]:
        for f in [x for x in ranked if x['role'] == role][:2]:
            step(f['path'], f['symbols'][0]['line'] if f['symbols'] else 1, title, why)
    if not tour:
        step(records[0]['path'], 1, '开始阅读源码', '从这个文件开始，核对职责和相关模块。')
    readme = next((files[e['path']] for e in entries if e['type'] == 'readme'), '')
    description = ' '.join(line.strip().lstrip('#').strip() for line in readme.splitlines() if line.strip() and not line.startswith(('```', '![', '[!')))[:320]
    languages = Counter(f['language'] for f in records if f['language'] != 'Text')
    return {'id': project_id, 'snapshot': snapshot, **meta, 'description': description, 'files': records, 'edges': edges, 'modules': modules, 'endpoints': endpoints, 'issues': issues[:160], 'issue_total': len(issues), 'entries': entries, 'commands': commands, 'dependencies': dependencies[:150], 'tour': tour, 'unresolved': unresolved[:80], 'stats': {'files': len(files), 'lines': sum(f['lines'] for f in records), 'symbols': sum(len(f['symbols']) for f in records), 'edges': len(edges), 'languages': dict(languages)}, 'limits': 'Python 使用 AST；JS/TS 使用启发式提取。连线表示已解析的静态导入，不代表运行调用链。其他语言提供文本检索。'}


def search(project, files, query, limit=12):
    words = re.findall(r'[\w\u4e00-\u9fff]+', query.lower())
    aliases = {'登录': ['login', 'auth', 'signin'], '数据': ['database', 'model', 'schema', 'db'], '启动': ['main', 'app', 'server', 'scripts'], '测试': ['test', 'spec'], '接口': ['router', 'route', 'api'], '页面': ['page', 'component', 'view'], '上传': ['upload'], '支付': ['payment', 'pay'], '配置': ['config', 'setting', 'env'], '收藏': ['favorite', 'bookmark'], '订单': ['order'], '权限': ['permission', 'auth', 'role']}
    for key, values in aliases.items():
        if key in query:
            words.extend(values)
    words = list(dict.fromkeys(w for w in words if len(w) > 1))[:24]
    hits = []
    for path, source in files.items():
        path_score = sum(4 for word in words if word in path.lower())
        candidates = []
        for i, line in enumerate(source.splitlines(), 1):
            score = sum(2 for word in words if word in line.lower())
            if score:
                candidates.append((score, i, line))
        if candidates or path_score:
            best = max(candidates, default=(0, 1, source.splitlines()[0] if source.splitlines() else ''), key=lambda x: x[0])
            hits.append({'path': path, 'line': best[1], 'text': best[2][:240], 'score': best[0] + path_score})
    return sorted(hits, key=lambda x: (-x['score'], x['path']))[:limit]


def related(project, path):
    seen, queue, result = {path}, deque([(path, 0)]), []
    while queue and len(result) < 16:
        current, depth = queue.popleft()
        if depth >= 2:
            continue
        for edge in project['edges']:
            other = edge['target'] if edge['source'] == current else edge['source'] if edge['target'] == current else None
            if other and other not in seen:
                seen.add(other)
                result.append({'path': other, 'depth': depth + 1, 'direction': 'dependency' if edge['source'] == current else 'dependent', 'via': current})
                queue.append((other, depth + 1))
    return result
