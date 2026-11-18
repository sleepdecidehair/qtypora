#!/usr/bin/env python3
"""Reject known injected loaders in working files or immutable Git trees."""
import argparse
import base64
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import sys
from functools import lru_cache
from urllib.parse import unquote


GIT = '/usr/bin/git' if Path('/usr/bin/git').is_file() else 'git'
KNOWN = tuple(b'5-' + n + b'-du' for n in (b'790', b'2063', b'2076'))
ASSIGNMENT = re.compile(rb"""\bglobal\s*\.\s*o\s*=\s*['"][0-9]{1,8}-[0-9]{1,10}-du['"]""")
OBFUSCATOR = (b'__jso_' + b'nested_loop', b'_$jso' + b'Pow', b'_$jso' + b'Iter')
BASE64 = re.compile(rb"""['"]([A-Za-z0-9+/]{2048,262144}={0,2})['"]""")
BLOCK = 1024 * 1024
OVERLAP = 270 * 1024

# Sources: Microsoft Security Research, Datadog Security Labs, and Wiz.
CHAINDROP_SHA256 = frozenset({
    '54dc7ea54a1317cca0e890a2770630cf7fa6c97813e0cb9d2caa93012b350668',
    'fd3ca4007b225fdf8de7af4345a19179d5efa8c4bb9205f88cda806e5684b1eb',
    '9fc2570b7cef51c1b8df116d144d11ff4096357be7d2c4c6367cfc2509cf1bcc',
    '927387d0cfac1118df4b383decc2ea6ba49c9d2f98b47098bcbcba1efc026e1f',
    '14eb4ce01dd4307759887ff819359b70d7d9ff709ecde039a5abc1aac325b128',
    '3f3f42d072bd36860ab7bd7fb5e10ac0d22c741c13c89505ccd6ec0ea572eea7',
    '29ac906c8bd801dfe1cb39596197df49f80fff2270b3e7fbab52278c24e4f1a7',
    '619c56acf572df75b6004a6fc013c80900316a76099b241d64312da3a44f10b4',
})
CHAINDROP_SHA1 = frozenset({
    '35a672cf34b996b91f3e1c28cbf3a05a37e036e4',
    '686aa40d0fc22c8d569494543a0f891f359f2f99',
    'f525d52ceb966516686b482d3dc0137028cc6a63',
})
LOCK_LIMIT = 64 * 1024 * 1024
SEMVER = rb'[0-9]+\.[0-9]+\.[0-9]+(?:[-+][0-9A-Za-z.+-]+)?'
NPM_NAME = rb'(?:@[a-z0-9_.-]+/)?[a-z0-9_.-]+'
SPEC = re.compile(rb'(?<![a-z0-9@_./-])/?('+NPM_NAME+rb')@(?:npm:)?('+SEMVER+rb')(?![0-9A-Za-z.+-])')
PNPM_LEGACY = re.compile(rb"(?m)^  [\x27\x22]?/(" + NPM_NAME + rb")/(" + SEMVER + rb")[(:\x27\x22]")
YARN_ENTRY = re.compile(rb'(?m)^([^\s#][^\r\n]+):\r?\n[ \t]*version:?\s+["\x27]?('+SEMVER+rb')')
TARBALL = re.compile(rb'/('+NPM_NAME+rb')/-/[^/"\s]+-('+SEMVER+rb')\.tgz')
IDE_LOADER = re.compile(rb'\.(?:claude|vscode)[/\\]+setup\.mjs', re.I)


@lru_cache(maxsize=1)
def affected_versions():
    data = Path(__file__).with_name('chaindrop-versions.tsv').read_text(encoding='utf-8')
    pairs = set()
    for row in data.splitlines():
        if row and not row.startswith('#'):
            name, version = row.split('\t')
            if not re.fullmatch(NPM_NAME, name.encode()) or not re.fullmatch(SEMVER, version.encode()):
                raise ValueError('invalid ChainDrop version list entry')
            pairs.add((name, version))
    if not pairs:
        raise ValueError('empty ChainDrop version list')
    return pairs


