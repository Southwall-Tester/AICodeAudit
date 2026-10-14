import hashlib
import json
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from audit import analyzer, handoff
from audit.server import Workbench, make_handler, report


def meta(name='Sample'):
    return {'name': name, 'root': '', 'skipped': {}, 'source': 'upload', 'bytes': 0}


class AnalyzerTests(unittest.TestCase):
    def test_python_relative_and_absolute_imports(self):
        files = {'pkg/api.py': 'from .service import work\n@app.get("/tasks")\ndef tasks():\n    return work()\n', 'pkg/service.py': 'def work():\n    return []\n', 'main.py': 'from pkg.api import tasks\n'}
        p = analyzer.analyze(files, meta())
        self.assertEqual({(e['source'], e['target']) for e in p['edges']}, {('pkg/api.py', 'pkg/service.py'), ('main.py', 'pkg/api.py')})
        self.assertEqual(p['endpoints'][0]['route'], '/tasks')
        self.assertEqual(p['endpoints'][0]['line'], 3)

    def test_js_resolves_relative_import_but_not_alias(self):
        p = analyzer.analyze({'src/app.ts': "import { x } from './lib';\nimport y from '@/secret';\n", 'src/lib/index.ts': 'export const x = 2;'}, meta())
        self.assertEqual(p['edges'][0]['target'], 'src/lib/index.ts')
        self.assertEqual(p['unresolved'][0]['spec'], '@/secret')

    def test_invalid_python_retains_text_and_reports_failure(self):
        p = analyzer.analyze({'bad.py': 'def broken(:\n'}, meta())
        self.assertEqual(p['issues'][0]['kind'], 'parse')
        self.assertEqual(p['stats']['files'], 1)

    def test_snapshot_is_order_independent_and_changes_with_content(self):
        a = analyzer.analyze({'b.py': 'b=1', 'a.py': 'a=2'}, meta())
        b = analyzer.analyze({'a.py': 'a=2', 'b.py': 'b=1'}, meta())
        c = analyzer.analyze({'a.py': 'a=3', 'b.py': 'b=1'}, meta())
        self.assertEqual(a['snapshot'], b['snapshot'])
        self.assertNotEqual(a['snapshot'], c['snapshot'])

    def test_directory_excludes_secrets_deps_and_ignored_paths(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            for name in ('app.py', '.env', 'credentials.json', 'ignored.py'):
                (root / name).write_text('x=1', encoding='utf-8')
            (root / '.gitignore').write_text('ignored.py\n', encoding='utf-8')
            (root / 'node_modules').mkdir()
            (root / 'node_modules/a.js').write_text('bad()', encoding='utf-8')
            files, _ = analyzer.read_directory(tmp)
            self.assertEqual(set(files), {'app.py', '.gitignore'})

    def test_upload_rejects_traversal_and_secret_paths(self):
        files, _ = analyzer.uploaded_files([{'path': '../outside.py', 'content': 'x'}, {'path': 'C:/bad.py', 'content': 'x'}, {'path': '.env.json', 'content': 'x'}, {'path': 'app.py', 'content': 'ok=1'}], 'sample')
        self.assertEqual(files, {'app.py': 'ok=1'})

    def test_empty_project_is_actionable_error(self):
        with self.assertRaisesRegex(ValueError, '没有可分析'):
            analyzer.analyze({}, meta())

    def test_different_project_produces_own_routes_and_tour(self):
        p = analyzer.analyze({'entry.py': '@router.post("/invoices")\ndef issue_invoice():\n    return 1\n', 'tests/test_invoice.py': 'assert 1\n'}, meta('Billing'))
        self.assertEqual(p['endpoints'][0]['route'], '/invoices')
        self.assertTrue(all(t['path'] in {'entry.py', 'tests/test_invoice.py'} for t in p['tour']))
        self.assertNotIn('Campus', json.dumps(p))

    def test_search_has_real_line_numbers(self):
        files = {'auth.py': '# service\ndef login():\n    return True\n', 'other.py': 'x=0'}
        p = analyzer.analyze(files, meta())
        hits = analyzer.search(p, files, '登录')
        self.assertEqual((hits[0]['path'], hits[0]['line']), ('auth.py', 2))


class HandoffTests(unittest.TestCase):
    def document(self):
        return {'version': 1, 'project': {'summary': 'Test'}, 'features': [{'id': 'x', 'title': 'X', 'summary': 'X', 'status': 'implemented', 'entrypoints': [{'path': 'app.py', 'line': 1, 'sha256': hashlib.sha256(b'x=1').hexdigest()}]}], 'checks': [], 'risks': []}

    def test_valid_reference_and_stale_reference_are_distinct(self):
        self.assertTrue(handoff.validate(self.document(), {'app.py': 'x=1'})['valid'])
        result = handoff.validate(self.document(), {'app.py': 'x=2'})
        self.assertFalse(result['valid'])
        self.assertEqual(result['references'][0]['state'], 'stale')

    def test_missing_out_of_range_and_unpinned_refs(self):
        d = self.document()
        self.assertEqual(handoff.validate(d, {})['references'][0]['state'], 'missing')
        d['features'][0]['entrypoints'][0]['line'] = 22
        self.assertEqual(handoff.validate(d, {'app.py': 'x=1'})['references'][0]['state'], 'invalid_line')
        d['features'][0]['entrypoints'][0] = {'path': 'app.py', 'line': 1}
        self.assertEqual(handoff.validate(d, {'app.py': 'x=1'})['references'][0]['state'], 'unpinned')

    def test_claimed_passing_check_requires_consistent_evidence(self):
        d = self.document()
        d['checks'] = [{'status': 'passed', 'exit_code': 1, 'ran_at': 'today'}]
        result = handoff.validate(d, {'app.py': 'x=1'})
        self.assertFalse(result['valid'])
        self.assertGreaterEqual(len(result['errors']), 2)

    def test_invalid_document_does_not_crash(self):
        for document in ([], {'version': 1, 'features': [None], 'checks': None}, {'version': 1, 'features': 'bad', 'checks': [], 'risks': []}):
            result = handoff.inspect({'.aicodeaudit/handoff.json': json.dumps(document)})
            self.assertFalse(result['valid'])

    def test_paths_cannot_escape_project(self):
        d = self.document()
        d['features'][0]['entrypoints'][0]['path'] = '../app.py'
        self.assertEqual(handoff.validate(d, {'../app.py': 'x=1'})['references'][0]['state'], 'invalid_path')

    def test_reference_hash_is_portable_across_line_endings(self):
        d = self.document()
        d['features'][0]['entrypoints'][0]['sha256'] = hashlib.sha256(b'x=1\n').hexdigest()
        self.assertTrue(handoff.validate(d, {'app.py': 'x=1\r\n'})['valid'])


class IntegrationTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.w = Workbench(Path(self.tmp.name))
        self.server = ThreadingHTTPServer(('127.0.0.1', 0), make_handler(self.w))
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.url = f'http://127.0.0.1:{self.server.server_port}'

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()
        self.tmp.cleanup()

    def call(self, path, data=None, headers=None):
        req = urllib.request.Request(self.url + '/api/' + path, data=json.dumps(data).encode() if data else None, headers={'Content-Type': 'application/json', **(headers or {})})
        with urllib.request.urlopen(req) as response:
            return json.load(response)

    def imported(self):
        return self.call('import', {'name': 'Test', 'files': [{'path': 'main.py', 'content': 'def login():\n    return True\n'}]})

    def test_import_source_search_note_and_export(self):
        p = self.imported()
        source = self.call('source?id=' + p['id'] + '&path=main.py')
        self.assertIn('def login', source['content'])
        hits = self.call('search?id=' + p['id'] + '&q=login')
        self.assertEqual(hits[0]['line'], 1)
        self.call('progress', {'id': p['id'], 'snapshot': p['snapshot'], 'key': 'main.py', 'value': {'done': True, 'note': 'verified input'}})
        loaded = self.call('project?id=' + p['id'])
        self.assertTrue(loaded['progress']['items']['main.py']['done'])
        text = report(loaded, loaded['progress'])
        self.assertIn('verified input', text)
        self.assertIn('[x]', text)

    def test_snapshot_change_invalidates_progress_and_stale_writes(self):
        p = self.imported()
        self.call('progress', {'id': p['id'], 'snapshot': p['snapshot'], 'key': 'main.py', 'value': {'done': True}})
        newer = self.call('import', {'name': 'Test', 'files': [{'path': 'main.py', 'content': 'def login():\n    return False\n'}]})
        loaded = self.call('project?id=' + newer['id'])
        self.assertEqual(loaded['progress']['items'], {})
        self.assertEqual(loaded['progress']['previous_records'], 1)
        with self.assertRaises(urllib.error.HTTPError) as caught:
            self.call('progress', {'id': p['id'], 'snapshot': p['snapshot'], 'key': 'main.py', 'value': {'done': True}})
        self.assertEqual(caught.exception.code, 400)

    def test_cross_origin_and_rebinding_hosts_are_rejected(self):
        for headers in ({'Origin': 'https://evil.example'}, {'Host': 'evil.example'}, {'Sec-Fetch-Site': 'cross-site'}):
            with self.assertRaises(urllib.error.HTTPError) as caught:
                self.call('projects', headers=headers)
            self.assertEqual(caught.exception.code, 403)

    def test_local_question_has_sources_without_model(self):
        p = self.imported()
        answer = self.call('ask', {'id': p['id'], 'snapshot': p['snapshot'], 'question': '登录在哪里？'})
        self.assertEqual(answer['mode'], 'retrieval')
        self.assertEqual(answer['sources'][0]['path'], 'main.py')

    def test_source_lookup_cannot_read_outside_index(self):
        p = self.imported()
        with self.assertRaises(urllib.error.HTTPError):
            self.call('source?id=' + p['id'] + '&path=../server.py')

    def test_settings_do_not_return_api_key_and_clear_on_endpoint_change(self):
        self.call('settings', {'endpoint': 'https://example.com/v1/chat/completions', 'model': 'sample', 'key': 'test-only-value'})
        s = self.call('settings')
        self.assertTrue(s['has_key'])
        self.assertNotIn('test-only-value', json.dumps(s))
        self.call('settings', {'endpoint': 'http://127.0.0.1:9999/v1/chat/completions', 'model': 'sample'})
        self.assertFalse(self.call('settings')['has_key'])

    def test_model_adapter_uses_bounded_real_context(self):
        requests = []
        class Model(BaseHTTPRequestHandler):
            def do_POST(self):
                requests.append(json.loads(self.rfile.read(int(self.headers['Content-Length']))))
                data = json.dumps({'choices': [{'message': {'content': '入口位于 main.py:L1。'}}]}).encode()
                self.send_response(200); self.end_headers(); self.wfile.write(data)
            def log_message(self, *args):
                pass
        model = ThreadingHTTPServer(('127.0.0.1', 0), Model)
        thread = threading.Thread(target=model.serve_forever, daemon=True)
        thread.start()
        try:
            self.call('settings', {'endpoint': f'http://127.0.0.1:{model.server_port}/chat/completions', 'model': 'test'})
            p = self.imported()
            answer = self.call('ask', {'id': p['id'], 'snapshot': p['snapshot'], 'question': '登录', 'use_model': True})
            self.assertEqual(answer['mode'], 'model')
            self.assertEqual(answer['sources'][0]['path'], 'main.py')
            context = json.loads(requests[0]['messages'][1]['content'])
            self.assertIn('1: def login()', context['sources'][0]['excerpt'])
        finally:
            model.shutdown(); model.server_close(); thread.join()

    def test_delete_only_removes_local_index(self):
        p = self.imported()
        self.call('delete', {'id': p['id']})
        self.assertEqual(self.call('projects'), [])


if __name__ == '__main__':
    unittest.main()
