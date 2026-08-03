# Homebrew Tap Deploy Key Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish the generated Homebrew Cask without storing a broad GitHub account token in AgentEnv Manager Actions secrets.

**Architecture:** A dedicated Ed25519 deploy key has write access only to `chroming/homebrew-tap`. The release workflow writes the private key to a temporary file, pins GitHub's published Ed25519 host key, clones the Tap over SSH, pushes the Cask, and removes the temporary key through runner cleanup.

**Tech Stack:** GitHub Actions, OpenSSH, GitHub REST API, GitHub CLI.

---

### Task 1: Bind the release workflow to a repository-scoped deploy key

**Files:**
- Modify: `.github/workflows/release.yml`
- Modify: `tests/main/packagePackaging.test.ts`

- [x] Add a packaging contract test that rejects the broad PAT secret and requires the deploy-key secret, pinned host key, SSH clone URL, and strict host verification.
- [x] Run the focused test and confirm it fails.
- [x] Update the Tap publication step to use the deploy key with argument-safe Git commands.
- [x] Run the focused test and confirm it passes.

### Task 2: Update operator documentation

**Files:**
- Modify: `README.md`
- Modify: `README.en.md`
- Modify: `docs/development.md`
- Modify: `docs/superpowers/specs/2026-08-03-unsigned-release-distribution-design.md`

- [x] Replace PAT setup instructions with the repository-scoped deploy-key contract.
- [x] Verify references no longer mention `HOMEBREW_TAP_TOKEN` outside the negative packaging assertion and this checklist.

### Task 3: Provision and prove the external boundary

- [x] Create public repository `chroming/homebrew-tap` with an initial README.
- [x] Generate a dedicated Ed25519 key pair in a temporary `0700` directory.
- [x] Add the public key to `chroming/homebrew-tap` with write access.
- [x] Store the private key as `HOMEBREW_TAP_DEPLOY_KEY` in `chroming/agentenv-manager` Actions secrets.
- [x] Clone through the deploy key, create and remove a temporary proof branch, and verify the key cannot write to `chroming/agentenv-manager`.
- [x] Run packaging tests, release verification, and inspect repository/secret metadata without exposing private material.
