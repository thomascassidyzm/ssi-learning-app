# Welsh Course JSON to V12 Schema Mapping

**Source File:** `/Users/tomcassidy/Downloads/Welsh-north_for_English_speakers_20250604_162031 (5).json`
**Total Lines:** 472,825
**Analysis Date:** 2025-12-23

---

## 1. Complete JSON Structure Map

```
ROOT
├── id: "en-cy-north"                    # Course identifier
├── version: "1.0.0"                     # Course version
├── known: "en"                          # Source/known language
├── target: "cy"                         # Target language
├── introduction: {...}                  # Course welcome audio
│   ├── id: UUID                         # Audio sample UUID
│   ├── role: "presentation"
│   ├── cadence: "natural"
│   └── duration: 37.023182              # Duration in seconds
├── beltAssessor: {...}                  # Belt progression config (UI)
├── beltGenerationParams: {...}          # Belt boundary params
└── slices: [                            # Array (only 1 slice typically)
    └── {
        ├── id: UUID                     # Slice identifier
        ├── version: "1.0.0"
        ├── orderedEncouragements: [...]  # 44 ordered motivational texts
        ├── pooledEncouragements: [...]   # 26 random motivational texts
        ├── seeds: [...]                  # 305 seed sentences
        └── samples: {...}                # Audio samples dictionary
    }
]
```

---

## 2. Entity Counts

| Entity Type | Count | Description |
|-------------|-------|-------------|
| **Seeds** | 305 | Full sentences (learning goals) |
| **LEGOs** (introductionItems) | 635 | Learning units introduced |
| **Practice Phrases** (nodes within introductionItems) | 5,797 | Practice sentences |
| **Audio Sample Text Keys** | 13,966 | Unique text strings with audio |
| **Total Audio Samples** | 20,638 | Individual audio files |
| - source (English) | 6,590 | Known language audio |
| - target1 (Welsh voice 1) | 6,672 | Target language first voice |
| - target2 (Welsh voice 2) | 6,672 | Target language second voice |
| - presentation | 704 | Introduction/encouragement audio |
| **Ordered Encouragements** | 44 | Sequential motivational messages |
| **Pooled Encouragements** | 26 | Random motivational messages |

---

## 3. Entity Examples

### 3.1 Seed Example

**JSON Path:** `slices[0].seeds[0]`

```json
{
  "id": "6F227950-1A7E-4765-991B-612CA8913679",
  "seedSentence": {
    "canonical": "I want to speak Welsh."
  },
  "node": {
    "id": "6F227950-1A7E-4765-991B-612CA8913679",
    "known": {
      "text": "I want to speak Welsh",
      "tokens": ["I", "want", "to", "speak", "Welsh"],
      "lemmas": ["I", "want", "to", "speak", "Welsh"]
    },
    "target": {
      "text": "dw i isio siarad Cymraeg",
      "tokens": ["dw", "i", "isio", "siarad", "Cymraeg"],
      "lemmas": ["dw", "i", "isio", "siarad", "Cymraeg"]
    }
  },
  "introductionItems": [...]  // LEGOs for this seed
}
```

### 3.2 LEGO Example (introductionItem)

**JSON Path:** `slices[0].seeds[0].introductionItems[1]`

```json
{
  "id": "CFF016C8-E641-44F7-B145-68B194F2B018",
  "node": {
    "id": "CFF016C8-E641-44F7-B145-68B194F2B018",
    "known": {
      "text": "to speak",
      "tokens": ["to", "speak"],
      "lemmas": ["to", "speak"]
    },
    "target": {
      "text": "siarad",
      "tokens": ["siarad"],
      "lemmas": ["siarad"]
    }
  },
  "presentation": "The Welsh for <src>to speak</src> is <tgt>siarad</tgt>.  <tgt>Siarad</tgt>.",
  "nodes": [...]  // Practice phrases for this LEGO
}
```

### 3.3 Practice Phrase Example (node within introductionItem)

**JSON Path:** `slices[0].seeds[0].introductionItems[1].nodes[0]`