def context(path):
    path = path.lower().replace('\\', '/')
    name = path.rsplit('/', 1)[-1]
    if name in {'package-lock.json', '.package-lock.json', 'npm-shrinkwrap.json'}:
        return 'npm'
    if name in {'pnpm-lock.yaml', 'pnpm-lock.yml', 'lock.yaml'}:
        return 'pnpm'
    if name in {'yarn.lock', 'bun.lock', 'bun.lockb', 'deno.lock'}:
        return name
    if name == 'package.json':
        return 'manifest'
    if any(part in {'.claude', '.vscode'} for part in path.split('/')):
        return 'ide'
    if name.endswith(('.tgz', '.tar.gz')):
        return 'tarball'
    return ''


def dependency_pairs(data, kind):
    if kind in {'npm', 'manifest'}:
        manifest = json.loads(data)
        if kind == 'manifest':
            yield manifest.get('name'), manifest.get('version')
            for field in ('dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'):
                for name, value in manifest.get(field, {}).items():
                    yield name, value
                    if isinstance(value, str) and value.startswith('npm:'):
                        for package, version in SPEC.findall(value[4:].encode()):
                            yield package.decode(), version.decode()
        for path, entry in manifest.get('packages', {}).items():
            yield entry.get('name') or path.rsplit('node_modules/', 1)[-1], entry.get('version')
        todo = [manifest.get('dependencies', {})] if kind == 'npm' else []
        while todo:
            for name, entry in todo.pop().items():
                yield name, entry.get('version')
                todo.append(entry.get('dependencies', {}))
    elif kind == 'yarn.lock':
        for selectors, version in YARN_ENTRY.findall(data):
            for selector in selectors.split(b','):
                yield selector.strip(b' \t"\x27').rsplit(b'@', 1)[0].decode(errors='replace'), version.decode()
    if kind != 'manifest':
        decoded = unquote(data.decode(errors='replace')).encode()
        for name, version in TARBALL.findall(decoded):
            yield name.decode(), version.decode()
    if kind not in {'npm', 'manifest'}:
        for name, version in SPEC.findall(data):
            yield name.decode(), version.decode()
    if kind == 'pnpm':
        for name, version in PNPM_LEGACY.findall(data):
            yield name.decode(), version.decode()


def inspect_context(data, kind):
    if kind == 'ide':
        normalized = data.lower().replace(b'\\\\', b'\\')
        if IDE_LOADER.search(normalized) and (
                b'sessionstart' in normalized or b'folderopen' in normalized or b'node ' in normalized):
            return 'ChainDrop IDE hook launches the injected setup script'
        if any(word in normalized for word in (b'thebeautiful' + b'marchoftime',
                                                b'tmp.dpkg_' + b'14527.lock')):
            return 'ChainDrop IDE loader indicator'
        return None
    packages = affected_versions()
    for name, version in dependency_pairs(data, kind):
        if isinstance(name, str) and isinstance(version, str) and (name, version) in packages:
            return f'ChainDrop compromised dependency {name}@{version}'
    if kind == 'bun.lockb':
        return 'binary Bun lock cannot be verified; use a text bun.lock'
    if kind == 'manifest' and b'@opensearch/' + b'setup' in data and b'd446803f4c3bc116263faa3499a1d3f95b2825de' in data:
        return 'ChainDrop injected OpenSearch optional dependency'
    return None


def signature(data):
    if any(marker in data for marker in KNOWN) or ASSIGNMENT.search(data):
        return 'known loader marker'
    if all(marker in data for marker in OBFUSCATOR):
        return 'known loader obfuscation'
    if (b'  ' * 256 in data and b'eth_' + b'getBlockByNumber' in data
            and re.search(rb'\beval\s*\(', data)):
        return 'hidden RPC loader'
    return None


def inspect(data):
    hit = signature(data)
    if hit:
        return hit
    for match in BASE64.finditer(data):
        try:
            decoded = base64.b64decode(match[1], validate=True)
        except ValueError:
            continue
        if hit := signature(decoded):
            return 'Base64 ' + hit
    return None


