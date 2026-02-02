#!/usr/bin/env node
/**
 * Check course visibility status in Supabase
 * Run: node scripts/check-course-visibility.cjs
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
  process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY
);

async function checkCourseVisibility() {
  console.log('\n📊 Course Visibility Status\n');
  console.log('Status values: draft (hidden), beta (visible with badge), live (fully visible)\n');

  const { data: courses, error } = await supabase
    .from('courses')
    .select('course_code, display_name, new_app_status, visibility, pricing_tier, is_community')
    .order('new_app_status')
    .order('course_code');

  if (error) {
    console.error('❌ Error fetching courses:', error.message);
    process.exit(1);
  }

  if (!courses || courses.length === 0) {
    console.log('No courses found.');
    return;
  }

  // Group by status
  const byStatus = {
    live: courses.filter(c => c.new_app_status === 'live'),
    beta: courses.filter(c => c.new_app_status === 'beta'),
    draft: courses.filter(c => c.new_app_status === 'draft' || !c.new_app_status),
  };

  console.log('═══════════════════════════════════════════════════════════════');

  // Live courses
  console.log(`\n🟢 LIVE (${byStatus.live.length} courses) - Fully visible to all users`);
  if (byStatus.live.length > 0) {
    byStatus.live.forEach(c => {
      const tier = c.is_community ? 'community' : c.pricing_tier;
      console.log(`   ${c.course_code.padEnd(20)} ${tier.padEnd(10)} ${c.display_name || ''}`);
    });
  } else {
    console.log('   (none)');
  }

  // Beta courses
  console.log(`\n🟡 BETA (${byStatus.beta.length} courses) - Visible with β badge`);
  if (byStatus.beta.length > 0) {
    byStatus.beta.forEach(c => {
      const tier = c.is_community ? 'community' : c.pricing_tier;
      console.log(`   ${c.course_code.padEnd(20)} ${tier.padEnd(10)} ${c.display_name || ''}`);
    });
  } else {
    console.log('   (none)');
  }

  // Draft courses
  console.log(`\n⚪ DRAFT (${byStatus.draft.length} courses) - Hidden from users`);
  if (byStatus.draft.length > 0) {
    byStatus.draft.forEach(c => {
      const tier = c.is_community ? 'community' : c.pricing_tier;
      const status = c.new_app_status || '(null)';
      console.log(`   ${c.course_code.padEnd(20)} ${tier.padEnd(10)} ${status.padEnd(8)} ${c.display_name || ''}`);
    });
  } else {
    console.log('   (none)');
  }

  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log(`\nTotal: ${courses.length} courses`);
  console.log(`  Visible to alpha testers: ${byStatus.live.length + byStatus.beta.length}`);
  console.log(`  Hidden (draft): ${byStatus.draft.length}`);
  console.log('');
}

checkCourseVisibility().catch(console.error);