```json
{
  "id": "4F0313E2-5389-4C70-A60E-AD51741A8F54",
  "known": {
    "text": "I want to speak",
    "tokens": ["I", "want", "to", "speak"],
    "lemmas": ["I", "want", "to", "speak"]
  },
  "target": {
    "text": "dw i isio siarad",
    "tokens": ["dw", "i", "isio", "siarad"],
    "lemmas": ["dw", "i", "isio", "siarad"]
  }
}
```

### 3.4 Audio Sample Examples

**JSON Path:** `slices[0].samples`

```json
// Source (English) - single sample per text
"I want": [
  {
    "id": "9B007651-683A-4E7A-A2F1-85C327F1170C",
    "role": "source",
    "duration": 1.416,
    "cadence": "natural"
  }
],

// Target (Welsh) - two samples (two voices)
"dw i isio": [
  {
    "id": "AAC8714A-C3C1-4275-B78B-013578CD8104",
    "role": "target1",
    "duration": 2.232,
    "cadence": "natural"
  },
  {
    "id": "2EF6E231-034B-4C84-B9E2-A46FAF19D424",
    "role": "target2",
    "duration": 1.872,
    "cadence": "natural"
  }
],

// Presentation (introduction audio)
"The Welsh for <src>to want</src> is <tgt>isio</tgt>.  <tgt>Isio</tgt>. <src>I want</src> is <tgt>dw i isio</tgt>.  <tgt>Dw i isio</tgt>.": [
  {
    "id": "3C3E286E-4E01-4C00-83B4-CB4AB88754C9",
    "role": "presentation",
    "duration": 11.544,
    "cadence": "natural"
  }
]
```

### 3.5 Course Welcome (Introduction)

**JSON Path:** `introduction`

```json
{
  "id": "2E8A9A78-5FF9-4250-8733-372CE0E0CD1C",
  "role": "presentation",
  "cadence": "natural",
  "duration": 37.023182
}
```

---

## 4. V12 Schema Mapping

### 4.1 courses Table

| V12 Column | JSON Source | Notes |
|------------|-------------|-------|
| course_code | `id` | "en-cy-north" |
| known_lang | `known` | "en" |
| target_lang | `target` | "cy" |
| display_name | (generate) | "Welsh (North) for English speakers" |
| known_voice | (from config) | Voice ID for source audio |
| target_voice_1 | (from config) | Voice ID for target1 |
| target_voice_2 | (from config) | Voice ID for target2 |
| presentation_voice | (from config) | Voice ID for presentation |
| welcome_audio_uuid | `introduction.id` | UUID for welcome audio |
| welcome_audio_duration_ms | `introduction.duration * 1000` | Convert to ms |
| status | 'active' | |

### 4.2 course_seeds Table

| V12 Column | JSON Source | Notes |
|------------|-------------|-------|
| id | (generate new UUID) | Or use seed.id |
| course_code | root.id | "en-cy-north" |
| seed_number | (array index + 1) | 1-305 |
| known_text | `seeds[i].node.known.text` | |
| target_text | `seeds[i].node.target.text` | |
| status | 'active' | |

### 4.3 course_legos Table

| V12 Column | JSON Source | Notes |
|------------|-------------|-------|
| id | (generate new UUID) | |
| course_code | root.id | "en-cy-north" |
| seed_number | (seed array index + 1) | |
| lego_index | (introductionItems index + 1) | |
| lego_id | (auto-generated) | S0001L01 format |
| type | (analyze) | 'A' if single token, else 'M' |
| is_new | true | All LEGOs in JSON are new |
| known_text | `introductionItems[j].node.known.text` | |
| target_text | `introductionItems[j].node.target.text` | |
| components | (extract from tokens) | For M-type LEGOs |
| status | 'active' | |

### 4.4 course_practice_phrases Table

| V12 Column | JSON Source | Notes |
|------------|-------------|-------|
| id | (generate UUID) | |
| course_code | root.id | |
| seed_number | (seed index + 1) | |
| lego_index | (LEGO index + 1) | |
| position | (nodes index + 2) | +2 because 0=component, 1=debut |
| word_count | (count tokens) | `target.tokens.length` |
| lego_count | (analyze) | Count LEGOs in phrase |
| known_text | `nodes[k].known.text` | |
| target_text | `nodes[k].target.text` | |
| status | 'active' | |

