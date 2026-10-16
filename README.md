# Elina's Bookshelf

A static website that shows every book I've read, as a reading journal grouped by year.
Plain HTML, CSS and JavaScript: no server, no build step, no npm. It's hosted for free on GitHub Pages,
and it updates itself from my Goodreads shelves every 6 hours.

## Files

| File | What it does |
| --- | --- |
| `index.html` | The page structure: the left column (intro, reading now, search and filters), the empty book area, and the two pop-ups (reading stats and book details). |
| `style.css` | All the visuals: the two-column layout, the year sections, the book covers, the pop-ups and the phone layout. |
| `app.js` | Loads `goodreads.csv`, cleans the data, and draws the books, reading now, the stats and the year chart. Redraws when a filter changes. |
| `goodreads.csv` | My books. Written automatically by `scripts/update_books.py`; don't edit it by hand. |
| `scripts/update_books.py` | Downloads my Goodreads "read" and "currently-reading" shelves (from their public RSS feeds) and writes `goodreads.csv`. |
| `.github/workflows/update-books.yml` | Tells GitHub to run that script every 6 hours and save `goodreads.csv` when it changes. |
| `rereads.csv` | Books I've read more than once, and how many times (see "Rereads" below). |
| `covers/` | Optional cover images named by Goodreads Book Id, e.g. `covers/54493401.jpg`. These win over every other cover. |

## How the automatic updates work

1. Every 6 hours, GitHub Actions runs `scripts/update_books.py`.
2. The script reads my public Goodreads RSS feeds:
   `https://www.goodreads.com/review/list_rss/88350955?shelf=read` (and `shelf=currently-reading`).
3. It writes `goodreads.csv` in the same column format as a Goodreads library export.
4. If anything changed, GitHub commits the file, and GitHub Pages republishes the site.

To update straight away: on GitHub, open **Actions → Update books from Goodreads → Run workflow**.
To update on my own computer: run `python scripts/update_books.py` in this folder.

Things to keep in mind:

- My Goodreads profile and shelves must stay **public**, or the feeds come back empty.
  If that happens, the script stops and leaves the last good `goodreads.csv` in place.
- The to-read shelf is deliberately not downloaded, so it isn't published.
- GitHub pauses scheduled workflows in a repository with no activity for 60 days. If the site stops
  updating after a quiet stretch, open the Actions tab and re-enable the workflow.

## Rereads

A book I've read twice appears twice: once under each year I read it, labelled "first read" and
"second read". The stats still count it as one book.

Goodreads only shares the date of the **latest** read, so the earlier reads are listed by hand in
`rereads.csv`, one row per earlier read:

```csv
Book Id,Title,Date read
11429027,Bonds,2024/03/10
```

- The latest read comes from Goodreads automatically; don't list it here.
- A book read three times gets two rows here, one for each earlier read.
- The date can be left blank if I don't remember it; that copy goes in the "Undated" section.
- The title column is only there to remind me which book it is.

Saving a change to `rereads.csv` on GitHub updates the site straight away.

## Covers

For each book the site tries, in order:

1. `covers/<Book Id>.jpg`, my own image. The Book Id is the first column of `goodreads.csv`, and also the number in the book's Goodreads URL.
2. Goodreads' own cover image.
3. Open Library's cover for the book's ISBN.
4. A coloured placeholder with the title and author.

A missing local cover shows up as a 404 in the browser's developer console. That's expected: it's how the site knows to try the next source.

## Running it locally

Browsers don't allow `fetch()` on a page opened by double-clicking `index.html` (a `file://` address), so start a small local web server in this folder. Either:

- **VS Code:** install the *Live Server* extension, right-click `index.html` → *Open with Live Server*.
- **Python:** `python -m http.server 8000`, then open <http://localhost:8000>.

To see the phone layout, press F12 and then Ctrl + Shift + M in Chrome or Edge.

## Publishing on GitHub Pages

1. Create a new GitHub repository and push this folder to it.
2. In the repository: **Settings → Pages → Build and deployment → Source: Deploy from a branch**, branch `main`, folder `/ (root)`.
3. In **Settings → Actions → General → Workflow permissions**, choose **Read and write permissions**, so the update job can save `goodreads.csv`.
4. After a minute the site is live at `https://<username>.github.io/<repository>/`.
