# worktree-deps — why `pnpm install` is guarded here

## The hazard, demonstrated 2026-09-05

Every git worktree the Command Surface creates gets its `node_modules` **symlinked** at the
shared checkout's tree (`command-surface/worktree.js`, `linkDeps`). That is a good trade — a
worker gets working dependencies instantly instead of a 485 MB install — right up until a worker
runs `pnpm install`.

pnpm 8.15 then says, verbatim:

```
? The modules directory at "/home/tomcassidy/ssi-learning-app/node_modules" will be
  removed and reinstalled from scratch. Proceed? (Y/n) ‣ true
```

Answer yes and pnpm **follows the symlink**: it wipes the shared checkout's `node_modules` and
rebuilds it from *this worktree's* lockfile, under every other live session in that repo. The
symlink survives, so nothing looks wrong afterwards. Reproduced destructively in a scratch
fixture: same inode, new mtime, marker file gone.

Job #596 was offered exactly this prompt and declined. The next worker says yes, because the
prompt looks like ordinary dependency setup. Hence a mechanism rather than a rule.

## The guard

`preinstall` → `tools/worktree-deps/guard.mjs`. It blocks **exactly one condition**: `node_modules`
is a symlink whose real target is outside the install root. It **fails open on everything else**,
including every error — no `node_modules` at all (a clean clone, and Vercel's CI case), a real
directory, a symlink inside this tree, an unresolvable path, or a throw inside the guard itself.
Wrongly blocking would cost the estate its ability to install anything; wrongly allowing costs one
install. The asymmetry only points one way.

Override, for the case where you really do mean it: `SSI_ALLOW_SHARED_NODE_MODULES=1 pnpm install`.
It prints a loud line saying the override was used.

## The tool that satisfies it

```
node tools/worktree-deps/unshare.mjs && pnpm install   # this worktree gets its OWN deps
node tools/worktree-deps/unshare.mjs --relink          # go back to sharing, private tree removed
```

`unshare.mjs` only ever unlinks a **symlink** — it refuses to touch a real directory and never
follows the link, so the shared tree cannot be reached from it. Because pnpm's content-addressed
store is on the same filesystem, the private install hardlinks: measured at **2 seconds** in this
repo, with the shared checkout's mtime and entry count unchanged.

Most of the time you do not need any of this. The shared tree already resolves `vitest`, `eslint`,
`typescript` and the workspace packages from your worktree — just run your command.

## Tests

`pnpm test:worktree-deps` — node's built-in runner, no config, no deps. Locks the block case and
every fail-open case. A guard proven only in the direction it is meant to fire is an untested
guard on the lever.
