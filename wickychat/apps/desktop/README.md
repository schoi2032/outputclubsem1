# WickyChat desktop (Rust + Tauri)

A small native app around https://wickychat.vercel.app. The shell is Rust (`src-tauri/src/main.rs`). It uses the computer's built-in web engine, so the app is about 3 MB instead of Electron's ~150 MB.

What it does:
- **Checks the connection first.** It starts on a bundled page (`offline/index.html`). When you're offline, that page shows "Can't reach WickyChat" with a Try again button.
- **Keeps you in WickyChat.** Only WickyChat (and Google sign-in) open inside the window. Every other link opens in your normal browser.
- **One copy at a time.** Opening it again just focuses the window that's already open.
- **Remembers the window.** Size and position are restored on the next launch.
- **Has a menu.** Home (⌘⇧H), Reload (⌘R), zoom (⌘= ⌘- ⌘0), full screen, Help → How to Use WickyChat, and Open This Page in Your Browser.

## Build

You need Rust 1.90+ (`rustup update stable`) and Node 24 with pnpm.

```bash
cd apps/desktop
pnpm install
pnpm dev        # run it while developing
pnpm build      # makes the app and installer
```

The output goes to `src-tauri/target/release/bundle/`:
- macOS: `macos/WickyChat.app` and `dmg/WickyChat_0.1.0_aarch64.dmg`
- Windows: an `.msi` and a `.exe` installer (build on Windows)
- Linux: `.deb`, `.rpm` and `.AppImage` (build on Linux)

To point it at a local server instead of the live site:

```bash
WICKY_URL=http://localhost:3000 pnpm dev
```

To change the icon, edit `icons/app-icon.svg` and run `pnpm icons`.

## Sharing it

The app isn't signed with an Apple Developer ID. The first time someone opens it on a Mac, they'll need to right-click → **Open**, or allow it in System Settings → Privacy & Security. Signing and notarizing needs a paid Apple Developer account.

## Not done yet

- Desktop notifications and the unread badge on the Dock icon. Neither works yet, because the web page can't talk to the Rust side yet.
- Auto-updates. The app always loads the live site, so new features show up without reinstalling. Only changes to the Rust shell need a new download.
