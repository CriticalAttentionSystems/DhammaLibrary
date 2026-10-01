PDF.js 6.3.289 legacy generic distribution
Source: https://github.com/mozilla/pdf.js/releases/download/v6.3.289/pdfjs-6.3.289-legacy-dist.zip
License: Apache-2.0 (see LICENSE; bundled font/CMap license files retained).

Local modifications: web/viewer.html loads /assets/book-viewer-bootstrap.js and /assets/book-viewer.css, uses the Dhamma Library title, and restricts connections to this origin. All other upstream files are unchanged. Source maps and the sample PDF are omitted.

The complete integrity.json records SHA-256 digests of the vendored files, including the customized viewer.html. Keep matching build/ and web/ versions when upgrading.
