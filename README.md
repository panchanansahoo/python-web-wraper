# Interview Question Scraper (Chrome Extension)

This extension scrapes all paginated interview questions for a selected company from:

- `https://interviewquestionbank.com/interview-questions`

Then exports everything directly into an Excel file (`.xlsx`) with no manual copy/paste.

## Features

- Scrapes every page (`pageNo`) until no additional rendered interview question cards are found.
- Collects:
  - Sl No
  - Position
  - Category
  - Question
  - Date
- Exports to Excel using SheetJS.
- Pre-filled with company example: **American Express**.

## Install locally

1. Open `chrome://extensions/`.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select this project folder.

## Usage

1. Click the extension icon.
2. Enter a company name (default: `American Express`).
3. Click **Scrape & Export Excel**.
4. The extension will temporarily navigate your active tab through pagination pages and then return it to the original URL.
5. Wait until status shows completion.
6. The Excel file downloads automatically.

## Notes

- The extension requests host access to `https://interviewquestionbank.com/*`.
- Data quality depends on the site markup and interview-question link/card structure.
