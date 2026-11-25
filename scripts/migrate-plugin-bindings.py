"""Offline SQLite 112→117/118 plugin cutover. Operate only on a stopped, disposable target clone.

prepare before schema up; then run plugin-bootstrap with the candidate official packages;
finally bind. --baseline and --observed are immutable pre-switch and post-rollback snapshots.
Only --apply changes the target. Neither evidence directory is ever written.
"""
import argparse
from contextlib import closing, contextmanager
import hashlib
import json
import os
from pathlib import Path
import re
import sqlite3
import tempfile
from zipfile import ZipFile


DB = 'open_ai_canvas.db'
REG = 'plugin_registry.json'
# The old release is only evidence for the same, unchanged SKU, not one edited since the snapshot.
IDENTITY = 'm.id,m.channel_id,m.protocol,m.model_key,m.provider_model_key,m.capability,m.capability_version,m.price_version,m.updated_at'


def require(ok, message):
    if not ok:
        raise ValueError(message)


@contextmanager
def db_at(root, write=False):
    uri = (root / DB).as_uri() + ('?mode=rw' if write else '?mode=ro')
    with closing(sqlite3.connect(uri, uri=True)) as db, db:
        yield db


def registry(root):
    records = json.loads((root / REG).read_bytes())
    by_id = {r['id']: r for r in records}
    require(len(records) == len(by_id), 'duplicate registry identity')
    return by_id


def verified_package(root, plugin, version, digest):
    require(bool(re.fullmatch('[0-9a-f]{64}', digest)), 'invalid package digest')
    path = root / 'plugin-packages' / (digest + '.yingce-plugin')
    with path.open('rb') as fp:
        require(hashlib.file_digest(fp, 'sha256').hexdigest() == digest, f'{plugin}: package checksum mismatch')
        with ZipFile(fp) as package:
            manifest = json.loads(package.read('manifest.json'))
    require((manifest['id'], manifest['version']) == (plugin, version), f'{plugin}: package identity mismatch')
    return {p['id'] for p in manifest['contributes'].get('providers', [])}


def request_package(row):
    return row.get('source') == 'official' and row['manifest'].get('contributes', {}).get('providers') and row.get('packageSha256')


def verify_row(root, row):
    digest = row['packageSha256']
    require(row.get('packagePath') == digest + '.yingce-plugin' and row['id'] == row['manifest']['id'], 'unexpected registry artifact identity')
    ids = verified_package(root, row['id'], row['manifest']['version'], digest)
    require(ids == {p['id'] for p in row['manifest']['contributes']['providers']}, 'registry provider identities differ from package')
    return ids


def prepare(baseline, observed, target, apply):
    before, rollback, dest = map(registry, (baseline, observed, target))
    restored = 0
    for key, old in before.items():
        mid = rollback.get(key)
        if not request_package(old) or not mid or not request_package(mid) or old['packageSha256'] == mid['packageSha256']:
            continue
        row = dest.get(key)
        require(row is not None and request_package(row), f'{key}: destination identity changed')
        require(all(not r.get('requestReleases') and not r.get('withdrawn') for r in (old, mid, row)), f'{key}: refusing to replace release history')
        require(row['packageSha256'] in (old['packageSha256'], mid['packageSha256']), f'{key}: unexpected third artifact')
        verify_row(baseline, old)
        verify_row(observed, mid)
        verify_row(target, row)
        # Do not substitute a registry label for a missing cached original.
        verify_row(target, old)
        if row['packageSha256'] == old['packageSha256']:
            continue
        row['manifest'] = {**old['manifest'], 'enabled': row['manifest'].get('enabled', True)}
        for field in ('packageSha256', 'packagePath', 'fileName'):
            row[field] = old[field]
        restored += 1
    if apply and restored:
        # Publish only after every row and underlying artifact has been verified.
        with tempfile.NamedTemporaryFile(mode='w', dir=target, prefix='.registry-', delete=False) as out:
            json.dump(list(dest.values()), out, ensure_ascii=False)
        os.replace(out.name, target / REG)
    return {'restored': restored}


