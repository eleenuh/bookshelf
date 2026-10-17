/* app.js — everything that moves.
 *
 * 1. Fetch goodreads.csv and parse it with Papa Parse.
 * 2. Clean each row into a tidy book object, and split them into "read" and "currently reading".
 * 3. Draw the books in sections (one per year when ordered by date), "reading now",
 *    and the stats pop-up with its year chart, and redraw the books when a filter changes.
 *
 * All text from the CSV goes into the page with textContent, never innerHTML,
 * so nothing in a title or review can ever be run as HTML.
 */

const CSV_URL = "goodreads.csv";
const NO_DATE = "none"; // the bucket for books without a Date Read

// Everything the user can change lives in one object. render() reads it and redraws.
const state = {
  books: [],       // every "read" book, parsed once at startup
  reading: [],     // books on the "currently-reading" shelf
  query: "",       // search box text
  sort: "recent",  // a key of SORTERS below
  minRating: 0,    // 0 = everything
  year: null,      // null = all years, otherwise a year number or NO_DATE (set by the chart)
};

const $ = (selector) => document.querySelector(selector);

// ---------- 1. Loading and cleaning the data ----------

async function loadBooks() {
  const response = await fetch(CSV_URL);
  if (!response.ok) throw new Error(`${CSV_URL} returned HTTP ${response.status}`);
  const text = await response.text();

  // header: true -> each row becomes an object keyed by column name, e.g. row["Title"]
  const parsed = Papa.parse(text, { header: true, skipEmptyLines: true });
  if (parsed.errors.length) console.warn("CSV parse problems:", parsed.errors);

  return parsed.data.map(toBook); // every shelf; init() splits them into read and currently-reading
}

// Turn one raw CSV row (all strings) into a book with proper numbers and dates.
function toBook(row) {
  return {
    id: (row["Book Id"] || "").trim(),
    shelf: (row["Exclusive Shelf"] || "").trim(), // "read", "currently-reading" or "to-read"
    title: (row["Title"] || "").trim() || "Untitled",
    author: (row["Author"] || "").trim() || "Unknown author",
    authorSort: (row["Author l-f"] || row["Author"] || "").trim(), // "Weir, Andy" sorts by surname
    isbn13: cleanIsbn(row["ISBN13"]),
    coverUrl: (row["Cover URL"] || "").trim(), // Goodreads' cover, added by scripts/update_books.py
    rating: Number(row["My Rating"]) || 0,
    readCount: Number(row["Read Count"]) || 1, // more than 1 for rereads (see rereads.csv)
    pages: Number(row["Number of Pages"]) || null,
    year: Number(row["Original Publication Year"]) || Number(row["Year Published"]) || null,
    dateRead: parseDate(row["Date Read"]),
    dateAdded: parseDate(row["Date Added"]),
    review: cleanReview(row["My Review"]),
    excerpt: cleanReview(row["Excerpt"]), // a favourite passage, from excerpts/<Book Id>.txt
  };
}

