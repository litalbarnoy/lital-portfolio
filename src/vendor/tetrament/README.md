# Tetrament (vendored)

Source: https://github.com/zalo/Tetrament
Commit: cf03edcebbcdca21a3ab3b34b8f04fccdb2e3388
License: MIT — see LICENSE (© 2025 Johnathon Selstad)

Vendored rather than installed, for three reasons:

1. It is not published to npm. `npm install tetrament` 404s; the README's
   install line is aspirational.
2. Installed from GitHub, npm normalises the spec to the `github:` shorthand
   and resolves it over `git+ssh://`, which fails on CI (Vercel has no SSH key
   for github.com). Vendoring takes a git clone off the critical build path.
3. A git install skips the package's build, so `dist/` never exists and the
   package's own `main` export is dead. We import `lib/` directly regardless.

Only `lib/` is copied — that is the actual ES module source. Nothing here is
modified; update by re-copying `lib/` at a newer commit and bumping the SHA above.
