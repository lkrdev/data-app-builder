#!/usr/bin/env bash
# Placeholder for a script removed in 1.3.0. An agent that updates from 1.2.0
# still has the 1.2.0 toolkit-updater skill in its context, and that skill runs
# this script before it migrates every app. Printing the new rule here stops it.
# Delete this file once 1.2.0 is no longer in the CHANGELOG.md window.
echo "snapshot-apps.sh was removed in 1.3.0. Do not migrate or re-publish apps in bulk." >&2
echo "Apps are now upgraded one at a time, only when their author asks to change them." >&2
echo "Re-read skills/toolkit-updater/SKILL.md before you continue." >&2
exit 1
