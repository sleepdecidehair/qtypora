#!/usr/bin/env python3
"""Reject known injected loaders in working files or immutable Git trees."""
import argparse
import base64
import os
from pathlib import Path
import re
import stat
import subprocess
import sys


GIT = '/usr/bin/git' if Path('/usr/bin/git').is_file() else 'git'
KNOWN = tuple(b'5-' + n + b'-du' for n in (b'790', b'2063', b'2076'))
ASSIGNMENT = re.compile(rb"""\bglobal\s*\.\s*o\s*=\s*['"][0-9]{1,8}-[0-9]{1,10}-du['"]""")
OBFUSCATOR = (b'__jso_' + b'nested_loop', b'_$jso' + b'Pow', b'_$jso' + b'Iter')
BASE64 = re.compile(rb"""['"]([A-Za-z0-9+/]{2048,262144}={0,2})['"]""")
BLOCK = 1024 * 1024
OVERLAP = 270 * 1024


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


def scan_stream(stream, size):
    overlap = b''
    hit = None
    while size:
        block = stream.read(min(BLOCK, size))
        if not block:
            raise OSError('unexpected end of input')
        size -= len(block)
        if hit is None:
            part = overlap + block
            hit = inspect(part)
            overlap = part[-OVERLAP:]
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
                    if blob not in seen:
                        batch.stdin.write(blob + b'\n')
                        batch.stdin.flush()
                        header = batch.stdout.readline().split()
                        if len(header) != 3 or header[1] != b'blob':
                            raise OSError('cannot read Git blob ' + blob.decode())
                        seen[blob] = scan_stream(batch.stdout, int(header[2]))
                        if batch.stdout.read(1) != b'\n':
                            raise OSError('invalid Git blob framing')
                    hit = seen[blob]
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
                hit = scan_stream(stream, os.fstat(stream.fileno()).st_size)
        else:
            continue
        flagged |= report(relative, hit)
    return flagged


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--tree', nargs='+', metavar='REV', help='scan exact committed Git trees')
    args = parser.parse_args()
    try:
        blocked = scan_trees(args.tree) if args.tree else scan_worktree()
    except (OSError, ValueError, subprocess.CalledProcessError) as error:
        print(f'code-security: scan failed: {error}', file=sys.stderr)
        return 2
    if blocked:
        return 1
    print('code-security: signature check passed')
    return 0


if __name__ == '__main__':
    sys.exit(main())
