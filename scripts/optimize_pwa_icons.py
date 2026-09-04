from pathlib import Path
from PIL import Image

root = Path(__file__).resolve().parents[1]
for path in sorted((root / 'public').rglob('*')):
    if path.suffix.lower() not in {'.png', '.jpg', '.jpeg', '.webp'} or not path.is_file():
        continue
    original_size = path.stat().st_size
    if original_size < 2_000_000:
        continue
    image = Image.open(path).convert('RGBA')
    image.thumbnail((512, 512), Image.Resampling.LANCZOS)
    image.save(path, format='PNG', optimize=True, compress_level=9)
    print(path.relative_to(root), image.size, original_size, '->', path.stat().st_size)
