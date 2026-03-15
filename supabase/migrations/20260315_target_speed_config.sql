-- Add target_speed config to voice_config JSONB for courses recorded at natural speed.
-- target_speed.belt_ramp: true = slow early seeds (White 0.82x, Yellow 0.91x, Orange+ 1.0x)
-- target_speed.global_speed: base multiplier for all target audio (compensate for voice speed)
--
-- Courses recorded at natural (1.0x) speed get belt_ramp enabled.
-- Legacy courses recorded at 0.8x speed are left untouched (no target_speed key = 1.0x everywhere).

UPDATE courses
SET voice_config = COALESCE(voice_config, '{}'::jsonb) || '{"target_speed": {"belt_ramp": true}}'::jsonb
WHERE course_code IN ('pol_for_eng', 'tur_for_eng', 'hrv_for_eng');
