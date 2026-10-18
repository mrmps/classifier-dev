"""Fetch the immutable serving recipe and its hash-verified parent weights."""
import argparse
import hashlib
import json
import subprocess
import sys
import tempfile
import zipfile
from pathlib import Path
from urllib.request import urlopen

HERE = Path(__file__).resolve().parent

def sha(path):
    digest = hashlib.sha256()
    with path.open('rb') as source:
        for block in iter(lambda: source.read(8 << 20), b''):
            digest.update(block)
    return digest.hexdigest()

def verify_recipe(recipe):
    lock = json.loads((HERE / 'recipe.lock.json').read_text())
    if sha(recipe / 'artifact-manifest.json') != lock['manifest_sha256']:
        raise ValueError('Recipe manifest pin mismatch')
    manifest = json.loads((recipe / 'artifact-manifest.json').read_text())
    for name, digest in manifest['files'].items():
        path = (recipe / name).resolve()
        if not path.is_relative_to(recipe) or sha(path) != digest:
            raise ValueError(f'Recipe hash mismatch: {name}')

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--recipe', type=Path, default=HERE / 'recipe')
    parser.add_argument('--checkpoint', type=Path, default=HERE / 'model')
    parser.add_argument('--recipe-only', action='store_true')
    args = parser.parse_args()
    lock = json.loads((HERE / 'recipe.lock.json').read_text())
    if not args.recipe.exists():
        url = f'https://huggingface.co/{lock["repository"]}/resolve/{lock["revision"]}/{lock["filename"]}'
        args.recipe.parent.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(dir=args.recipe.parent) as directory:
            archive = Path(directory) / 'recipe.zip'
            with urlopen(url, timeout=120) as source, archive.open('wb') as target:
                while block := source.read(8 << 20):
                    target.write(block)
            if sha(archive) != lock['sha256']:
                raise ValueError('Serving archive hash mismatch')
            with zipfile.ZipFile(archive) as bundle:
                if any(Path(n).is_absolute() or '..' in Path(n).parts for n in bundle.namelist()):
                    raise ValueError('Unsafe archive path')
                bundle.extractall(directory)
            (Path(directory) / 'serving').rename(args.recipe)
    verify_recipe(args.recipe.resolve())
    pins = json.loads((args.recipe / 'native/pins.json').read_text())
    if (pins['model'], pins['revision']) != (lock['model'], lock['model_revision']):
        raise ValueError('Parent model pin mismatch')
    files = json.loads((args.recipe / 'native/model-files.json').read_text())
    weights_ready = all((args.checkpoint / n).is_file() and
                        (args.checkpoint / n).stat().st_size == info['bytes'] and
                        sha(args.checkpoint / n) == info['sha256'] for n, info in files.items())
    if not args.recipe_only and not weights_ready:
        subprocess.run([sys.executable, str(args.recipe / 'native/fetch.py'), '--out', str(args.checkpoint)], check=True)
    print(json.dumps({'verified': True, 'recipe_revision': lock['revision'], 'model_revision': lock['model_revision']}))
