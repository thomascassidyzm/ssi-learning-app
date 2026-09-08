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

# Alt text is ENGLISH: the page is English-first now, so a screen reader
# working through it is reading English.
ALT = {
 'link': 'The registration link\u2019s first screen, with a Get started button',
 'email': 'The email address box and a Send my code button',
 'code': 'The box for the six-digit code',
 'ticks': 'The two tick boxes and a Claim my free year button',
 'done': 'The confirmation screen, showing the date the free year ends',
 'search': 'The course list with Welsh typed into the search box',
 'variants': 'The Welsh row opened, showing Northern and Southern',
 'ready': 'The player screen before starting, with a big red button',
 'speak': 'The player screen during the gap, reading YOU ARE MEANT TO BE SPEAKING NOW',
 'answer': 'The player screen showing the Welsh answer dw i isio',
 'ios1': 'Step one on an iPhone: the Share button',
 'ios2': 'Step two on an iPhone: Add to Home Screen',
 'ios3': 'Step three on an iPhone: the Add button',
 'ios4': 'Step four on an iPhone: done',
 'android': 'The three taps on Android',
 'settings': 'The Settings screen with a Sign in button and Interface Language',
 'signin': 'The sign-in screen with an example address, gwen at example dot com, typed in the box',
 'uilang': 'The interface language list, with Cymraeg in it',
 'welshui': 'The player screen with a Welsh interface',
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
