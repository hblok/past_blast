# TODO

## Publish the v3 release (open)

State as of 2026-10-11:
- `main` at `b2a239a` holds everything for v3 (kit content, README header, `scripts/smoke.sh`, CI, `scripts/release.sh`, v3 entry in `CHANGELOG.md`).
- No GitHub release and no tag exist yet (`hblok/past_blast` has no releases or tags).
- A cloud Claude session could not create it: `gh release create` returned `HTTP 403: Creating, editing, or deleting releases is not permitted for this session type`. That is a session restriction, not a repo problem; do not try to work around it from such a session.

To finish, from a checkout of `main` on a machine with `gh auth login` done:

    scripts/release.sh v3 --publish

(needs a clean tree; runs `scripts/smoke.sh`, builds `vendor/past_blast-v3-<date>-<sha>.tar.gz` with `git archive`, then `gh release create v3 ... --repo hblok/past_blast`). Or create it in the browser at https://github.com/hblok/past_blast/releases/new with tag `v3`, target `main`, and the tarball from `scripts/release.sh v3` (without `--publish`) attached. Then delete this section.

## Other open items

- Decide the structure questions: root `CLAUDE.md` and `README.md` are new-game templates (`<game>` placeholders), which is wrong for working on the kit itself; consider a repo-level `CLAUDE.md` and keeping the template as `TEMPLATE_CLAUDE.md`. `MANIFEST.txt` goes stale once the repo is edited directly (the v2 one is kept for provenance). The 3 MB Wolfenstein 3D example sits in `port_kit/examples/wolf3d/`; decide whether it moves to a top-level `examples/`.
- `scripts/setup.sh` downloads the prebuilt `dosbox-x-dbg` from the `tools-dosbox-x-dbg` release of hblok/keen (private). Consider republishing it as a release asset of this repo (needs the user's go-ahead; publishing is outward-facing).
- The remote branch `claude/sleepy-wright-nu1fqj` is fully merged into `main` and can be deleted (the cloud session's proxy refused the delete).
- Choose the next game: see `plans/next_games.md`.
