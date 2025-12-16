#!/bin/bash
# Schema Deployment Script for SSi Learning App
# This script helps deploy the learner tables to Supabase

set -e

PROJECT_REF="swfvymspfxmnfhevgdkg"
SCHEMA_FILE="$(dirname "$0")/../schema_deploy_ready.sql"

echo "================================"
echo "SSi Learning App Schema Deployer"
echo "================================"
echo ""

# Check if schema file exists
if [ ! -f "$SCHEMA_FILE" ]; then
    echo "Error: Schema file not found at $SCHEMA_FILE"
    exit 1
fi

echo "Schema file: $SCHEMA_FILE ($(wc -l < "$SCHEMA_FILE") lines)"
echo ""

# Method 1: Try Supabase CLI
echo "Attempting deployment via Supabase CLI..."
if command -v supabase &> /dev/null; then
    echo "Supabase CLI found. Running db push..."
    echo "Note: You'll need to enter your database password."
    echo ""

    # Ensure we're linked
    cd "$(dirname "$0")/.."
    supabase link --project-ref "$PROJECT_REF" 2>/dev/null || true

    # Try to push
    if supabase db push; then
        echo ""
        echo "Schema deployed successfully!"
        exit 0
    else
        echo ""
        echo "CLI deployment failed. Trying alternative methods..."
    fi
else
    echo "Supabase CLI not found."
fi

echo ""
echo "================================"
echo "Manual Deployment Required"
echo "================================"
echo ""
echo "Please deploy the schema manually using one of these methods:"
echo ""
echo "Option 1: Supabase Dashboard SQL Editor"
echo "  1. Open: https://supabase.com/dashboard/project/$PROJECT_REF/sql"
echo "  2. Copy the contents of: $SCHEMA_FILE"
echo "  3. Paste into the SQL Editor"
echo "  4. Click 'Run'"
echo ""
echo "Option 2: Reset Database Password & Retry"
echo "  1. Go to: https://supabase.com/dashboard/project/$PROJECT_REF/settings/database"
echo "  2. Click 'Reset database password'"
echo "  3. Run this script again with the new password"
echo ""
echo "Option 3: Direct psql Connection"
echo "  psql postgresql://postgres.$PROJECT_REF:[PASSWORD]@aws-0-eu-west-1.pooler.supabase.com:6543/postgres -f $SCHEMA_FILE"
echo ""
