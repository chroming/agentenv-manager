# Conversation Sorting Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add correct index-backed conversation sorting by recent activity, file size, and message count, with compact supporting metadata.

**Architecture:** Extend the shared list input with a closed sort mode, translate it into deterministic SQLite ordering in both index readers, and keep renderer state in the existing Conversation workspace cache. Reuse existing controls and metadata rows; do not scan source files during sorting.

**Tech Stack:** TypeScript, React, Electron IPC, Node SQLite, Vitest, Playwright.

---

## Chunk 1: Index Contract

### Task 1: Add deterministic index sorting

**Files:**
- Modify: `src/shared/types.ts`
- Modify: `src/main/conversations/conversationIndexStore.ts`
- Modify: `src/main/conversations/conversationIndexReaderWorker.ts`
- Test: `tests/main/conversations/conversationIndexStore.test.ts`

- [x] Write failing tests for largest, most-messages, unknown-size-last, and paginated ordering.
- [x] Run the index test and confirm the new sort contract fails.
- [x] Add the closed sort type and deterministic SQL ordering with updated time and ID tie-breakers.
- [x] Run the index test and existing conversation service tests.

## Chunk 2: Renderer Contract

### Task 2: Add the compact sort control and metadata

**Files:**
- Modify: `src/renderer/components/ConversationWorkspace.tsx`
- Modify: `src/renderer/ui/pages/conversations.css`
- Modify: `src/renderer/i18n.tsx`
- Test: `tests/renderer/ConversationWorkspace.test.tsx`

- [x] Write failing renderer tests for sort IPC input, date groups, retained view state, and detail metadata.
- [x] Run the renderer test and confirm the missing behavior fails.
- [x] Add an `IconButton` plus checked `ActionMenu` beside search and pass sort through initial load, search, filters, and pagination.
- [x] Hide date groups outside default mode and render message count plus verified size in detail metadata.
- [x] Run renderer tests and translation/style audits.

## Chunk 3: Desktop Evidence

### Task 3: Verify the rebuilt Electron surface

**Files:**
- Modify: `tests/e2e/conversations.e2e.test.ts`
- Modify: `docs/product-contracts.md`

- [x] Add minimum-window E2E coverage for sort composition and containment.
- [x] Update the product contract with read-only index sorting semantics.
- [x] Rebuild the current Electron artifact.
- [x] Run targeted Electron E2E and capture default/largest states at 920x620.
- [x] Run `git diff --check`, feature/style/translation audits, and report unrun package evidence honestly.
