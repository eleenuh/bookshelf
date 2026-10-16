# Website-only reviews

Reviews in this folder appear on the website but are never posted to Goodreads.

- One plain text file per book, named by the book's Goodreads **Book Id**: `11429027.txt`.
  The Book Id is the number in the book's Goodreads address, e.g. `goodreads.com/book/show/11429027-bonds`.
- Write the review as normal text. Line breaks and blank lines between paragraphs are kept.
- If the book also has a review on Goodreads, the one here is shown instead.
- Saving a file here on GitHub updates the website within a minute or two.

If a review doesn't appear, check the file name: it must be just the number followed by `.txt`.
The GitHub Action prints a warning for any file whose number isn't one of my books.