**Position Logic:**
- Position 0: Components (not in this JSON - M-type LEGO parts)
- Position 1: LEGO debut (the LEGO itself) - Use `introductionItems[j].node`
- Position 2+: Practice phrases from `introductionItems[j].nodes[]`

### 4.5 texts Table (v12)

| V12 Column | JSON Source | Notes |
|------------|-------------|-------|
| id | (auto-generated) | Database UUID |
| content | (samples key) | The text string |
| language | (derive from role) | 'eng' for source, 'cym' for target/presentation |
| content_normalized | (auto-generated) | LOWER(TRIM(content)) |

### 4.6 audio_files Table (v12)

| V12 Column | JSON Source | Notes |
|------------|-------------|-------|
| id | `samples[text][i].id` | **Use UUID from JSON** to match S3 paths |
| text_id | (lookup) | FK to texts.id |
| voice_id | (lookup) | FK to voices.id (based on role) |
| cadence | `samples[text][i].cadence` | 'natural' or 'slow' |
| s3_bucket | 'ssi-audio-stage' | Hardcoded |
| s3_key | (construct) | `mastered/{uuid}.mp3` |
| duration_ms | `samples[text][i].duration * 1000` | Convert seconds to ms |
| source | 'imported_welsh_json' | Track import source |

### 4.7 course_audio Table (v12)

| V12 Column | JSON Source | Notes |
|------------|-------------|-------|
| id | (auto-generated) | Database UUID |
| course_code | 'cym_for_eng' | Welsh for English |
| audio_id | `samples[text][i].id` | FK to audio_files.id |
| role | `samples[text][i].role` | 'source', 'target1', 'target2', 'presentation' |
| context | (generate) | e.g., 'S0001L01' for LEGO context |
| position | (index) | Order in course |

### 4.6 lego_introductions Table

| V12 Column | JSON Source | Notes |
|------------|-------------|-------|
| id | (generate UUID) | |
| course_code | root.id | |
| lego_id | (generate) | S0001L01 format |
| audio_uuid | (lookup) | Find in samples by presentation text |
| duration_ms | (from audio sample) | |

---

## 5. Transformation Code (Python)

