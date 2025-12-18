# Current Supabase Schema (Actual)

**Updated**: 2025-12-18
**Project**: swfvymspfxmnfhevgdkg

All tables now exist and are properly structured.

---

## Content Tables (Dashboard-managed)

### COURSES
```sql
course_code         TEXT PRIMARY KEY
known_lang          TEXT NOT NULL
target_lang         TEXT NOT NULL
display_name        TEXT
known_voice         TEXT NOT NULL
target_voice_1      TEXT NOT NULL
target_voice_2      TEXT NOT NULL
presentation_voice  TEXT
status              content_status NOT NULL DEFAULT 'draft'
created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
-- Note: version column added via trigger (increment_version)
```

### COURSE_SEEDS
```sql
id                  UUID PRIMARY KEY DEFAULT gen_random_uuid()
course_code         TEXT NOT NULL REFERENCES courses(course_code) ON DELETE CASCADE
seed_number         INTEGER NOT NULL CHECK (seed_number > 0)
seed_id             TEXT GENERATED ALWAYS AS ('S' || lpad(seed_number::text, 4, '0')) STORED
known_text          TEXT NOT NULL
target_text         TEXT NOT NULL
status              content_status NOT NULL DEFAULT 'draft'
release_batch       INTEGER
version             INTEGER NOT NULL DEFAULT 1
updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
UNIQUE(course_code, seed_number)
```

### COURSE_LEGOS
```sql
id                  UUID PRIMARY KEY DEFAULT gen_random_uuid()
course_code         TEXT NOT NULL REFERENCES courses(course_code) ON DELETE CASCADE
seed_number         INTEGER NOT NULL CHECK (seed_number > 0)
lego_index          INTEGER NOT NULL CHECK (lego_index > 0 AND lego_index < 100)
lego_id             TEXT GENERATED ALWAYS AS ('S' || lpad(seed_number::text, 4, '0') || 'L' || lpad(lego_index::text, 2, '0')) STORED
type                lego_type NOT NULL  -- 'A' or 'M'
is_new              BOOLEAN NOT NULL
known_text          TEXT NOT NULL
target_text         TEXT NOT NULL
components          JSONB  -- For M-type only: [{known, target}, ...]
status              content_status NOT NULL DEFAULT 'draft'
release_batch       INTEGER
version             INTEGER NOT NULL DEFAULT 1
updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
UNIQUE(course_code, seed_number, lego_index)
```

### COURSE_PRACTICE_PHRASES
```sql
id                  UUID PRIMARY KEY DEFAULT gen_random_uuid()
course_code         TEXT NOT NULL REFERENCES courses(course_code) ON DELETE CASCADE
seed_number         INTEGER NOT NULL CHECK (seed_number > 0)
lego_index          INTEGER NOT NULL CHECK (lego_index > 0 AND lego_index < 100)
position            INTEGER NOT NULL CHECK (position >= 0)
known_text          TEXT NOT NULL
target_text         TEXT NOT NULL
word_count          INTEGER NOT NULL
lego_count          INTEGER NOT NULL
difficulty          TEXT CHECK (difficulty IN ('easy', 'medium', 'hard'))
register            TEXT CHECK (register IN ('casual', 'formal'))
metadata            JSONB NOT NULL DEFAULT '{}'
status              content_status NOT NULL DEFAULT 'draft'
release_batch       INTEGER
version             INTEGER NOT NULL DEFAULT 1
updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
UNIQUE(course_code, seed_number, lego_index, position)
```

### AUDIO_SAMPLES
```sql
uuid                TEXT PRIMARY KEY
voice_id            TEXT
text                TEXT
text_normalized     TEXT
lang                TEXT  -- Note: 'lang' not 'language'
role                TEXT  -- source, target1, target2, presentation
cadence             TEXT  -- natural, slow
hash_input          TEXT
s3_bucket           TEXT
s3_key              TEXT
duration_ms         INTEGER
file_size_bytes     INTEGER
checksum_md5        TEXT
source              TEXT  -- tts, human
tts_engine          TEXT
tts_voice_variant   TEXT
created_at          TIMESTAMPTZ
updated_at          TIMESTAMPTZ
tts_text            TEXT
```

---

## Learner Tables (Learning App-managed)

### LEARNERS
```sql
id                  UUID PRIMARY KEY DEFAULT gen_random_uuid()
user_id             UUID NOT NULL UNIQUE  -- References auth.users
display_name        TEXT NOT NULL DEFAULT ''
preferences         JSONB NOT NULL DEFAULT '{}'
created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
```

### COURSE_ENROLLMENTS
```sql
id                  UUID PRIMARY KEY DEFAULT gen_random_uuid()
learner_id          UUID NOT NULL REFERENCES learners(id) ON DELETE CASCADE
course_code         TEXT NOT NULL
enrolled_at         TIMESTAMPTZ NOT NULL DEFAULT now()
last_practiced_at   TIMESTAMPTZ
total_practice_minutes INTEGER NOT NULL DEFAULT 0
helix_state         JSONB NOT NULL DEFAULT '{}'
UNIQUE(learner_id, course_code)
```