def scan_stream(stream, size, kind=''):
    overlap = b''
    hit = None
    sha256 = hashlib.sha256()
    sha1 = hashlib.sha1(usedforsecurity=False)
    sha512 = hashlib.sha512() if kind == 'tarball' else None
    capture = kind in {'npm', 'pnpm', 'yarn.lock', 'bun.lock', 'bun.lockb', 'deno.lock', 'manifest', 'ide'}
    oversized = capture and size > LOCK_LIMIT
    collected = bytearray() if capture and not oversized else None
    while size:
        block = stream.read(min(BLOCK, size))
        if not block:
            raise OSError('unexpected end of input')
        size -= len(block)
        sha256.update(block)
        sha1.update(block)
        if sha512 is not None:
            sha512.update(block)
        if collected is not None:
            collected.extend(block)
        if hit is None:
            part = overlap + block
            hit = inspect(part)
            overlap = part[-OVERLAP:]
    if sha256.hexdigest() in CHAINDROP_SHA256 or sha1.hexdigest() in CHAINDROP_SHA1:
        return 'ChainDrop known payload hash'
    if sha512 is not None and base64.b64encode(sha512.digest()) == (
            b'N/n4R+nD5SC0fYOpAp4ZnbwwxqGVodgEZ9D7Gm/VBocorU0aQimVyleDWSY6/axdO0/temub760n3hnMppZpUg=='):
        return 'ChainDrop known infected npm tarball hash'
    if oversized:
        return 'dependency or IDE metadata exceeds scan size limit'
    if hit is None and collected is not None:
        hit = inspect_context(bytes(collected), kind)
    return hit


def git(*args):
    return subprocess.check_output([GIT, *args])


def report(name, reason):
    if reason:
        print(f'code-security: {name!r}: {reason}', file=sys.stderr)
    return bool(reason)


def scan_trees(trees):
    seen = {}
    findings = set()
    with subprocess.Popen([GIT, 'cat-file', '--batch'], stdin=subprocess.PIPE,
                          stdout=subprocess.PIPE) as batch:
        try:
            for tree in trees:
                commit = git('rev-parse', '--verify', '--end-of-options', tree + '^{tree}').strip()
                for entry in git('ls-tree', '-rz', commit.decode()).split(b'\0'):
                    if not entry:
                        continue
                    meta, path = entry.split(b'\t', 1)
                    _, kind, blob = meta.split()
                    if kind != b'blob':
                        continue
                    key = blob, context(os.fsdecode(path))
                    if key not in seen:
                        batch.stdin.write(blob + b'\n')
                        batch.stdin.flush()
                        header = batch.stdout.readline().split()
                        if len(header) != 3 or header[1] != b'blob':
                            raise OSError('cannot read Git blob ' + blob.decode())
                        seen[key] = scan_stream(batch.stdout, int(header[2]), key[1])
                        if batch.stdout.read(1) != b'\n':
                            raise OSError('invalid Git blob framing')
                    hit = seen[key]
                    if hit and (path, blob) not in findings:
                        report(os.fsdecode(path), hit)
                        findings.add((path, blob))
        finally:
            batch.stdin.close()
    return bool(findings)


def scan_worktree():
    root = Path(os.fsdecode(git('rev-parse', '--show-toplevel').rstrip(b'\n'))).resolve()
    paths = git('-C', str(root), 'ls-files', '-z', '--cached', '--others', '--exclude-standard')
    flagged = False
    for name in dict.fromkeys(paths.split(b'\0')):
        if not name:
            continue
        relative = os.fsdecode(name)
        path = root / relative
        if not path.parent.resolve().is_relative_to(root):
            raise OSError(f'path escapes working tree: {relative!r}')
        try:
            metadata = path.lstat()
        except FileNotFoundError:
            continue
        if stat.S_ISLNK(metadata.st_mode):
            hit = inspect(os.fsencode(os.readlink(path)))
        elif stat.S_ISREG(metadata.st_mode):
            with path.open('rb') as stream:
                hit = scan_stream(stream, os.fstat(stream.fileno()).st_size, context(relative))
        else:
            continue
        flagged |= report(relative, hit)
    return flagged


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--tree', nargs='+', metavar='REV', help='scan exact committed Git trees')
    args = parser.parse_args()
    try:
        affected_versions()
        blocked = scan_trees(args.tree) if args.tree else scan_worktree()
    except (OSError, ValueError, TypeError, AttributeError, subprocess.CalledProcessError) as error:
        print(f'code-security: scan failed: {error}', file=sys.stderr)
        return 2
    if blocked:
        return 1
    print('code-security: signature check passed')
    return 0


if __name__ == '__main__':
    sys.exit(main())
