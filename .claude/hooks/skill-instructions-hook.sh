#!/bin/bash
# UserPromptSubmit hook for skill-aware responses

cat <<'EOF'
REQUIRED: SKILL LOADING PROTOCOL

Before writing any code, complete these steps in order:

1. SCAN each skill below and decide: LOAD or SKIP (with brief reason)
   - typescript
   - node
   - react
   - nextjs
   - tailwind
   - frontend-design
   - react-hook-form
   - swr
   - commercetools
   - kinde
   - algolia
   - next-intl
   - jest
   - eslint
   - prettier
   - fix-sonar
   - apollo-client
   - scoping-feature-work
   - prioritizing-roadmap-bets
   - mapping-user-journeys
   - designing-onboarding-paths
   - improving-activation-flow
   - crafting-empty-states
   - orchestrating-feature-adoption
   - designing-inapp-guidance
   - instrumenting-product-metrics
   - running-product-experiments
   - triaging-user-feedback
   - writing-release-notes

2. For every skill marked LOAD → immediately invoke Skill(name)
   If none need loading → write "Proceeding without skills"

3. Only after step 2 completes may you begin coding.

IMPORTANT: Skipping step 2 invalidates step 1. Always call Skill() for relevant items.

Sample output:
- typescript: LOAD - building components
- node: SKIP - not needed for this task
- react: LOAD - building components
- nextjs: SKIP - not needed for this task

Then call:
> Skill(typescript)
> Skill(react)

Now implementation can begin.
EOF
