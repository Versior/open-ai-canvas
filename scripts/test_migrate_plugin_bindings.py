import hashlib
import importlib.util
import io
import json
from pathlib import Path
import shutil
import tempfile
import unittest
from zipfile import ZipFile

spec = importlib.util.spec_from_file_location('cutover', Path(__file__).with_name('migrate-plugin-bindings.py'))
cutover = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cutover)


def package(root, version, marker):
    manifest = {'id': 'official-fixture', 'version': version, 'contributes': {'providers': [{'id': 'fixture'}]}}
    raw = io.BytesIO()
    with ZipFile(raw, 'w') as z:
        z.writestr('manifest.json', json.dumps(manifest))
        z.writestr('README.md', marker)
    digest = hashlib.sha256(raw.getvalue()).hexdigest()
    name = digest + '.yingce-plugin'
    (root / 'plugin-packages' / name).write_bytes(raw.getvalue())
    return {'id': manifest['id'], 'source': 'official', 'packageSha256': digest, 'packagePath': name, 'fileName': 'fixture.yingce-plugin', 'manifest': manifest}


class PluginCutoverTests(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.old, self.mid, self.target = (Path(tmp.name) / x for x in ('old', 'mid', 'target'))
        (self.old / 'plugin-packages').mkdir(parents=True)
        a = self.first = package(self.old, '1.0.0', 'original')
        (self.old / cutover.REG).write_text(json.dumps([a]))
        (self.old / cutover.DB).touch()
        with cutover.db_at(self.old, write=True) as db:
            db.executescript('''CREATE TABLE schema_migrations(version INTEGER); INSERT INTO schema_migrations VALUES (112);
            CREATE TABLE model_channels(id TEXT, enabled BOOLEAN, deleted_at TEXT); INSERT INTO model_channels VALUES ('channel', 1, NULL);
            CREATE TABLE channel_models(id TEXT PRIMARY KEY,channel_id TEXT,protocol TEXT,model_key TEXT,provider_model_key TEXT,capability TEXT,
            capability_version INTEGER,price_version INTEGER,updated_at TEXT,enabled BOOLEAN,deleted_at TEXT);
            INSERT INTO channel_models VALUES ('kept','channel','fixture','old','p','video',2,3,'stamp',1,NULL),
            ('explicit','channel','fixture','old2','p','video',2,3,'stamp',1,NULL),('edited','channel','fixture','old3','p','video',2,3,'stamp',1,NULL),
            ('unknown','channel','missing','old4','p','video',2,3,'stamp',1,NULL),('deleted','channel','fixture','old5','p','video',2,3,'stamp',1,'stamp');''')
        shutil.copytree(self.old, self.mid)
        b = package(self.mid, '1.0.0', 'overwritten')
        b['manifest']['enabled'] = False
        (self.mid / cutover.REG).write_text(json.dumps([b, {'id': 'kept-upload', 'source': 'uploaded', 'manifest': {}}]))
        shutil.copytree(self.mid, self.target)

    def run_step(self, action, apply):
        return cutover.run(action, self.old, self.mid, self.target, apply)

    def test_preserve_legacy_release_only_for_unchanged_unpinned_models(self):
        self.assertEqual(self.run_step('prepare', False)['restored'], 1)
        self.assertEqual(self.run_step('prepare', True)['restored'], 1)
        self.assertEqual(self.run_step('prepare', True)['restored'], 0)
        records = cutover.registry(self.target)
        self.assertEqual(records['kept-upload']['source'], 'uploaded')
        self.assertFalse(records['official-fixture']['manifest']['enabled'])
        new = package(self.target, '1.0.1', 'published')
        new['requestReleases'] = [{'version': '1.0.0','sha256': self.first['packageSha256']}]
        (self.target / cutover.REG).write_text(json.dumps([new, records['kept-upload']]))
        with cutover.db_at(self.target, True) as db:
            db.executescript("ALTER TABLE channel_models ADD COLUMN protocol_release TEXT; INSERT INTO schema_migrations VALUES (117); CREATE TABLE yingce_schema_migrations(version INTEGER); INSERT INTO yingce_schema_migrations VALUES(4);UPDATE channel_models SET protocol_release='user-choice' WHERE id='explicit'; UPDATE channel_models SET price_version=4 WHERE id='edited';")
        self.assertEqual(self.run_step('bind', False)['bind'], 1)
        summary = self.run_step('bind', True)
        self.assertEqual((summary['active'], summary['changed_sku'], summary['other_bound'], summary['no_original_evidence']), (1,1,1,1))
        again = self.run_step('bind', True)
        self.assertEqual((again['bind'], again['verified_bound']), (0,1))
        with cutover.db_at(self.target) as db:
            got = dict(db.execute('select id,protocol_release from channel_models'))
            self.assertEqual(got, {'kept':self.first['packageSha256'],'explicit':'user-choice','edited':None,'deleted':None,'unknown':None})

    def test_unexpected_snapshot_refuses_before_writing(self):
        path = self.target / cutover.REG
        third = package(self.target, '1.0.0', 'unproven')
        path.write_text(json.dumps([third])); before = path.read_bytes()
        with self.assertRaisesRegex(ValueError, 'third artifact'):
            self.run_step('prepare', True)
        self.assertEqual(path.read_bytes(), before)
        with self.assertRaisesRegex(ValueError, 'independent files'):
            cutover.run('prepare', self.old, self.mid, self.mid, True)


if __name__ == '__main__':
    unittest.main()
