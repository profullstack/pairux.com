#!/usr/bin/env python3
"""Verify an .rpm without libarchive or rpm2cpio.

Parses the lead, signature and main headers, then streams the payload through
the decompressor its header names (xz, zstd, gzip, bzip2, lzma) and checks the
cpio magic. Exits non-zero with a reason when anything is truncated or corrupt.

Why: ubuntu-26.04's bsdtar reports "Unrecognized archive format" on valid
xz/zstd rpms, and rpm2cpio on older images cannot read zstd payloads.
"""
import bz2
import gzip
import lzma
import shutil
import struct
import subprocess
import sys


def header(f, align):
    if align:
        pad = (-f.tell()) % 8
        f.read(pad)
    magic = f.read(8)
    if len(magic) < 8 or magic[:3] != b"\x8e\xad\xe8":
        raise ValueError("bad header magic")
    n, size = struct.unpack(">II", f.read(8))
    index = f.read(n * 16)
    store = f.read(size)
    if len(index) != n * 16 or len(store) != size:
        raise ValueError("truncated header")
    tags = {}
    for i in range(n):
        tag, typ, off, cnt = struct.unpack(">IIII", index[i * 16 : i * 16 + 16])
        if typ == 6:  # STRING
            end = store.index(b"\0", off)
            tags[tag] = store[off:end].decode("utf-8", "replace")
    return tags


def verify(path):
    with open(path, "rb") as f:
        lead = f.read(96)
        if len(lead) != 96 or lead[:4] != b"\xed\xab\xee\xdb":
            raise ValueError("not an rpm (bad lead)")
        header(f, align=False)  # signature
        main = header(f, align=True)
        comp = main.get(1125, "gzip")
        if comp == "zstd":
            if not shutil.which("zstd"):
                raise ValueError("zstd payload but no zstd binary")
            proc = subprocess.run(["zstd", "-dc"], stdin=f, capture_output=True)
            if proc.returncode != 0:
                raise ValueError("zstd: " + proc.stderr.decode(errors="replace").strip())
            payload_head = proc.stdout[:6]
        else:
            opener = {"xz": lzma.open, "lzma": lzma.open, "gzip": gzip.open, "bzip2": bz2.open}.get(comp)
            if opener is None:
                raise ValueError(f"unknown payload compressor {comp}")
            with opener(f) as d:
                payload_head = d.read(6)
                while d.read(1 << 20):
                    pass
        # 07070X: rpm >= 4.12 "stripped" cpio (what rpmbuild on newer images emits).
        if payload_head not in (b"070701", b"070702", b"07070X"):
            raise ValueError(f"payload is not cpio ({payload_head!r})")
    return comp


if __name__ == "__main__":
    bad = 0
    for p in sys.argv[1:]:
        try:
            print(f"OK {p} ({verify(p)} payload)")
        except Exception as e:  # noqa: BLE001
            print(f"CORRUPT {p}: {e}")
            bad = 1
    sys.exit(bad)
