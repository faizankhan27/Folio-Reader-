# Folio – PDF Reader

Turns messy PDFs into a clean, book-style reading experience, right in the browser.

## Features
- Re-flows PDF text into proper paragraphs (removes page numbers, repeated headers/footers, joined hyphenated words)
- Automatic chapter detection with a table of contents; acknowledgements, copyright and similar extras are left out
- Pages mode (one page at a time, swipe or tap) and Scroll mode, with a page bar like a PDF viewer
- Bookmarks and text highlights, with an overview panel per book
- Typography controls: font, size, line spacing, page width, justify
- Two themes: Parchment and Midnight
- Adjustable text size, line spacing and page width
- Library shown as book covers (first page by default, or your own cover image), with reading progress, saved on your device (IndexedDB)
- Works on phone and laptop browsers

## Run it
It's a static site with no build step. Open `index.html` in a browser, or host it.

## Host on GitHub Pages
1. Create a new GitHub repository and upload everything in this folder (keep the `assets` folder).
2. Go to **Settings → Pages**.
3. Under **Build and deployment**, choose **Deploy from a branch**, pick `main` and `/ (root)`, then **Save**.
4. After a minute your reader is live at `https://<your-username>.github.io/<repo-name>/`.

## Reading modes
- **Reflowed** (default): the print-style book view.
- **Original PDF**: the pages exactly as in the file (switch in the Aa menu). The PDF is saved on the device when you add it. Scanned PDFs open as the original right away; tap *Convert to text* on their card to make a reflowed version with OCR.

## Notes
- Needs an internet connection to load the PDF.js library and Google Fonts from CDNs.
- Scanned PDFs (no selectable text) are read with OCR (Tesseract.js, loaded from a CDN on first use). This is slow: expect several minutes on a laptop and much longer on a phone for a 400+ page book. Keep the tab open; progress is saved, and adding the same file again resumes.
- Books are stored in the browser on that device. Google Drive sync is not included yet.
- `assets/shelves.jpg` is the library header photo; replace it with an image you have the rights to use before publishing.

## Files
- `index.html` – page structure
- `style.css` – themes and layout
- `app.js` – PDF parsing, chapters, library and reader
- `assets/` – library header image