// Goodreads writes ISBNs as ="9780593135204" so spreadsheets keep the leading zeros.
function cleanIsbn(value) {
  return String(value || "").replace(/[="\s]/g, "");
}

// "2023/05/14" -> a Date, or null when empty.
// new Date(year, monthIndex, day) uses local time; new Date("2023-05-14") would use UTC
// and can show up as the 13th in timezones west of Greenwich.
function parseDate(value) {
  const match = /^(\d{4})\/(\d{1,2})\/(\d{1,2})$/.exec(String(value || "").trim());
  if (!match) return null;
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

// Reviews can contain <br /> and the odd <i> or &amp;. We want plain text with real line breaks.
function cleanReview(value) {
  const withNewlines = String(value || "").replace(/<br\s*\/?>/gi, "\n");
  // DOMParser builds an inert, off-screen document: no scripts run and no images load.
  // Its textContent drops any leftover tags and decodes entities like &amp; into &.
  const doc = new DOMParser().parseFromString(withNewlines, "text/html");
  return doc.body.textContent.trim();
}

// ---------- 2. Small helpers ----------

// Create an element with an optional class and text in one line.
function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

const yearRead = (book) => (book.dateRead ? book.dateRead.getFullYear() : NO_DATE);
const time = (date) => (date ? date.getTime() : 0); // missing dates sort as oldest
const plural = (n, word) => `${n.toLocaleString()} ${word}${n === 1 ? "" : "s"}`;

// "Oct 4" when the year is already in the section heading, "Oct 4, 2023" otherwise
function shortDate(date, withYear) {
  const options = withYear ? { month: "short", day: "numeric", year: "numeric" } : { month: "short", day: "numeric" };
  return date.toLocaleDateString(undefined, options);
}

// How many times a book was read, in words: 1 -> "once", 2 -> "twice", 3 -> "3 times"
function timesInWords(n) {
  return n === 1 ? "Once" : n === 2 ? "Twice" : `${n} times`;
}

// 1 -> "first", 2 -> "second" … for labelling each read of a reread book
const ORDINALS = ["first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth", "ninth", "tenth"];
const ordinal = (n) => ORDINALS[n - 1] || `${n}th`;

// A reread book appears once per read (scripts/update_books.py adds a row for each earlier read).
// Give each copy its place in the order: readNumber 1 = the first time, 2 = the second, and so on.
function numberReads(books) {
  const byBook = new Map();
  for (const book of books) {
    const key = book.id || book; // books without an id are never grouped together
    if (!byBook.has(key)) byBook.set(key, []);
    byBook.get(key).push(book);
  }
  for (const reads of byBook.values()) {
    if (reads.length < 2) continue;
    reads.sort((a, b) => time(a.dateRead) - time(b.dateRead)); // oldest first (undated counts as oldest)
    reads.forEach((book, i) => {
      book.readNumber = i + 1;
      book.readCount = Math.max(book.readCount, reads.length);
    });
  }
}

// One copy of each book, for the stats, so a reread isn't counted as two books
function uniqueBooks(books) {
  return [...new Map(books.map((book) => [book.id || book, book])).values()];
}

function longDate(date) {
  return date.toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" });
}

// Same title -> same number, so a book's placeholder colour never changes between visits.
function hashText(text) {
  let hash = 0;
  for (const ch of text) hash = (hash * 31 + ch.codePointAt(0)) % 360;
  return hash;
}

// ---------- 3. Filtering, sorting and grouping ----------

// Each sorter compares two books: negative = a first, positive = b first.
// `||` chains a tie-breaker: it's only used when the first comparison gives 0.
const SORTERS = {
  recent: (a, b) => time(b.dateRead) - time(a.dateRead) || time(b.dateAdded) - time(a.dateAdded),
  rating: (a, b) => b.rating - a.rating || SORTERS.recent(a, b),
  title: (a, b) => a.title.localeCompare(b.title),
  author: (a, b) => a.authorSort.localeCompare(b.authorSort) || a.title.localeCompare(b.title),
  pages: (a, b) => (b.pages || 0) - (a.pages || 0),
};

// The heading shown beside the books when they're NOT ordered by date (so not split into years)
const SORT_HEADINGS = {
  rating: "Favourites first",
  title: "A to Z",
  author: "By author",
  pages: "Longest first",
};

function getVisibleBooks() {
  const query = state.query.trim().toLowerCase();
  return state.books
    .filter((b) => !query || b.title.toLowerCase().includes(query) || b.author.toLowerCase().includes(query))
    .filter((b) => b.rating >= state.minRating)
    .filter((b) => state.year === null || yearRead(b) === state.year)
    .sort(SORTERS[state.sort]); // filter() made a new array, so this doesn't reorder state.books
}

// Split the (already sorted) books into sections.
// Ordered by date: one section per year, newest first, books with no date at the end.
// Any other order: one section holding everything.
function groupBooks(books) {
  if (state.sort !== "recent") {
    return [{ heading: SORT_HEADINGS[state.sort], books, byYear: false }];
  }
  const groups = new Map(); // a Map remembers insertion order, and the books are already newest first
  for (const book of books) {
    const key = yearRead(book);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(book);
  }
  return [...groups].map(([key, booksInYear]) => ({
    heading: key === NO_DATE ? "Undated" : String(key),
    books: booksInYear,
    byYear: key !== NO_DATE,
  }));
}

// ---------- 4. Building pieces of the page ----------

// Rating as five dots: ●●●●○. Unrated books say so in words instead.
function createDots(rating) {
  if (!rating) return el("span", "dots unrated", "not rated yet");
  const dots = el("span", "dots", "●".repeat(rating) + "○".repeat(5 - rating));
  dots.setAttribute("role", "img");
  dots.setAttribute("aria-label", `${rating} out of 5`); // screen readers say this instead of "black circle black circle…"
  return dots;
}

// Colours for books without a cover image: a background and a matching text colour.
const TONES = [
  // All taken from (or blended from) the site's four colours, so they sit well on the page
  { bg: "#6b5e3b", ink: "#fbf7f0" }, // olive-bronze
  { bg: "#47512f", ink: "#e8e0d1" }, // deep olive green
  { bg: "#e8e0d1", ink: "#47512f" }, // sand
  { bg: "#887d5f", ink: "#fbf7f0" }, // light olive
  { bg: "#d6cbb5", ink: "#47512f" }, // darker sand
  { bg: "#595735", ink: "#e8e0d1" }, // between the two dark olives
];

// A plain coloured cover with the title and author printed on it.
function createPlaceholder(book) {
  const tone = TONES[hashText(book.title) % TONES.length];
  const placeholder = el("span", "cover-placeholder");
  placeholder.style.backgroundColor = tone.bg;
  placeholder.style.color = tone.ink;
  placeholder.append(el("span", "ph-title", book.title), el("span", "ph-author", book.author));
  return placeholder;
}

// Cover fallback chain: covers/<id>.jpg -> Goodreads' cover -> Open Library by ISBN -> coloured placeholder.
// Each time an image fails to load, the "error" event fires and we try the next source.
function createCover(book) {
  const wrapper = el("span", "cover");
  // Which part of the wear texture this book shows (see .cover::after in style.css).
  // Worked out from the Book Id, so each book always has the same scuffs.
  const wear = hashText(book.id || book.title);
  wrapper.style.setProperty("--wear-x", `${wear % 101}%`);
  wrapper.style.setProperty("--wear-y", `${(wear * 7) % 101}%`);
  const sources = [];
  if (book.id) sources.push(`covers/${book.id}.jpg`);
  if (book.coverUrl) sources.push(book.coverUrl);
  // ?default=false makes Open Library return a 404 instead of a blank image, so "error" fires
  if (book.isbn13) sources.push(`https://covers.openlibrary.org/b/isbn/${book.isbn13}-L.jpg?default=false`);

  if (!sources.length) {
    wrapper.append(createPlaceholder(book));
    return wrapper;
  }

  const img = document.createElement("img");
  img.loading = "lazy"; // set before src: only download once the book nears the screen
  img.decoding = "async";
  img.alt = ""; // decorative: the title is printed right next to it
  let attempt = 0;
  img.addEventListener("error", () => {
    attempt += 1;
    if (attempt < sources.length) img.src = sources[attempt];
    else img.replaceWith(createPlaceholder(book));
  });
  img.src = sources[0];
  wrapper.append(img);
  return wrapper;
}

// The cover sitting on a little stack of loose pages that peek out behind it (see .page-stack in style.css).
// Each book gets its own tilt and amount of overhang, worked out from its Book Id, so no two stacks match.
// Used in the grid and for the big cover in the detail view.
function createPageStack(book) {
  const stack = el("span", "page-stack");
  const h = hashText(book.id || book.title);
  stack.style.setProperty("--tilt-1", `${((h % 7) - 3) * 0.35}deg`);       // -1.05° to 1.05°
  stack.style.setProperty("--tilt-2", `${(((h * 3) % 7) - 3) * 0.4}deg`);  // -1.2° to 1.2°
  stack.style.setProperty("--tilt-3", `${(((h * 5) % 7) - 3) * 0.3}deg`);  // -0.9° to 0.9°
  stack.style.setProperty("--overhang", `${10 + (h % 7)}px`);              // 10px to 16px
  stack.append(el("span", "loose-page"), createCover(book));
  return stack;
}

// One book: the cover, then title, author, rating dots, a line of the review and the date.
// The date is created separately (book.dateLine) because its wording depends on the section.
function createEntry(book) {
  // A <button> makes the whole entry clickable, focusable with Tab and openable with Enter/Space.
  const entry = el("button", "entry");
  entry.type = "button";

  const info = el("span", "entry-info");
  info.append(el("span", "entry-title", book.title), el("span", "author", book.author), createDots(book.rating));
  // Only the start of the review: CSS cuts it off after three lines. The full text is in the detail view.
  if (book.review) info.append(el("span", "entry-review", book.review));
  book.dateLine = el("span", "entry-date");
  info.append(book.dateLine);

  const stack = createPageStack(book);
  entry.append(stack, info);
  entry.addEventListener("click", () => openDetail(book, stack)); // the cover glides from here
  return entry;
}

// ---------- 5. Rendering ----------

function render() {
  const visible = getVisibleBooks();
  renderStatus(visible);
  renderShelf(visible);
  updateChartSelection();
}

function renderShelf(books) {
  const sections = groupBooks(books).map((group) => {
    const section = el("section", "year");

    const label = el("div", "year-label");
    label.append(
      el("h2", group.byYear ? "year-heading" : "year-heading is-text", group.heading),
      el("span", "year-count", plural(group.books.length, "book")),
    );

    const list = el("ul", "year-books");
    for (const book of group.books) {
      // Each entry is built the first time it's needed and then reused (book.item).
      // Reusing it means a cover that already loaded, or already fell back to a placeholder,
      // isn't downloaded again on every keystroke in the search box.
      if (!book.item) {
        book.item = el("li");
        book.item.append(createEntry(book));
      }
      // Inside a year section the year is in the heading, so "finished Oct 4" is enough
      let dateText = book.dateRead ? `finished ${shortDate(book.dateRead, !group.byYear)}` : "date not recorded";
      // Rereads: "· first read", "· second read" on each copy. A book with a read count but only
      // one copy (e.g. from a manual Goodreads export) says "· read twice" instead.
      if (book.readNumber) dateText += ` · ${ordinal(book.readNumber)} read`;
      else if (book.readCount > 1) dateText += ` · read ${timesInWords(book.readCount)}`;
      book.dateLine.textContent = dateText;
      list.append(book.item);
    }

    section.append(label, list);
    return section;
  });

  $("#shelf").replaceChildren(...sections);
}

// Fills in the numbers in the stats pop-up. Called once at startup with every book, so these are all-time numbers.
// Each book counts once, however many times it was read.
function renderStats(allReads) {
  const books = uniqueBooks(allReads);
  const rated = books.filter((b) => b.rating > 0); // unrated books shouldn't drag the average to 0
  const pages = books.reduce((sum, b) => sum + (b.pages || 0), 0);
  const average = rated.length ? (rated.reduce((sum, b) => sum + b.rating, 0) / rated.length).toFixed(1) : "–";

  $("#stat-books").textContent = books.length.toLocaleString();
  $("#stat-pages").textContent = pages.toLocaleString();
  $("#stat-authors").textContent = new Set(books.map((b) => b.author)).size.toLocaleString();
  $("#stat-rating").textContent = rated.length ? `${average} of 5` : average;
  $("#stat-loved").textContent = books.filter((b) => b.rating === 5).length.toLocaleString();
}

function renderStatus(visible) {
  const total = state.books.length;
  let text = visible.length === total ? plural(total, "book") : `Showing ${visible.length} of ${plural(total, "book")}`;
  if (state.year === NO_DATE) text += ", undated";
  else if (state.year !== null) text += `, read in ${state.year}`;
  if (!visible.length) text = "No books match.";

  $("#status").textContent = text;
  $("#clear-filters").hidden = !(state.query || state.minRating || state.year !== null);
}

// The chart is built once from all books; render() only updates which bar is selected.
function buildChart() {
  const chart = $("#chart");
  const counts = new Map();
  for (const book of state.books) {
    const key = yearRead(book);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  if (!counts.size) return;

  // Every year from first to last, including years with zero books, so gaps are visible.
  const years = [...counts.keys()].filter((key) => key !== NO_DATE);
  const keys = [];
  if (years.length) {
    for (let y = Math.min(...years); y <= Math.max(...years); y++) keys.push(y);
  }
  if (counts.has(NO_DATE)) keys.push(NO_DATE);

  const max = Math.max(...counts.values());
  for (const key of keys) {
    const count = counts.get(key) || 0;
    const label = key === NO_DATE ? "?" : `’${String(key).slice(2)}`; // 2023 -> ’23, to keep the bars narrow

    const bar = el("button", "bar");
    bar.type = "button";
    bar.dataset.year = key;
    bar.disabled = count === 0;
    bar.style.setProperty("--value", count / max); // CSS turns this into the bar height
    bar.setAttribute("aria-pressed", "false");
    bar.setAttribute("aria-label", `${key === NO_DATE ? "No date" : key}: ${plural(count, "book")}`);
    bar.title = bar.getAttribute("aria-label"); // tooltip on hover
    bar.append(el("span", "bar-fill"), el("span", "bar-label", label));

    bar.addEventListener("click", () => {
      state.year = state.year === key ? null : key; // click the selected year again to clear it
      $("#stats").close(); // close the pop-up so you see the filtered books straight away
      render();
    });
    chart.append(bar);
  }
}

function updateChartSelection() {
  const chart = $("#chart");
  chart.classList.toggle("has-selection", state.year !== null);
  for (const bar of chart.querySelectorAll(".bar")) {
    bar.setAttribute("aria-pressed", String(bar.dataset.year === String(state.year)));
  }
}

// Books on the currently-reading shelf, each with a small cover. Built once at startup.
function renderReading() {
  const items = state.reading.map((book) => {
    const button = el("button", "mini-book");
    button.type = "button";
    const text = el("span");
    text.append(el("span", "mini-title", book.title), el("span", "author", book.author));
    const cover = createCover(book);
    button.append(cover, text);
    button.addEventListener("click", () => openDetail(book, cover)); // the cover glides from here
    const li = el("li");
    li.append(button);
    return li;
  });
  $("#reading-list").replaceChildren(...items);
  $("#reading-entry").hidden = !items.length;
}

// ---------- The library card in the book pop-up ----------

const BORROWER = "Elina";
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const INKS = ["#5a3f9e", "#2b2b2b", "#3d5a8a", "#1f7a7a"]; // old stamp-pad colours
const CARD_ROWS = 6;

// A date the way a library stamp prints it: Aug 13 '25
const stampDate = (d) => `${MONTHS[d.getMonth()]} ${d.getDate()} '${String(d.getFullYear()).slice(2)}`;

// A stamped date: bold, slightly crooked (a different tilt per row), in one of the ink colours
function createStamp(text, i) {
  const stamp = el("span", "stamp", text);
  stamp.style.color = INKS[i % INKS.length];
  stamp.style.transform = `rotate(${(((i * 37) % 7) - 3) * 0.7}deg)`;
  return stamp;
}

// A made-up but consistent library call number, like "823.47 / K311r":
// a number from the Book Id, then the author's initial, three digits and the title's initial.
function callNumber(book) {
  const h = hashText(book.id || book.title);
  const title = book.title.replace(/^(the|a|an)\s+/i, "");
  return `${800 + (h % 100)}.${String((h * 7) % 100).padStart(2, "0")}\n`
    + `${(book.authorSort || book.author)[0] || "X"}${100 + ((h * 13) % 900)}${(title[0] || "x").toLowerCase()}`;
}

// Fill in the card: one row for every time I read this book (rereads included), oldest first:
// my name, handwritten, and the day I finished it, stamped. A book I'm reading now gets my name
// and no return stamp yet.
function renderLibraryCard(book) {
  $("#card-callno").textContent = callNumber(book);
  $("#card-author").textContent = book.author;
  $("#card-title").textContent = book.title;

  const reads = book.shelf === "currently-reading"
    ? []
    : state.books.filter((b) => (book.id ? b.id === book.id : b === book)).sort((a, b) => time(a.dateRead) - time(b.dateRead));
  const returned = reads.map((r) => (r.dateRead ? stampDate(r.dateRead) : ""));
  if (book.shelf === "currently-reading") returned.push(""); // borrowed, not returned yet

  const rows = [];
  for (let i = 0; i < Math.max(CARD_ROWS, returned.length); i++) {
    const tr = el("tr");
    const name = el("td"), back = el("td");
    if (i < returned.length) {
      name.append(el("span", "hand", BORROWER));
      if (returned[i]) back.append(createStamp(returned[i], i));
    } // rows after the last read stay as empty ruled lines
    tr.append(name, back);
    rows.push(tr);
  }
  $("#card-rows").replaceChildren(...rows);
}

// ---------- Library card sound ----------
// A page-turning sound (sounds/page-turn.mp3, from Freesound/Pixabay, free to use) plays when someone
// takes the card out or tucks it back in. Tucking it in plays it a little faster and higher, so the
// two directions sound slightly different. Only played when someone clicks the card or the book,
// never by itself (e.g. not when the pop-up closes).
//
// It's played with the Web Audio API rather than an <audio> element, because that starts instantly.
// The recording begins with a third of a second of silence, so playback skips straight past it.
const CARD_SOUND_VOLUME = 0.6;  // 0 = silent, 1 = full volume
const CARD_SOUND_START = 0.32;  // seconds of silence at the start of the file to skip

// Download the file as soon as the page loads, so it's ready before anyone clicks
const cardSoundFile = fetch("sounds/page-turn.mp3").then((r) => r.arrayBuffer()).catch(() => null);
let audioCtx = null;      // the browser's sound system, created on the first click (browsers require that)
let cardSoundBuffer = null; // the decoded sound, ready to play

// Get the sound system and the decoded sound ready. Called when a book is opened, so that by the
// time someone clicks the card there's nothing left to prepare.
async function prepareCardSound() {
  try {
    audioCtx ??= new AudioContext();
    if (audioCtx.state === "suspended") await audioCtx.resume();
    if (!cardSoundBuffer) {
      const data = await cardSoundFile;
      if (data) cardSoundBuffer = await audioCtx.decodeAudioData(data.slice(0)); // slice: decode a copy
    }
  } catch {
    // No Web Audio, or the file couldn't be loaded: no sound
  }
}

async function playCardSound(goingOut) {
  if (!CARD_SOUND_VOLUME) return;
  if (!cardSoundBuffer) await prepareCardSound();
  if (!cardSoundBuffer) return;
  // Every play is a fresh "source", so a quick second click plays over the first instead of cutting it off
  const source = audioCtx.createBufferSource();
  source.buffer = cardSoundBuffer;
  source.playbackRate.value = goingOut ? 1 : 1.25;
  const volume = audioCtx.createGain();
  volume.gain.value = CARD_SOUND_VOLUME;
  source.connect(volume).connect(audioCtx.destination);
  source.start(0, CARD_SOUND_START); // start now, from just after the silence
}

// Take the card out (the book slides down to show all of it) or tuck it back in.
// --card-h tells the CSS how far to move the book: the card's own height.
function toggleLibraryCard(open) {
  const left = $("#detail-left");
  const card = $("#library-card");
  const isOpen = open ?? !left.classList.contains("card-open");
  left.style.setProperty("--card-h", `${card.offsetHeight}px`);
  left.classList.toggle("card-open", isOpen);
  card.setAttribute("aria-expanded", String(isOpen));
}

// ---------- Opening and closing the book pop-up ----------
// The cover you clicked glides from the shelf to its place in the pop-up, and back again on close.
// This uses the "FLIP" trick: show the pop-up, measure where the cover was and where it is now,
// then animate it from the old spot to the new one with the Web Animations API (element.animate).

const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
const GLIDE = { duration: 550, easing: "cubic-bezier(0.2, 0.7, 0.2, 1)" };
// How long the card takes to slide back behind the book before the cover glides home (matches
// style.css). If the card was taken out, the book also has to slide back up over it, which takes longer.
const LEAVE_MS = 600; // long enough for the photo to swing back in (0.55s in style.css)
const LEAVE_CARD_OUT_MS = 600;
let openedFrom = null; // the cover on the shelf this pop-up was opened from
let closing = false;

// Animate the big cover between the shelf cover's position and its own. reverse = glide back.
function glideCover(from, reverse) {
  const target = $("#detail-cover");
  const a = from.getBoundingClientRect();
  const b = target.getBoundingClientRect();
  if (!a.width || !b.width) return null;
  const onShelf = `translate(${a.left - b.left}px, ${a.top - b.top}px) scale(${a.width / b.width}, ${a.height / b.height})`;
  const frames = [{ transform: onShelf }, { transform: "none" }];
  // The closing glide holds its end position until the pop-up closes; the opening one lets go
  return target.animate(reverse ? frames.reverse() : frames, { ...GLIDE, fill: reverse ? "forwards" : "none" });
}

// Fade the pop-up's page colour in (or out), so the shelf shows through while the cover moves
function fadeBackground(detail, reverse) {
  const frames = [{ backgroundColor: "transparent" }, { backgroundColor: getComputedStyle(detail).backgroundColor }];
  return detail.animate(reverse ? frames.reverse() : frames, { duration: 450, easing: "ease", fill: "forwards" });
}

// After the book pop-up has closed: put the shelf cover back, tuck the card in, and clear the
// finished animations so the next book starts fresh. Safe to run more than once.
function tidyDetail() {
  const detail = $("#detail");
  toggleLibraryCard(false);
  detail.classList.remove("is-leaving", "is-gliding");
  if (openedFrom) openedFrom.style.visibility = "";
  openedFrom = null;
  for (const animation of detail.getAnimations({ subtree: true })) {
    if (!(animation instanceof CSSAnimation)) animation.cancel();
  }
}

function closeDetail() {
  const detail = $("#detail");
  if (!detail.open || closing) return;
  closing = true;
  const finish = () => {
    if (!closing) return; // already finished (finish can be called twice, see below)
    detail.close();
    tidyDetail();
    closing = false;
  };
  const canGlide = openedFrom && openedFrom.isConnected && !reduceMotion.matches;
  if (!canGlide) {
    if (reduceMotion.matches) finish();
    else detail.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 250, fill: "forwards" }).finished.then(finish);
    return;
  }
  // If the card is out, the book slides back up over it first, so it lands exactly on its shelf spot
  const cardWasOut = $("#detail-left").classList.contains("card-open");
  toggleLibraryCard(false);
  // First the details and the × fade out and the library card slides back down behind the book
  // (the "is-leaving" class, see style.css) while the cover stays put. Only then does the cover
  // glide back onto the shelf; moving it straight away would uncover the card on its way in.
  detail.classList.add("is-leaving");
  setTimeout(() => {
    detail.classList.add("is-gliding"); // the card is hidden behind the cover now; make it invisible
    const glide = glideCover(openedFrom, true);
    fadeBackground(detail, true);
    // Close when the glide reports it's finished, or after its duration anyway. Browsers don't
    // always report it (e.g. when the tab is in the background), and without this safety net
    // the faded, invisible pop-up could stay open on top of the page.
    if (glide) glide.finished.then(finish, finish);
    setTimeout(finish, GLIDE.duration + 50);
  }, cardWasOut ? LEAVE_CARD_OUT_MS : LEAVE_MS);
}

// ---------- The photo tucked in the book ----------
// A ragged outline for a torn photo or scrap of paper, as a CSS clip-path polygon.
// It walks round the four edges in small steps, nudging each point in or out by a random amount;
// one edge (the "torn" one) gets much bigger jags than the others. The randomness comes from the
// Book Id (seed), so a book's photo is always torn the same way, but differently from other books.
function tornOutline(seed, tornEdge, roughness) {
  let n = seed || 1;
  const random = () => ((n = (n * 9301 + 49297) % 233280) / 233280); // simple repeatable "random"
  const edges = [
    (t) => [t, 0],     // top: left to right
    (t) => [100, t],   // right: top to bottom
    (t) => [100 - t, 100], // bottom: right to left
    (t) => [0, 100 - t],   // left: bottom to top
  ];
  const points = [];
  edges.forEach((edge, i) => {
    const jag = i === tornEdge ? roughness : roughness / 4;
    for (let t = 0; t < 100; t += 4 + random() * 4) {
      const [x, y] = edge(t);
      const inward = random() * jag;
      // push the point inwards, away from the edge it's on
      const px = i === 1 ? x - inward : i === 3 ? x + inward : x;
      const py = i === 0 ? y + inward : i === 2 ? y - inward : y;
      points.push(`${px.toFixed(1)}% ${py.toFixed(1)}%`);
    }
  });
  return `polygon(${points.join(", ")})`;
}

// Show photos/<Book Id>.jpg behind the cover if it exists; hide the photo otherwise.
function renderPhoto(book) {
  const slip = $("#photo-slip");
  const left = $("#detail-left");
  const img = $("#detail-photo");
  slip.hidden = true;
  left.classList.remove("has-photo");
  if (!book.id) return;
  const seed = hashText(book.id);
  slip.style.setProperty("--torn", tornOutline(seed, seed % 4, 4));
  slip.style.setProperty("--paper-torn", tornOutline(seed + 7, (seed + 2) % 4, 5));
  img.onload = () => {
    slip.hidden = false;
    left.classList.add("has-photo");
  };
  img.onerror = () => {}; // no photo for this book: nothing slides out
  img.src = `photos/${encodeURIComponent(book.id)}.jpg`;
}

function openDetail(book, from = null) {
  prepareCardSound(); // clicking a book counts as permission to play sound, so get it ready now
  $("#detail-cover").replaceChildren(createPageStack(book));
  renderLibraryCard(book);
  renderPhoto(book);
  // The small label above the title
  $("#detail-eyebrow").textContent = book.shelf === "currently-reading"
    ? "Reading now"
    : book.dateRead ? `Read in ${book.dateRead.getFullYear()}` : "Date not recorded";
  $("#detail-title").textContent = book.title;
  $("#detail-author").textContent = book.author;
  $("#detail-rating").replaceChildren(createDots(book.rating));
  $("#detail-read").textContent = book.shelf === "currently-reading"
    ? "still reading"
    : book.dateRead ? longDate(book.dateRead) : "not recorded";
  let times = timesInWords(book.readCount);
  if (book.readNumber) times += ` (this was the ${ordinal(book.readNumber)})`;
  $("#detail-times").textContent = book.shelf === "currently-reading" ? "reading now" : times;
  $("#detail-pages").textContent = book.pages ? book.pages.toLocaleString() : "unknown";
  // Very old books have negative years in Goodreads (-600 means 600 BC)
  $("#detail-year").textContent = !book.year ? "unknown" : book.year < 0 ? `${-book.year} BC` : book.year;

  // A favourite passage, if there is one. A last line starting with a dash ("— p. 42") is shown
  // separately, as a small note saying where the passage is from.
  const lines = book.excerpt.split("\n");
  const cite = /^[—–-]/.test(lines.at(-1).trim()) && lines.length > 1 ? lines.pop().trim() : "";
  $("#detail-excerpt").textContent = lines.join("\n").trim();
  $("#detail-excerpt-cite").textContent = cite;
  $("#excerpt-section").hidden = !book.excerpt; // no passage: show nothing at all

  const review = $("#detail-review");
  review.textContent = book.review || "Nothing written yet.";
  review.classList.toggle("empty", !book.review);

  // Opening the pop-up also replays its CSS animations (the text drifting up, the card sliding out)
  const detail = $("#detail");
  detail.showModal();
  detail.scrollTop = 0; // always start at the top, even if the last book was scrolled down

  // The cover glides in from the shelf, and the shelf copy is hidden so it looks like it was lifted off
  openedFrom = from;
  if (from && !reduceMotion.matches) {
    from.style.visibility = "hidden";
    glideCover(from, false);
    fadeBackground(detail, false);
  }
}

function showLoadError(error) {
  const status = $("#status");
  const hint = location.protocol === "file:"
    ? "Browsers block fetch() on pages opened straight from a file. Start a local server (see README.md) and open http://localhost:8000."
    : "Check that goodreads.csv sits next to index.html.";
  status.textContent = `Couldn't load your books (${error.message}). ${hint}`;
  status.classList.add("error");
  console.error(error);
}

// ---------- 6. Wiring it all together ----------

function wireControls() {
  $("#search").addEventListener("input", (event) => {
    state.query = event.target.value;
    render();
  });
  $("#sort").addEventListener("change", (event) => {
    state.sort = event.target.value;
    render();
  });
  $("#min-rating").addEventListener("change", (event) => {
    state.minRating = Number(event.target.value);
    render();
  });
  $("#clear-filters").addEventListener("click", () => {
    state.query = "";
    state.minRating = 0;
    state.year = null;
    $("#search").value = "";
    $("#min-rating").value = "0";
    render();
  });

  $("#open-stats").addEventListener("click", () => {
    $("#stats").showModal();
    const chart = $("#chart");
    chart.scrollLeft = chart.scrollWidth; // if there are many years, start scrolled to the latest
  });

  // Close a pop-up when the backdrop around it is clicked (the book pop-up closes with its glide)
  for (const dialog of document.querySelectorAll("dialog")) {
    dialog.addEventListener("click", (event) => {
      if (event.target !== dialog) return;
      if (dialog.id === "detail") closeDetail();
      else dialog.close();
    });
  }

  // The library card: click it (or press Enter / Space on it) to take it out or tuck it back in.
  // Clicking the book while the card is out also tucks it back in.
  const card = $("#library-card");
  // Each of these also plays the page sound.
  const flipCard = () => {
    const goingOut = !$("#detail-left").classList.contains("card-open");
    toggleLibraryCard(goingOut);
    playCardSound(goingOut);
  };
  card.addEventListener("click", flipCard);
  card.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      flipCard();
    }
  });
  $("#detail-cover").addEventListener("click", () => {
    if ($("#detail-left").classList.contains("card-open")) flipCard();
  });

  // The book pop-up's × button, and the Esc key (which would otherwise close it instantly)
  const detail = $("#detail");
  $("#detail-close").addEventListener("click", closeDetail);
  detail.addEventListener("cancel", (event) => {
    event.preventDefault();
    closeDetail();
  });

  // Once the book pop-up has closed: put the shelf cover back and clear the finished animations,
  // so the next book starts fresh
  detail.addEventListener("close", tidyDetail); // a backup, in case it closes some other way
}

async function init() {
  let allBooks;
  try {
    allBooks = await loadBooks();
  } catch (error) {
    showLoadError(error);
    return;
  }
  state.books = allBooks.filter((b) => b.shelf === "read");
  numberReads(state.books);
  state.reading = allBooks.filter((b) => b.shelf === "currently-reading");

  wireControls();
  renderStats(state.books);
  renderReading();
  buildChart();
  render();
}

init();
