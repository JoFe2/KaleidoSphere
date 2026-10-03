#!/usr/bin/env python3
"""Deterministic build-time ZIP; no dependencies, credentials or network access."""
import io, pathlib, stat, sys, zipfile


def archive_bytes(base):
    stream = io.BytesIO()
    with zipfile.ZipFile(stream, 'w', compression=zipfile.ZIP_STORED) as archive:
        for file in sorted(base.rglob('*')):
            mode = file.lstat().st_mode
            if stat.S_ISLNK(mode):
                raise ValueError('symlinked ZIP input denied')
            if stat.S_ISDIR(mode):
                continue
            if not stat.S_ISREG(mode) or mode & 0o111:
                raise ValueError('non-regular or executable ZIP input denied')
            name = file.relative_to(base).as_posix()
            if '\\' in name or '..' in name.split('/') or name.startswith('/'):
                raise ValueError('unsafe ZIP path denied')
            info = zipfile.ZipInfo(name, (1980, 1, 1, 0, 0, 0))
            info.create_system = 3
            info.external_attr = 0o100644 << 16
            archive.writestr(info, file.read_bytes())
    return stream.getvalue()


if __name__ == '__main__':
    try:
        if len(sys.argv) != 4 or sys.argv[1] not in ('--create', '--verify'):
            raise ValueError('usage: --create|--verify <validated payload directory> <ZIP>')
        payload, target = map(pathlib.Path, sys.argv[2:])
        expected = archive_bytes(payload)
        if sys.argv[1] == '--create':
            with target.open('xb') as output:
                output.write(expected)
        else:
            if not stat.S_ISREG(target.lstat().st_mode):
                raise ValueError('non-regular ZIP target denied')
            if target.read_bytes() != expected:
                raise ValueError('ZIP byte drift denied')
    except (OSError, ValueError) as error:
        print(f'k4c-directory-zip: {error}', file=sys.stderr)
        sys.exit(1)
