#!/usr/bin/env python3
"""
Packs the NextVault WebExtension into a clean, AMO-compliant zip file
ready for direct upload to Mozilla Firefox Add-on Developer Hub.
"""
import os
import json
import zipfile

def pack_firefox_extension():
    repo_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    ext_src = os.path.join(repo_root, "apps", "extension", "src")
    manifest_path = os.path.join(ext_src, "manifest.firefox.json")

    with open(manifest_path, "r", encoding="utf-8") as f:
        manifest_data = json.load(f)
    version = manifest_data.get("version", "0.1.25")

    release_dir = os.path.join(repo_root, "release")
    os.makedirs(release_dir, exist_ok=True)

    versioned_zip = os.path.join(release_dir, f"nexvault-firefox-extension-v{version}.zip")
    root_zip = os.path.join(repo_root, "nexvault-firefox-extension.zip")

    files_to_pack = [
        (os.path.join(ext_src, "manifest.firefox.json"), "manifest.json"),
        (os.path.join(ext_src, "background.js"), "background.js"),
        (os.path.join(ext_src, "content.js"), "content.js"),
        (os.path.join(ext_src, "popup.html"), "popup.html"),
        (os.path.join(ext_src, "popup.js"), "popup.js"),
        (os.path.join(ext_src, "icon.png"), "icon.png"),
        (os.path.join(ext_src, "cyber", "cyber.css"), "cyber/cyber.css"),
        (os.path.join(ext_src, "cyber", "binary-shield.js"), "cyber/binary-shield.js"),
    ]

    for target in [versioned_zip, root_zip]:
        with zipfile.ZipFile(target, "w", zipfile.ZIP_DEFLATED) as z:
            for src_path, arc_name in files_to_pack:
                if not os.path.exists(src_path):
                    raise FileNotFoundError(f"Missing required file: {src_path}")
                z.write(src_path, arc_name)
        size_kb = round(os.path.getsize(target) / 1024, 2)
        print(f"Packaged: {os.path.relpath(target, repo_root)} ({size_kb} KB)")

if __name__ == "__main__":
    pack_firefox_extension()

