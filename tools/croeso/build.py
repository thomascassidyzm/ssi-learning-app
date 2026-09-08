#!/usr/bin/env python3
"""Build the Canolfan welcome pack: page.tpl.html + shots/*.jpg -> one file.

    python3 tools/croeso/build.py

The output is packages/player-vue/public/croeso/index.html, served at
/croeso by the two rewrites in vercel.json. Every picture is inlined as a
data: URI ON PURPOSE — the pack is read on a phone, often on a weak signal,
by somebody who has never installed a web app. One file that carries its own
images cannot half-load, cannot lose a picture to a dropped request, and
prints whole. There is no build step in the deploy: this script is run by
hand when the copy or the screenshots change, and its output is committed.

To re-shoot the pictures after the app changes, see capture.mjs in this
directory.
"""
import base64, datetime, os, re, sys
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
DST = os.path.join(ROOT, 'packages', 'player-vue', 'public', 'croeso', 'index.html')

# Welsh alt text: a screen reader on this page is reading Welsh.
ALT = {
 'link': 'Sgrin gyntaf y ddolen gofrestru, gyda botwm Get started',
 'email': 'Y blwch cyfeiriad e-bost a botwm Send my code',
 'code': 'Y blwch ar gyfer y cod chwe digid',
 'ticks': 'Y ddau flwch ticio a botwm Claim my free year',
 'done': 'Y sgrin gadarnhau, gyda dyddiad diwedd y flwyddyn am ddim',
 'search': 'Y rhestr cyrsiau gyda Welsh wedi ei deipio yn y blwch chwilio',
 'variants': 'Y rhes Welsh wedi ei hagor, yn dangos Northern a Southern',
 'ready': 'Sgrin y chwaraewr cyn dechrau, gyda botwm coch mawr',
 'speak': 'Sgrin y chwaraewr yn ystod y bwlch, gyda YOU ARE MEANT TO BE SPEAKING NOW',
 'answer': 'Sgrin y chwaraewr yn dangos yr ateb Cymraeg dw i isio',
 'ios1': 'Cam un ar iPhone: y botwm rhannu',
 'ios2': 'Cam dau ar iPhone: Add to Home Screen',
 'ios3': 'Cam tri ar iPhone: y botwm Add',
 'ios4': 'Cam pedwar ar iPhone: wedi gorffen',
 'android': 'Y tri thap ar Android',
 'settings': 'Sgrin Gosodiadau gyda botwm Sign in ac Interface Language',
 'signin': 'Y sgrin fewngofnodi gyda blwch e-bost',
 'uilang': 'Y rhestr ieithoedd rhyngwyneb, gyda Cymraeg ynddi',
 'welshui': 'Sgrin y chwaraewr gyda rhyngwyneb Cymraeg',
}


def img_tag(name: str) -> str:
    path = os.path.join(HERE, 'shots', name + '.jpg')
    with open(path, 'rb') as fh:
        data = base64.b64encode(fh.read()).decode()
    w, h = Image.open(path).size
    # width/height are stated so the page does not reflow as pictures decode,
    # and nothing is lazy: a lazy image can be missing from a printout.
    return (f'<img src="data:image/jpeg;base64,{data}" width="{w}" height="{h}" '
            f'alt="{ALT[name]}">')


def _stamp() -> str:
    """The date of the newest thing that goes into the page."""
    newest = max(os.path.getmtime(os.path.join(HERE, 'page.tpl.html')),
                 *(os.path.getmtime(os.path.join(HERE, 'shots', n + '.jpg')) for n in ALT))
    return datetime.date.fromtimestamp(newest).strftime('%d.%m.%Y')


def main() -> int:
    with open(os.path.join(HERE, 'page.tpl.html'), encoding='utf-8') as fh:
        tpl = fh.read()
    used = set(re.findall(r'\{\{img:([a-z0-9]+)\}\}', tpl))
    unknown = used - set(ALT)
    if unknown:
        print('no alt text for:', sorted(unknown), file=sys.stderr)
        return 1
    unused = set(ALT) - used
    if unused:
        print('warning: shot never placed on the page:', sorted(unused), file=sys.stderr)
    out = re.sub(r'\{\{img:([a-z0-9]+)\}\}', lambda m: img_tag(m.group(1)), tpl)
    # A build stamp so the Canolfan can tell two copies apart. This is the one
    # thing a stale PowerPoint could never tell you about itself.
    out = out.replace('{{buildstamp}}', _stamp())
    os.makedirs(os.path.dirname(DST), exist_ok=True)
    with open(DST, 'w', encoding='utf-8') as fh:
        fh.write(out)
    print(f'{DST} — {len(used)} pictures, {os.path.getsize(DST) // 1024} KB')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
