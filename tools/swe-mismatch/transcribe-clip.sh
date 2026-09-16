#!/bin/bash
set -u
OUT="$CS_SCRATCH/results.tsv"; D="$CS_SCRATCH/clips"; M="$HOME/.local/share/whisper-models/ggml-small.bin"
IFS=$'\t' read -r pid role text aid <<< "$1"
[ -z "${aid:-}" ] && exit 0
f="$D/$aid.mp3"; w="$D/$aid.$$.wav"
if [ ! -s "$f" ]; then
  curl -s -f -o "$f" "https://saysomethingin.app/api/audio/$aid?courseId=swe_for_eng" || { printf '%s\t%s\t%s\t%s\tDOWNLOAD_FAIL\t\n' "$pid" "$role" "$text" "$aid" >> "$OUT"; exit 0; }
fi
dur=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$f" 2>/dev/null)
ffmpeg -v error -y -i "$f" -ar 16000 -ac 1 "$w" 2>/dev/null || { printf '%s\t%s\t%s\t%s\tDECODE_FAIL\t%s\n' "$pid" "$role" "$text" "$aid" "$dur" >> "$OUT"; exit 0; }
tr=$(WHISPER_NO_SEMAPHORE=1 "$HOME/.local/bin/whisper-cli" -m "$M" -l sv -nt -np -t 2 -f "$w" 2>/dev/null | tr '\n' ' ' | sed 's/^ *//;s/ *$//')
printf '%s\t%s\t%s\t%s\t%s\t%s\n' "$pid" "$role" "$text" "$aid" "$tr" "$dur" >> "$OUT"
rm -f "$w"
