#!/bin/sh
STAGED_FILES=$(git diff --cached --name-only --diff-filter=ACM | grep -E '\.(ts|tsx)$')
if [ -z "$STAGED_FILES" ]; then exit 0; fi
DUPLICATES_FOUND=0
for FILE in $STAGED_FILES; do
  CLASSES=$(grep -oE '^(export\s+)?(abstract\s+)?class\s+[a-zA-Z_][a-zA-Z0-9_]*' "$FILE" | sed 's/.*class //g' || true)
  for CLASS in $CLASSES; do
    if [ ! -z "$CLASS" ]; then
      COUNT=$(grep -r "class $CLASS" src/ --include="*.ts" | grep -v "$FILE" | wc -l)
      if [ "$COUNT" -gt 0 ]; then
        echo "WARNING: Class '$CLASS' already exists. File: $FILE"
        DUPLICATES_FOUND=1
      fi
    fi
  done
done
if [ "$DUPLICATES_FOUND" -eq 1 ]; then exit 1; fi
exit 0
