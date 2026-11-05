# Packaged Application Trash Purge

## Evidence And Scope

A reported permanent deletion ended after more than eleven hours with ENOTEMPTY
at a deeply nested packaged application's Contents/Resources directory. Its six
stack locations match the pre-fix local package, which contains no original-fs
removal owner. The reported operation began before the physical-removal fix was
committed; a running old operation cannot acquire a later binary's implementation.
This is evidence of the old deletion path, not a failed run of the fixed build.
The affected machine's residual files and possible external writers remain uninspected.

No new production deletion strategy, timeout, authorization rule or UI is added.
Retain the physical-filesystem owner and exact-path identity protections from
the previous fix. Do not weaken ownership checks or add Git/size prerequisites.

## Regression Coverage

Extend the existing real Electron disposal fixture, using synthetic names only:

- A runtime dependency containing a valid default_app.asar.
- A deeply nested release bundle with spaces, Chinese characters and full-width
  parentheses in its name, containing app.asar alongside app.asar.unpacked.
- The same bundle after a partial permanent deletion: retain its physical archive,
  restart Electron, rediscover the journal and permanently remove the remainder.

Each case purges the selected retained directory and selected backup. It preserves
the main repository, a newly created directory at the original Worktree location,
outside symlink contents and the original source archive. Partial deletion keeps
unknown remaining/reclaimed sizes unknown rather than guessing from stale totals.
The bounded purge assertion catches ASAR retry amplification without requiring
hours of waiting. No real user Trash, project names, credentials or network data
are used. Source-built Electron verification does not certify an installed package.

## Verification

All three physical-archive cases pass in real macOS Electron, including restart
and partial retry. Evidence: /tmp/aem-packaged-asar-retry-20261105.json.
TypeScript, production build and current-artifact verification pass; source
fingerprint remains 5f82bab1dc96 (673 inputs). Production source is unchanged from
the previously verified physical-removal fix.
