# 3D Memory Palace (A-Frame)

Browser-based memory palace MVP implemented with A-Frame and vanilla JavaScript. The palace uses a fixed spatial layout and randomises TSV study items across rooms at load time.

## Getting Started

1. Open `index.html` in a modern desktop browser (Chrome or Firefox recommended). Serve via a local web server for best results (e.g. `python3 -m http.server`).
2. Prepare a TSV file with four columns per row:
   - `ru_text`
   - `en_text`
   - `img_html` (an `<img>` tag; the app extracts `src`)
   - `audio_tag` (e.g. `[sound:clip.mp3]`)
3. Click **Load TSV File**, pick your file, optionally override the asset root, then press **Parse & Build Palace**.
4. Use the room list or mini-map to teleport, search to filter anchors, and the reveal toggle to show/hide English text. Progress is tracked per dataset in `localStorage`.
5. Once satisfied with the layout, give it a name in **Save Current Layout** and press **Save Layout**. Saved layouts appear underneath and can be reloaded with a single click.

## Features Implemented

- Deterministic room scaffolding with randomised, even round-robin distribution of anchors.
- Grid-based placement with automatic pagination when room capacity is exceeded.
- Image + bilingual text stacks + audio playback, with graceful fallbacks when assets are missing.
- Room-specific colour palettes and set dressing (trees, desks, furniture, etc.) to help each locus feel distinct.
- Desktop WASD/mouse navigation, teleport hotspots, and controller-friendly laser cursors.
- UI niceties: search/filter, room mini-map, reveal/test toggle, room audio queue, progress counters, toast/status feedback, and saved layout management in `localStorage`.

## Configuration

Edit `config.json` to tweak palette, placement, capacities, or room metadata. Update `assetRoot` if your media lives outside `./assets/`. Each room entry now supports `colors.floor`, `colors.walls`, and `colors.ceiling` for quick theming.

## Notes

- For local file URLs (`file://`), browsers may block audio/image loading due to CORS. Serving over `http://localhost` avoids that.
- `[mute]` labels mark anchors without audio.
- Re-loading a dataset resets layout but preserves progress only when the dataset signature matches the previous load.
- Saved layouts (TSV text + asset root) live in `localStorage`. Clear saved entries via the ✕ button if you need to reclaim space.
- Text labels render from on-the-fly canvas textures (so Cyrillic works out of the box); adjust `getTextTexture` in `app.js` if you want different typography.