```python
import json
import uuid
from typing import Dict, List, Any

def transform_welsh_course(json_path: str) -> Dict[str, List[Dict]]:
    """Transform Welsh course JSON to V12 schema tables."""

    with open(json_path, 'r') as f:
        data = json.load(f)

    course_code = data['id']
    slice_data = data['slices'][0]

    # Result containers
    result = {
        'courses': [],
        'course_seeds': [],
        'course_legos': [],
        'course_practice_phrases': [],
        'audio_samples': [],
        'lego_introductions': []
    }

    # 1. Course record
    result['courses'].append({
        'course_code': course_code,
        'known_lang': data['known'],
        'target_lang': data['target'],
        'display_name': 'Welsh (North) for English speakers',
        'known_voice': 'en-US-Standard-C',  # Configure
        'target_voice_1': 'cy-GB-Standard-A',  # Configure
        'target_voice_2': 'cy-GB-Standard-B',  # Configure
        'presentation_voice': 'en-GB-Standard-A',  # Configure
        'welcome_audio_uuid': data['introduction']['id'],
        'welcome_audio_duration_ms': int(data['introduction']['duration'] * 1000),
        'status': 'active'
    })

    # 2. Process seeds
    for seed_idx, seed in enumerate(slice_data['seeds'], 1):
        # Seed record
        result['course_seeds'].append({
            'id': seed['id'],
            'course_code': course_code,
            'seed_number': seed_idx,
            'known_text': seed['node']['known']['text'],
            'target_text': seed['node']['target']['text'],
            'status': 'active'
        })

        # Process LEGOs (introductionItems)
        for lego_idx, lego in enumerate(seed.get('introductionItems', []), 1):
            lego_id = f"S{seed_idx:04d}L{lego_idx:02d}"
            node = lego['node']

            # Determine type: A (atomic) or M (molecular)
            target_tokens = node['target'].get('tokens', [])
            lego_type = 'A' if len(target_tokens) == 1 else 'M'

            result['course_legos'].append({
                'id': str(uuid.uuid4()),
                'course_code': course_code,
                'seed_number': seed_idx,
                'lego_index': lego_idx,
                'type': lego_type,
                'is_new': True,
                'known_text': node['known']['text'],
                'target_text': node['target']['text'],
                'components': target_tokens if lego_type == 'M' else None,
                'status': 'active'
            })

            # LEGO debut phrase (position 1)
            result['course_practice_phrases'].append({
                'id': str(uuid.uuid4()),
                'course_code': course_code,
                'seed_number': seed_idx,
                'lego_index': lego_idx,
                'position': 1,  # Debut position
                'word_count': len(target_tokens),
                'lego_count': 1,
                'known_text': node['known']['text'],
                'target_text': node['target']['text'],
                'status': 'active'
            })

            # Practice phrases (position 2+)
            for pp_idx, pp in enumerate(lego.get('nodes', []), 2):
                pp_tokens = pp['target'].get('tokens', [])
                result['course_practice_phrases'].append({
                    'id': str(uuid.uuid4()),
                    'course_code': course_code,
                    'seed_number': seed_idx,
                    'lego_index': lego_idx,
                    'position': pp_idx,
                    'word_count': len(pp_tokens),
                    'lego_count': 1,  # TODO: analyze for multi-LEGO
                    'known_text': pp['known']['text'],
                    'target_text': pp['target']['text'],
                    'status': 'active'
                })

            # Lego introduction (link to presentation audio)
            presentation_text = lego.get('presentation', '')
            if presentation_text:
                # Find audio sample for this presentation
                samples = slice_data.get('samples', {})
                audio_sample = samples.get(presentation_text, [{}])[0]

                result['lego_introductions'].append({
                    'id': str(uuid.uuid4()),
                    'course_code': course_code,
                    'lego_id': lego_id,
                    'audio_uuid': audio_sample.get('id'),
                    'duration_ms': int(audio_sample.get('duration', 0) * 1000) if audio_sample.get('duration') else None
                })

    # 3. Process audio samples
    samples = slice_data.get('samples', {})
    for text, sample_list in samples.items():
        for sample in sample_list:
            role = sample['role']
            language = 'en' if role == 'source' else data['target']

            result['audio_samples'].append({
                'uuid': sample['id'],
                'text': text,
                'text_normalized': text.lower().strip(),
                'language': language,
                'voice_id': f"{role}_voice",  # Configure per course
                'role': role,
                's3_key': f"mastered/{sample['id']}.mp3",
                'duration_ms': int(sample['duration'] * 1000),
                'status': 'approved'
            })

    return result


# Usage
if __name__ == '__main__':
    result = transform_welsh_course(
        '/Users/tomcassidy/Downloads/Welsh-north_for_English_speakers_20250604_162031 (5).json'
    )

    for table, records in result.items():
        print(f"{table}: {len(records)} records")
```

---

## 6. SQL Import Statements

### 6.1 Insert Course

```sql
INSERT INTO courses (
  course_code, known_lang, target_lang, display_name,
  known_voice, target_voice_1, target_voice_2, presentation_voice,
  welcome_audio_uuid, welcome_audio_duration_ms, status
) VALUES (
  'en-cy-north', 'en', 'cy', 'Welsh (North) for English speakers',
  'en-US-Standard-C', 'cy-GB-Standard-A', 'cy-GB-Standard-B', 'en-GB-Standard-A',
  '2E8A9A78-5FF9-4250-8733-372CE0E0CD1C', 37023, 'active'
);
```

### 6.2 Bulk Insert Seeds (Example)

```sql
INSERT INTO course_seeds (id, course_code, seed_number, known_text, target_text, status)
VALUES
  ('6F227950-1A7E-4765-991B-612CA8913679', 'en-cy-north', 1, 'I want to speak Welsh', 'dw i isio siarad Cymraeg', 'active'),
  ('3899FFAD-47B4-445D-974D-679CD9C116E5', 'en-cy-north', 2, 'I''m trying to learn Welsh', 'dw i''n trio dysgu Cymraeg', 'active'),
  -- ... 303 more
;
```

