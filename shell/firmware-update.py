#!/usr/bin/env python3
"""Generate matching embedded build identity and immutable GitHub update metadata."""
import gzip
import hashlib
import json
import os
from pathlib import Path
import re
import sys
from datetime import datetime, timezone


def build_info():
    repository = os.environ.get("UPDATE_REPOSITORY", "varcli/openwrt-autobuild")
    version = os.environ.get("BUILD_ID", "")
    if not re.fullmatch(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+", repository):
        raise ValueError("Invalid UPDATE_REPOSITORY")
    if not re.fullmatch(r"[1-9][0-9]{0,11}\.[0-9]{1,6}", version):
        raise ValueError("BUILD_ID must be run_id.run_attempt; build through the x86 workflow")
    docker = os.environ.get("INCLUDE_DOCKER", "no")
    if docker not in ("yes", "no"):
        raise ValueError("Invalid INCLUDE_DOCKER")
    size = int(os.environ.get("ROOTFS_PARTSIZE", "1024"))
    if size <= 0:
        raise ValueError("Invalid ROOTFS_PARTSIZE")
    return {
        "schema": 1, "target": "x86/64", "profile": "generic",
        "filesystem": "squashfs", "boot": "efi", "version": version,
        "commit": os.environ.get("BUILD_COMMIT", ""),
        "repository": repository,
        "include_docker": docker == "yes", "rootfs_partsize": size,
    }


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def manifest(directory):
    info = build_info()
    candidates = list(directory.glob("immortalwrt-*-x86-64-generic-squashfs-combined-efi.img.gz"))
    if len(candidates) != 1:
        raise ValueError("Exactly one x86 squashfs EFI image is required")
    image = candidates[0]
    tag = os.environ["RELEASE_TAG"]
    if not re.fullmatch(r"x86-64-[A-Za-z0-9._-]+", tag):
        raise ValueError("Invalid RELEASE_TAG")
    digest = hashlib.sha256()
    with image.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    image_size = 0
    with gzip.open(image, "rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            image_size += len(chunk)
    if image_size <= 0:
        raise ValueError("Empty firmware image")
    info.update({
        "release_tag": tag,
        "published_at": datetime.now(timezone.utc).isoformat(),
        "release_url": f"https://github.com/{info['repository']}/releases/tag/{tag}",
        "asset": {
            "name": image.name, "size": image.stat().st_size, "image_size": image_size,
            "sha256": digest.hexdigest(),
            "url": f"https://github.com/{info['repository']}/releases/download/{tag}/{image.name}",
        },
    })
    write_json(directory / "x86-64-update.json", info)
    (directory / "sha256sums").write_text(f"{digest.hexdigest()}  {image.name}\n", encoding="ascii")


if __name__ == "__main__":
    try:
        action, destination = sys.argv[1:]
        if action == "build":
            write_json(Path(destination), build_info())
        elif action == "manifest":
            manifest(Path(destination))
        else:
            raise ValueError("Expected build or manifest")
    except (ValueError, KeyError, OSError) as error:
        sys.exit(f"Update metadata error: {error}")