def bind(baseline, target, db, apply):
    before, dest = registry(baseline), registry(target)
    known = {}
    ambiguous = set()
    for key, old in before.items():
        if not request_package(old) or old.get('withdrawn'):
            continue
        ids = verify_row(baseline, old)
        for provider in ids:
            if provider in known or old.get('requestReleases'):
                ambiguous.add(provider)
            known[provider] = old
    with db_at(baseline) as original:
        old_models = {r[0]: r for r in original.execute('SELECT ' + IDENTITY + ' FROM channel_models m WHERE m.deleted_at IS NULL')}
    query = ('SELECT ' + IDENTITY + ',m.protocol_release,m.enabled,c.enabled FROM channel_models m JOIN model_channels c ON m.channel_id=c.id '
             'WHERE m.deleted_at IS NULL AND c.deleted_at IS NULL AND m.protocol IS NOT NULL AND m.protocol <> \'\'')
    plan = []
    summary = {'bind': 0, 'enabled': 0, 'active': 0, 'unchanged': 0, 'verified_bound': 0, 'other_bound': 0, 'no_original_evidence': 0, 'changed_sku': 0}
    verified = set()
    for *identity, pinned, enabled, channel_enabled in db.execute(query):
        sku, _, provider, *_ = identity
        old = known.get(provider)
        if not old or provider in ambiguous:
            summary['no_original_evidence'] += 1
            continue
        if tuple(identity) != old_models.get(sku):
            summary['changed_sku'] += 1
            continue
        key, digest = old['id'], old['packageSha256']
        if pinned and pinned != digest:
            summary['other_bound'] += 1
            continue
        current = dest.get(key)
        require(current is not None and request_package(current) and not current.get('withdrawn'), f'{key}: candidate request plugin missing')
        if current['packageSha256'] == digest and not current.get('requestReleases'):
            summary['unchanged'] += 1
            continue
        releases = [(current['manifest']['version'], current['packageSha256'])] + [(r['version'], r['sha256']) for r in current.get('requestReleases', [])]
        require(releases.count((old['manifest']['version'], digest)) == 1, f'{key}: original release missing or ambiguous after bootstrap')
        if key not in verified:
            verify_row(target, current)
            verify_row(target, old)
            verified.add(key)
        if pinned:
            summary['verified_bound'] += 1
            continue
        plan.append((digest, sku))
        summary['bind'] += 1
        summary['enabled'] += bool(enabled)
        summary['active'] += bool(enabled and channel_enabled)
    if apply:
        for digest, sku in plan:
            res = db.execute("UPDATE channel_models SET protocol_release=? WHERE id=? AND (protocol_release IS NULL OR protocol_release='')", (digest, sku))
            require(res.rowcount == 1, 'SKU changed while offline')
    return summary


def run(action, baseline, observed, target, apply=False):
    baseline, observed, target = (Path(p).resolve(strict=True) for p in (baseline, observed, target))
    for path in (DB, REG):
        require(not (target / path).is_symlink() and all(not (target / path).samefile(root / path) for root in (baseline, observed)), 'target must have independent files, not links to evidence')
    for root in (baseline, observed):
        with db_at(root) as src:
            require(src.execute('SELECT MAX(version) FROM schema_migrations').fetchone()[0] == 112, '112 evidence snapshot required')
    with db_at(target, write=apply and action == 'bind') as db:
        if action == 'bind' and apply:
            db.execute('BEGIN IMMEDIATE')
        version = db.execute('SELECT MAX(version) FROM schema_migrations').fetchone()[0]
        if action == 'prepare':
            require(version == 112, 'prepare requires pre-upgrade clone (112)')
            return prepare(baseline, observed, target, apply)
        require(version in (117, 118) and db.execute('SELECT MAX(version) FROM yingce_schema_migrations').fetchone()[0] == 4, 'bind requires a verified 117/4 or 118/4 clone')
        return bind(baseline, target, db, apply)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['prepare', 'bind'])
    for name in ('baseline', 'observed', 'target'):
        parser.add_argument('--' + name, required=True)
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    print(json.dumps(run(args.action, args.baseline, args.observed, args.target, args.apply), sort_keys=True))