### 6.3 Insert Texts (v12)

```sql
-- Insert unique texts (auto-deduplicates on content_normalized + language)
INSERT INTO texts (content, language)
VALUES
  ('I want', 'eng'),
  ('dw i isio', 'cym'),
  ('to speak', 'eng'),
  ('siarad', 'cym')
  -- ... more
ON CONFLICT (content_normalized, language) DO NOTHING;
```

### 6.4 Insert Audio Files (v12)

```sql
-- Insert audio files with UUID from JSON (for S3 path matching)
INSERT INTO audio_files (id, text_id, voice_id, cadence, s3_bucket, s3_key, duration_ms, source)
VALUES
  (
    '9B007651-683A-4E7A-A2F1-85C327F1170C',
    (SELECT id FROM texts WHERE content_normalized = 'i want' AND language = 'eng'),
    (SELECT id FROM voices WHERE voice_id = 'welsh_source_voice'),
    'natural',
    'ssi-audio-stage',
    'mastered/9b007651-683a-4e7a-a2f1-85c327f1170c.mp3',
    1416,
    'imported_welsh_json'
  )
  -- ... 20636 more
ON CONFLICT (text_id, voice_id, cadence) DO NOTHING;
```

### 6.5 Insert Course Audio Links (v12)

```sql
-- Link course to audio files
INSERT INTO course_audio (course_code, audio_id, role, context, position)
VALUES
  ('cym_for_eng', '9B007651-683A-4E7A-A2F1-85C327F1170C', 'source', 'S0001L01', 1),
  ('cym_for_eng', 'AAC8714A-C3C1-4275-B78B-013578CD8104', 'target1', 'S0001L01', 2)
  -- ... more
ON CONFLICT (course_code, audio_id, role, context) DO NOTHING;
```

---

## 7. Additional Structures Found

### 7.1 Encouragements (for motivational breaks)

**Ordered Encouragements** - Play in sequence (44 items)
```json
{
  "id": "bd104184-1477-41eb-af81-2b90354f6020",
  "text": "Now, what you're doing here is very hard work for the brain..."
}
```

**Pooled Encouragements** - Random selection (26 items)
```json
{
  "id": "EB874772-22D4-4F3E-814D-0632323CAC33",
  "text": "And remember that your brain has got as many neurons..."
}
```

Both types have corresponding audio in the `samples` object with `role: "presentation"`.

### 7.2 Belt Assessor (UI progression system)

```json
"beltAssessor": {
  "storage": [
    [271, 350], {"name": "belt-black", ...},
    [91, 140], {"name": "belt-green", ...},
    // ... range + config pairs
  ],
  "upperBound": 350
}
```

---

## 8. Key Observations

1. **Seeds and LEGOs share IDs**: The seed's `id` often equals its final LEGO's `id` (both are `6F227950-...`)

2. **Presentation text contains markup**: Uses `<src>` and `<tgt>` tags for source/target language words

3. **LEGOs vary per seed**: Range from 1-4 LEGOs per seed, with 0-9 practice phrases per LEGO

4. **Audio samples are keyed by exact text**: Must match precisely for lookup (case-sensitive)

5. **Target audio always has two voices**: Every Welsh phrase has target1 and target2 samples

6. **Presentation audio is for LEGO introductions AND encouragements**: Same role, different contexts

7. **No explicit components for M-type LEGOs**: Must extract from tokens array

---

## 9. Migration Checklist

- [ ] Create course record with welcome audio UUID
- [ ] Insert all 305 seeds with sequential seed_numbers
- [ ] Insert all 635 LEGOs with correct seed_number and lego_index
- [ ] Insert ~6,400 practice phrases (debut + practice positions)
- [ ] Insert all 20,638 audio samples
- [ ] Link 635 lego_introductions to presentation audio
- [ ] Verify audio files exist in S3 at `mastered/{uuid}.mp3`
- [ ] Configure voice IDs for the course
- [ ] Handle encouragement audio (may need separate table)
