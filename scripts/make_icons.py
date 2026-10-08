# The app's icons, from the team logo.
#
#   python3 scripts/make_icons.py icons/rohawks-logo.png static/icons
#
# The source is the 2200px original from rohawks.org, kept outside static/ so it
# is neither shipped nor precached. Needs Pillow.

import sys
from PIL import Image, ImageDraw

src, out = sys.argv[1], sys.argv[2]
logo = Image.open(src).convert('RGBA')
logo = logo.crop(logo.getchannel('A').getbbox())
WHITE = (255, 255, 255, 255)


def fit(size, box):
    """The logo scaled to fit a box x box square, centred on a transparent size x size canvas."""
    w, h = logo.size
    k = box / max(w, h)
    scaled = logo.resize((round(w * k), round(h * k)), Image.LANCZOS)
    canvas = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    canvas.alpha_composite(scaled, ((size - scaled.width) // 2, (size - scaled.height) // 2))
    return canvas


def square(size, box):
    """Opaque: iOS fills transparency with black, which would swallow the gear."""
    bg = Image.new('RGBA', (size, size), WHITE)
    bg.alpha_composite(fit(size, box))
    return bg.convert('RGB')


def badge(size, box):
    """The logo on a white disc, for the purple header and for browser tabs of either theme."""
    scale = 4
    big = size * scale
    disc = Image.new('RGBA', (big, big), (0, 0, 0, 0))
    ImageDraw.Draw(disc).ellipse((0, 0, big - 1, big - 1), fill=WHITE)
    disc.alpha_composite(fit(big, box * scale))
    return disc.resize((size, size), Image.LANCZOS)


square(512, 460).save(f'{out}/icon-512.png', optimize=True)
square(192, 172).save(f'{out}/icon-192.png', optimize=True)
square(180, 156).save(f'{out}/apple-touch-icon.png', optimize=True)
# Maskable: Android may crop to a circle of 80% of the width, so the logo has
# to sit inside it. 330 of 512 was checked against that circle drawn on.
square(512, 330).save(f'{out}/icon-maskable.png', optimize=True)
badge(96, 74).save(f'{out}/team-logo.png', optimize=True)
badge(48, 38).save(f'{out}/favicon.png', optimize=True)
