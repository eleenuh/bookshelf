"""Rebuild goodreads.csv from Elina's public Goodreads RSS feeds.

GitHub Actions runs this every few hours (see .github/workflows/update-books.yml).
You can also run it yourself from the project folder:  python scripts/update_books.py

It downloads two shelves, "read" and "currently-reading", and writes them to goodreads.csv
using the same columns as a Goodreads library export, so app.js reads it exactly as before.
One extra column, "Cover URL", holds Goodreads' own cover image for each book.
The feeds only include the LATEST time a book was read, so earlier reads come from rereads.csv;
each one becomes an extra row, so a book read twice appears twice.
Website-only reviews come from text files in the reviews/ folder (reviews/<Book Id>.txt); a review
there replaces the Goodreads one for that book. Favourite passages come from excerpts/<Book Id>.txt
and go in an extra "Excerpt" column.

Only Python's standard library is used, so there is nothing to install.
"""

import collections
import csv
import email.utils
import html
import re
import sys
import urllib.request
import xml.etree.ElementTree as ET
from pathlib import Path

GOODREADS_USER_ID = "88350955"  # the number in goodreads.com/user/show/88350955-elina
SHELVES = ["read", "currently-reading"]  # to-read is left out on purpose, so it isn't published
PROJECT = Path(__file__).resolve().parent.parent
OUTPUT = PROJECT / "goodreads.csv"
# The feeds only give the latest read of each book, so earlier reads are listed by hand in this file
REREADS = PROJECT / "rereads.csv"
# Reviews written only for the website, one text file per book: reviews/<Book Id>.txt
REVIEWS = PROJECT / "reviews"
# Favourite passages from books, one text file per book: excerpts/<Book Id>.txt
EXCERPTS = PROJECT / "excerpts"

FEED_URL = "https://www.goodreads.com/review/list_rss/{user}?shelf={shelf}&page={page}"

# Same columns as a Goodreads export, plus "Cover URL" and "Excerpt" at the end
COLUMNS = [
    "Book Id", "Title", "Author", "Author l-f", "Additional Authors", "ISBN", "ISBN13",
    "My Rating", "Average Rating", "Publisher", "Binding", "Number of Pages", "Year Published",
    "Original Publication Year", "Date Read", "Date Added", "Bookshelves",
    "Bookshelves with positions", "Exclusive Shelf", "My Review", "Spoiler", "Private Notes",
    "Read Count", "Owned Copies", "Cover URL", "Excerpt",
]


def download(url):
    """Fetch a URL and return its text. Any network problem raises an error and stops the script."""
    request = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (bookshelf updater)"})
    with urllib.request.urlopen(request, timeout=30) as response:
        return response.read().decode("utf-8")


def fetch_shelf(shelf):
    """Return every <item> on a shelf. The feed gives 100 books per page, so keep asking for the
    next page until one comes back empty."""
    items = []
    for page in range(1, 51):  # 50 pages = 5,000 books, a safety limit
        root = ET.fromstring(download(FEED_URL.format(user=GOODREADS_USER_ID, shelf=shelf, page=page)))
        page_items = root.findall("./channel/item")
        if not page_items:
            break
        items.extend(page_items)
    return items


def text(item, path):
    return (item.findtext(path) or "").strip()


def feed_date(value):
    """'Mon, 25 May 2026 00:00:00 +0000' -> '2026/05/25' (the format Goodreads exports use).
    The date is taken as written, without converting time zones, so it never shifts by a day."""
    parsed = email.utils.parsedate_tz(value) if value else None
    if not parsed:
        return ""
    year, month, day = parsed[:3]
    return f"{year:04d}/{month:02d}/{day:02d}"


def author_last_first(name):
    """'Andy Weir' -> 'Weir, Andy', so sorting by author goes by surname."""
    parts = name.split()
    return f"{parts[-1]}, {' '.join(parts[:-1])}" if len(parts) > 1 else name


def isbn13(isbn):
    """The feed gives ISBN-10s; Open Library covers work best with ISBN-13s, so convert.
    An ISBN-13 is '978' + the first 9 digits of the ISBN-10 + a new check digit."""
    isbn = isbn.replace("-", "").upper()
    if len(isbn) == 13 and isbn.isdigit():
        return isbn
    if len(isbn) != 10:
        return ""
    core = "978" + isbn[:9]
    if not core.isdigit():
        return ""
    total = sum(int(d) * (1 if i % 2 == 0 else 3) for i, d in enumerate(core))
    return core + str((10 - total % 10) % 10)


def cover_url(item):
    """Goodreads' cover image, or "" when the book has no cover (Goodreads uses a 'nophoto' image).
    The image only loads with a file extension on the end, so add .jpg when it's missing."""
    url = text(item, "book_large_image_url") or text(item, "book_image_url")
    if not url or "nophoto" in url:
        return ""
    return url if re.search(r"\.(jpe?g|png|gif)$", url, re.I) else url + ".jpg"


