#!/usr/bin/env python3
"""Decrypts + unpacks Unity asset bundles from a downloaded dat/ cache into PNGs.

PIPE-2. Takes bundles already present in dat/<hash[0:2]>/<hash> (either downloaded via
download-game-assets.mjs, or copied directly from a game client install alongside
meta_jp/master_jp.mdb -- both layouts use the same dat/<hash[0:2]>/<hash> convention).

Two independent pieces glued together here:

1. Per-asset AB decryption -- reimplemented from understanding, not copied. The algorithm
   (an 11-byte base key XORed against a little-endian-encoded 8-byte per-asset key, expanded
   to an 88-byte keystream, applied cyclically to file bytes from offset 256 onward) and the
   base key itself were confirmed via two independent sources (PIPE-2's own research into
   MarshmallowAndroid/UmamusumeExplorer, and this fork's derivation of daydreamer-json/
   uma-db-stuff's published key constants -- see decrypt-meta-db.mjs's header comment for the
   equivalent story on the meta-DB key). daydreamer-json/uma-db-stuff is AGPL-3.0; nothing
   from its source is copied here, only the extracted numeric constant and the algorithm
   description, independently reimplemented.

2. Texture/Sprite extraction via UnityPy -- adapted from rockisch/umamusu-utils'
   umamusu/assets/dump.py (`texture_dump`), MIT licensed. That project has no decryption of
   its own (see docs/data-pipeline.md); this keeps its extraction logic, wired up to the
   decrypted bytes from step 1 instead of a plain on-disk file.
   Original: https://github.com/rockisch/umamusu-utils/blob/main/umamusu/assets/dump.py

Requires: UnityPy, Pillow (see scripts/requirements.txt) -- install into a venv:
  python3 -m venv scripts/.venv && scripts/.venv/bin/pip install -r scripts/requirements.txt

Usage:
  scripts/.venv/bin/python scripts/extract-assets.py --dat dat --hash <HASH> --key <E> --out icons/tmp
  scripts/.venv/bin/python scripts/extract-assets.py --dat dat --hash <HASH> --out icons/tmp  # e=0, unencrypted
"""

import argparse
import io
from pathlib import Path

import UnityPy
from PIL import Image

# daydreamer-json/uma-db-stuff's src/utils/config.ts: cipher.assetBundle.baseKey.
# An extracted client constant, not their expression -- see module docstring.
AB_BASE_KEY = bytes.fromhex("532b4631e4a7b9473e7cfb")


def decrypt_ab_buffer(data: bytes, encryption_key: int) -> bytes:
    """Reverses the per-asset XOR-past-offset-256 cipher. `encryption_key` is the meta DB's
    signed 64-bit `e` column value for this asset; 0 means the bundle isn't encrypted."""
    if encryption_key == 0 or len(data) <= 256:
        return data
    key_bytes = (encryption_key & 0xFFFFFFFFFFFFFFFF).to_bytes(8, "little")
    keystream = bytearray(len(AB_BASE_KEY) * 8)
    for i, b in enumerate(AB_BASE_KEY):
        for j in range(8):
            keystream[i * 8 + j] = b ^ key_bytes[j]
    out = bytearray(data)
    for i in range(256, len(out)):
        out[i] ^= keystream[i % len(keystream)]
    return bytes(out)


def extract_textures(data: bytes, out_dir: Path, base_name: str) -> list[Path]:
    """Adapted from rockisch/umamusu-utils' texture_dump (MIT) -- Sprite-atlas cropping and
    the PIL/Unity Y-axis flip are theirs; wired up here to in-memory bytes instead of a path
    on disk, and simplified to the single-bundle case this script needs (their version
    iterates a whole asset DB query's worth of bundles)."""
    out_dir.mkdir(parents=True, exist_ok=True)
    env = UnityPy.load(io.BytesIO(data))

    textures = []
    sprites = []
    for obj in env.objects:
        if obj.type.name == "Texture2D":
            textures.append(obj)
        elif obj.type.name == "Sprite":
            sprites.append(obj)

    written = []
    used_names = set()

    def dedupe(path):
        """Appends _2, _3, ... before the extension if `path` was already claimed earlier in
        this call -- two Texture2D/Sprite objects sharing a name (or both falling back to the
        same default) used to silently overwrite each other's output here (PIPE-2 review)."""
        if path.name not in used_names:
            used_names.add(path.name)
            return path
        i = 2
        while True:
            candidate = path.with_name(f"{path.stem}_{i}{path.suffix}")
            if candidate.name not in used_names:
                used_names.add(candidate.name)
                return candidate
            i += 1

    texture_images = []
    for tex_obj in textures:
        data_obj = tex_obj.read()
        try:
            image = data_obj.image
        except Exception as e:
            print(f"  failed to decode texture in {base_name}: {e}")
            continue
        texture_images.append((image, data_obj.m_Name or base_name))

    if sprites:
        if len(texture_images) != 1:
            print(f"  note: {base_name} has {len(texture_images)} textures for {len(sprites)} sprites (expected 1)")
        if texture_images:
            image, _ = texture_images[0]
            atlas_path = dedupe(out_dir / f"{base_name}.png")
            image.save(atlas_path)
            written.append(atlas_path)
            for i, sprite_obj in enumerate(sprites):
                sprite = sprite_obj.read()
                rect = sprite.m_Rect
                x, y, h, w = rect.x, rect.y, rect.height, rect.width
                # PIL and Unity treat height as starting from opposite sides.
                sprite_img = image.crop((x, image.height - y - h, x + w, image.height - y))
                sprite_name = sprite.m_Name or f"{i}_{base_name}"
                sprite_path = dedupe(out_dir / f"{sprite_name}.png")
                sprite_img.save(sprite_path)
                written.append(sprite_path)
    else:
        for image, image_name in texture_images:
            path = dedupe(out_dir / f"{image_name}.png")
            image.save(path)
            written.append(path)

    return written


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--dat", required=True, help="dat/ cache directory")
    parser.add_argument("--hash", required=True, help="asset hash (meta DB's h column)")
    parser.add_argument("--key", type=int, default=0, help="meta DB's e column (signed 64-bit); 0 if unencrypted")
    parser.add_argument("--out", required=True, help="output directory for extracted PNGs")
    parser.add_argument("--name", default=None, help="base name for output files (default: the hash)")
    args = parser.parse_args()

    blob_path = Path(args.dat) / args.hash[:2] / args.hash
    if not blob_path.exists():
        raise SystemExit(f"blob not found: {blob_path}")

    raw = blob_path.read_bytes()
    decrypted = decrypt_ab_buffer(raw, args.key)

    written = extract_textures(decrypted, Path(args.out), args.name or args.hash)
    if not written:
        print("No textures/sprites found in this bundle.")
        raise SystemExit(1)
    for p in written:
        print(f"wrote {p}")


if __name__ == "__main__":
    main()
