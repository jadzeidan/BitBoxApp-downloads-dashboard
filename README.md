# BitBoxApp Downloads Dashboard

Simple static dashboard for visualizing BitBoxApp installer download counts from GitHub releases.

The app pulls release data from:

- `https://api.github.com/repos/BitBoxSwiss/bitbox-wallet-app/releases`

It excludes checksum/signature assets and groups installer downloads by:

- Windows
- macOS
- Linux
- Android APK

## Features

- Summary stats cards by platform and total downloads
- Date range controls (`All time`, `90 days`, `180 days`, `1 year`, custom range)
- Platform totals bar chart
- Downloads over time by OS
- Downloads over time by app version
- Per-platform release asset list with direct download links

## Run Locally

No build step is required. This is a plain HTML/CSS/JS app.

1. Open a terminal in the repo:

```bash
cd BitBoxApp-downloads-dashboard
```

2. Start a local static server:

```bash
python3 -m http.server 5173
```

3. Open the dashboard:

- [http://localhost:5173](http://localhost:5173)

## Notes

- Internet access is required (GitHub API + Google Fonts).
- If data fails to load, you may be hitting GitHub API rate limits for unauthenticated requests.
- The dashboard only reflects GitHub release downloads, not App Store or Play Store installs.
