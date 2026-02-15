const BASE_URL = "https://interviewquestionbank.com/interview-questions";
const USER_AGENT = "Mozilla/5.0";

const startBtn = document.getElementById("startBtn");
const companyInput = document.getElementById("company");
const statusEl = document.getElementById("status");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function setStatus(message) {
  statusEl.textContent = message;
}

function safeText(node, selector) {
  const element = node.querySelector(selector);
  return element ? element.textContent.trim() : "";
}

function companySlug(company) {
  return company.trim().replace(/\s+/g, "+");
}

function toFilename(company) {
  return `${company.trim().replace(/\s+/g, "_") || "Company"}_Interview_Questions.xlsx`;
}

async function scrapeCompany(company) {
  let page = 1;
  let sl = 1;
  const allData = [];

  while (true) {
    setStatus(`Scraping page ${page}...`);

    const url = `${BASE_URL}?company=${companySlug(company)}&page=${page}`;
    const res = await fetch(url, {
      headers: {
        "User-Agent": USER_AGENT
      }
    });

    if (!res.ok) {
      setStatus(`Stopped: HTTP ${res.status} on page ${page}.`);
      break;
    }

    const html = await res.text();
    const doc = new DOMParser().parseFromString(html, "text/html");
    const cards = doc.querySelectorAll("div.question-card");

    if (cards.length === 0) {
      setStatus("No more pages found.");
      break;
    }

    cards.forEach((card) => {
      const position = safeText(card, "span.position");
      const category = safeText(card, "span.category");
      const question = safeText(card, "div.question-text");
      const date = safeText(card, "span.date");

      allData.push({
        "Sl No": sl,
        Position: position,
        Category: category,
        Question: question,
        Date: date
      });
      sl += 1;
    });

    page += 1;
    await sleep(700);
  }

  return allData;
}

function exportToExcel(rows, filename) {
  const worksheet = XLSX.utils.json_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Questions");
  XLSX.writeFile(workbook, filename);
}

startBtn.addEventListener("click", async () => {
  const company = companyInput.value.trim();
  if (!company) {
    setStatus("Please enter a company name.");
    return;
  }

  startBtn.disabled = true;

  try {
    const rows = await scrapeCompany(company);

    if (rows.length === 0) {
      setStatus("No interview questions found.");
      return;
    }

    const filename = toFilename(company);
    exportToExcel(rows, filename);
    setStatus(`Done! Exported ${rows.length} rows to ${filename}`);
  } catch (error) {
    console.error(error);
    setStatus(`Error: ${error.message}`);
  } finally {
    startBtn.disabled = false;
  }
});
