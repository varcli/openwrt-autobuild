#!/usr/bin/env python3
"""Validate Flippy N1 images against Amlogic's filename matching contract."""
import gzip
import hashlib
import os
from pathlib import Path
import re
import shutil
import sys


IMAGE_NAME = re.compile(
    r"^openwrt_s905d_n1_[A-Za-z0-9.+_-]+_k(?P<kernel>[0-9]+\.[0-9]+\.[0-9]+)"
    r"[A-Za-z0-9.+_-]*\.img\.gz$"
)


def prepare(source, destination, kernel_selection):
    expected = set()
    for kernel in kernel_selection.split("_"):
        match = re.fullmatch(r"([0-9]+\.[0-9]+)\.(?:y|[0-9]+)", kernel)
        if not match:
            raise ValueError(f"Invalid kernel selection: {kernel}")
        expected.add(match[1])
    if not source.is_dir():
        raise ValueError("Packaging output directory is missing")
    images = sorted(source.glob("*.img.gz"))
    if not images:
        raise ValueError("No .img.gz firmware images were produced")
    if destination.exists() and any(destination.iterdir()):
        raise ValueError("Release directory must be empty")

    branches, records = set(), []
    for image in images:
        match = IMAGE_NAME.fullmatch(image.name)
        if not match:
            raise ValueError(f"Not an Amlogic-compatible s905d/n1 image: {image.name}")
        branches.add(".".join(match["kernel"].split(".")[:2]))
        # Read the whole stream so truncated gzip data and CRC errors stop publication.
        image_size = 0
        with gzip.open(image, "rb") as stream:
            for chunk in iter(lambda: stream.read(1024 * 1024), b""):
                image_size += len(chunk)
        if image_size == 0:
            raise ValueError(f"Empty firmware image: {image.name}")
        digest = hashlib.sha256()
        with image.open("rb") as stream:
            for chunk in iter(lambda: stream.read(1024 * 1024), b""):
                digest.update(chunk)
        records.append((image, digest.hexdigest()))
    if branches != expected:
        raise ValueError(f"Kernel branches differ: requested={sorted(expected)}, produced={sorted(branches)}")

    destination.mkdir(parents=True, exist_ok=True)
    for image, _ in records:
        shutil.copy2(image, destination / image.name)
    (destination / "sha256sums").write_text(
        "".join(f"{digest}  {image.name}\n" for image, digest in records), encoding="ascii"
    )
    print(f"Prepared {len(records)} N1 images with Amlogic-compatible filenames and SHA256")


if __name__ == "__main__":
    try:
        source, destination = map(Path, sys.argv[1:])
        prepare(source, destination, os.environ["OPENWRT_KERNEL"])
    except (ValueError, KeyError, OSError, EOFError) as error:
        sys.exit(f"N1 release preparation failed: {error}")