def load_rereads():
    """Read rereads.csv: one row per EARLIER read of a book (Goodreads only shares the latest one).
    Returns [(book id, date read), ...]. The date may be blank if you don't remember it."""
    if not REREADS.exists():
        return []
    reads = []
    with REREADS.open(encoding="utf-8", newline="") as file:
        for row in csv.DictReader(file):
            book_id = (row.get("Book Id") or "").strip()
            date = (row.get("Date read") or "").strip().replace("-", "/")  # accept 2024-03-10 too
            if book_id:
                reads.append((book_id, date))
    return reads


def load_text_files(folder):
    """Read every <Book Id>.txt in a folder (reviews/ or excerpts/) into {book id: text}.
    The text is stored the same way Goodreads stores reviews (special characters escaped, line
    breaks as <br />), so app.js shows it exactly like a Goodreads review."""
    reviews = {}
    for path in sorted(folder.glob("*.txt")):  # finds nothing if the folder doesn't exist
        if not path.stem.isdigit():
            continue  # skip anything not named like 11429027.txt
        # utf-8-sig also copes with the invisible marker some editors (like Notepad) put at the start.
        # read_text() turns Windows line endings into plain newlines, so only those need replacing.
        review = path.read_text(encoding="utf-8-sig").strip()
        if review:
            reviews[path.stem] = html.escape(review).replace(chr(10), "<br />")  # chr(10) is a newline
    return reviews


def to_row(item, shelf):
    author = text(item, "author_name")
    isbn = text(item, "isbn")
    return {
        "Book Id": text(item, "book_id"),
        "Title": text(item, "title"),
        "Author": author,
        "Author l-f": author_last_first(author),
        "ISBN": isbn,
        "ISBN13": isbn13(isbn),
        "My Rating": text(item, "user_rating") or "0",
        "Average Rating": text(item, "average_rating"),
        "Number of Pages": text(item, "book/num_pages"),
        "Original Publication Year": text(item, "book_published"),
        "Date Read": feed_date(text(item, "user_read_at")),
        "Date Added": feed_date(text(item, "user_date_added")),        "Exclusive Shelf": shelf,
        "My Review": text(item, "user_review"),  # may contain <br />; app.js turns those into line breaks
        "Cover URL": cover_url(item),
    }


def main():
    rows = []
    for shelf in SHELVES:
        items = fetch_shelf(shelf)
        print(f"{shelf}: {len(items)} books")
        rows += [to_row(item, shelf) for item in items]

    # Rereads: for every earlier read listed in rereads.csv, add another copy of that book with
    # the earlier date, so the book appears once for each time it was read.
    # "Read Count" on every copy is the total number of reads.
    read_rows = {row["Book Id"]: row for row in rows if row["Exclusive Shelf"] == "read"}
    extra_reads = [(book_id, date) for book_id, date in load_rereads() if book_id in read_rows]
    for book_id, date in extra_reads:
        rows.append({**read_rows[book_id], "Date Read": date})  # a copy with the earlier date
    extra_counts = collections.Counter(book_id for book_id, _ in extra_reads)
    for row in rows:
        if row["Exclusive Shelf"] == "read":
            row["Read Count"] = str(1 + extra_counts[row["Book Id"]])

    # Website-only reviews replace the Goodreads review for that book, and excerpts fill the
    # "Excerpt" column (on every copy of a reread)
    known_ids = {row["Book Id"] for row in rows}
    for folder, column in [(REVIEWS, "My Review"), (EXCERPTS, "Excerpt")]:
        texts = load_text_files(folder)
        for row in rows:
            if row["Book Id"] in texts:
                row[column] = texts[row["Book Id"]]
        for book_id in texts.keys() - known_ids:
            print(f"Warning: {folder.name}/{book_id}.txt doesn't match any book on your shelves, so it isn't shown.")

    # If the read shelf comes back empty, the profile has probably been made private or Goodreads
    # is having problems. Stop without touching goodreads.csv, so the site keeps the last good copy.
    if not any(row["Exclusive Shelf"] == "read" for row in rows):
        sys.exit("No read books found in the feed. goodreads.csv was left unchanged.")

    # Always write the books in the same order, so the file only changes when the books do
    rows.sort(key=lambda row: (row["Exclusive Shelf"], int(row["Book Id"] or 0), row["Date Read"]))

    with OUTPUT.open("w", encoding="utf-8", newline="") as file:
        writer = csv.DictWriter(file, fieldnames=COLUMNS, restval="")
        writer.writeheader()
        writer.writerows(rows)
    print(f"Wrote {len(rows)} books to {OUTPUT.name}")


if __name__ == "__main__":
    main()