### LEGO_PROGRESS
```sql
id                  UUID PRIMARY KEY DEFAULT gen_random_uuid()
learner_id          UUID NOT NULL REFERENCES learners(id) ON DELETE CASCADE
lego_id             TEXT NOT NULL
course_id           TEXT NOT NULL
thread_id           INTEGER NOT NULL
fibonacci_position  INTEGER NOT NULL DEFAULT 0
skip_number         INTEGER NOT NULL DEFAULT 1
reps_completed      INTEGER NOT NULL DEFAULT 0
is_retired          BOOLEAN NOT NULL DEFAULT FALSE
last_practiced_at   TIMESTAMPTZ
created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
UNIQUE(learner_id, lego_id)
```

### SEED_PROGRESS
```sql
id                  UUID PRIMARY KEY DEFAULT gen_random_uuid()
learner_id          UUID NOT NULL REFERENCES learners(id) ON DELETE CASCADE
seed_id             TEXT NOT NULL
course_id           TEXT NOT NULL
thread_id           INTEGER NOT NULL
is_introduced       BOOLEAN NOT NULL DEFAULT FALSE
introduced_at       TIMESTAMPTZ
created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
UNIQUE(learner_id, seed_id)
```

### SESSIONS
```sql
id                  UUID PRIMARY KEY DEFAULT gen_random_uuid()
learner_id          UUID NOT NULL REFERENCES learners(id) ON DELETE CASCADE
course_id           TEXT NOT NULL
started_at          TIMESTAMPTZ NOT NULL DEFAULT now()
ended_at            TIMESTAMPTZ
duration_seconds    INTEGER NOT NULL DEFAULT 0
items_practiced     INTEGER NOT NULL DEFAULT 0
spikes_detected     INTEGER NOT NULL DEFAULT 0
final_rolling_average NUMERIC(10,4) NOT NULL DEFAULT 0
```

### RESPONSE_METRICS
```sql
id                  UUID PRIMARY KEY DEFAULT gen_random_uuid()
session_id          UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE
learner_id          UUID NOT NULL REFERENCES learners(id) ON DELETE CASCADE
course_id           TEXT NOT NULL
lego_id             TEXT NOT NULL
timestamp           TIMESTAMPTZ NOT NULL DEFAULT now()
response_latency_ms INTEGER NOT NULL
phrase_length       INTEGER NOT NULL
normalized_latency  NUMERIC(10,4) NOT NULL
thread_id           INTEGER NOT NULL
triggered_spike     BOOLEAN NOT NULL DEFAULT FALSE
mode                TEXT NOT NULL
```

### SPIKE_EVENTS
```sql
id                  UUID PRIMARY KEY DEFAULT gen_random_uuid()
session_id          UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE
learner_id          UUID NOT NULL REFERENCES learners(id) ON DELETE CASCADE
course_id           TEXT NOT NULL
lego_id             TEXT NOT NULL
timestamp           TIMESTAMPTZ NOT NULL DEFAULT now()
latency             NUMERIC(10,4) NOT NULL
rolling_average     NUMERIC(10,4) NOT NULL
spike_ratio         NUMERIC(10,4) NOT NULL
response            TEXT NOT NULL  -- 'repeat' or 'breakdown'
thread_id           INTEGER NOT NULL
```

### LEARNER_BASELINES
```sql
id                      UUID PRIMARY KEY DEFAULT gen_random_uuid()
learner_id              UUID NOT NULL REFERENCES learners(id) ON DELETE CASCADE
course_id               TEXT NOT NULL
calibrated_at           TIMESTAMPTZ NOT NULL
calibration_items       INTEGER NOT NULL
latency_mean            NUMERIC(10, 4) NOT NULL
latency_std_dev         NUMERIC(10, 4) NOT NULL
duration_delta_mean     NUMERIC(10, 4) NOT NULL
duration_delta_std_dev  NUMERIC(10, 4) NOT NULL
had_timing_data         BOOLEAN NOT NULL DEFAULT FALSE
metadata                JSONB
created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
UNIQUE(learner_id, course_id)
```

---

## Supporting Tables

### CANONICAL_WELCOMES
```sql
-- Course welcome messages (one per course)
```

### CANONICAL_ENCOURAGEMENTS
```sql
-- Motivational messages for learners
```

### CLASSIFICATION_CONFIGS
```sql
-- Runtime classification parameters
```

### LEARNER_TEMPO_PROFILES
```sql
-- Persisted learner tempo profiles for global adaptation
```

---

## Enums

```sql
CREATE TYPE content_status AS ENUM ('draft', 'released', 'deprecated');
CREATE TYPE lego_type AS ENUM ('A', 'M');
```

---

## Views

- `course_practice_phrases_with_type` - Phrases with runtime-computed phrase_type
- `course_summary` - Course statistics
- `seed_with_legos` - Seeds with their LEGOs for manifest generation

---

## RLS Policies

**Content tables (courses, seeds, legos, phrases):**
- Public read for authenticated users
- Write via service role only

**Learner tables:**
- Users can CRUD their own data via `learner_id IN (SELECT id FROM learners WHERE user_id = auth.uid())`
