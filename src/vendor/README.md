# PDF-LIB 1.17.1

ES module distribution from the Codex bundled dependency runtime, unchanged
except for removing its source-map URL (the optional map is not shipped).
Upstream: https://github.com/Hopding/pdf-lib (MIT).

The pinned, self-contained bundle is loaded only when exporting a PDF. It avoids
runtime CDN requests and keeps exports entirely on the user's device. Its MIT
license is included alongside it. No package install scripts are executed.
