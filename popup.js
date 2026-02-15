const BASE_URL = "https://interviewquestionbank.com/interview-questions";

const startBtn = document.getElementById("startBtn");
const companyInput = document.getElementById("company");
const statusEl = document.getElementById("status");

function setStatus(message) {
  statusEl.textContent = message;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function companySlug(company) {
  return encodeURIComponent(company.trim());
}

function toFilename(company) {
  return `${company.trim().replace(/\s+/g, "_") || "Company"}_Interview_Questions.xlsx`;
}

function getActiveTab() {
  return new Promise((resolve, reject) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(tabs[0]);
    });
  });
}

function updateTab(tabId, url) {
  return new Promise((resolve, reject) => {
    chrome.tabs.update(tabId, { url }, (tab) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(tab);
    });
  });
}

function waitForTabComplete(tabId, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const start = Date.now();

    const onUpdated = (updatedTabId, info) => {
      if (updatedTabId === tabId && info.status === "complete") {
        chrome.tabs.onUpdated.removeListener(onUpdated);
        resolve();
      } else if (Date.now() - start > timeoutMs) {
        chrome.tabs.onUpdated.removeListener(onUpdated);
        reject(new Error("Timed out waiting for page load."));
      }
    };

    chrome.tabs.onUpdated.addListener(onUpdated);
  });
}

function executeExtraction(tabId) {
  return new Promise((resolve, reject) => {
    chrome.scripting.executeScript(
      {
        target: { tabId },
        func: () => {
          const clean = (text) => (text || "").replace(/\s+/g, " ").trim();

          const isQuestionLink = (href) => {
            if (!href) return false;
            return /^\/interview-questions\/[^/]+$/.test(href);
          };

          const findCard = (questionLink) => {
            return (
              questionLink.closest("div[class*='rounded-lg']") ||
              questionLink.closest("article") ||
              questionLink.parentElement
            );
          };

          const links = Array.from(document.querySelectorAll("a[href^='/interview-questions/']"));
          const questionLinks = links.filter((a) => {
            const href = a.getAttribute("href") || "";
            const txt = clean(a.textContent);
            return isQuestionLink(href) && txt.length > 8;
          });

          const rows = [];

          questionLinks.forEach((questionLink) => {
            const question = clean(questionLink.textContent);
            const card = findCard(questionLink);
            if (!card || !question) return;

            const position = clean(
              card.querySelector("a[href*='/interview-questions/position/']")?.textContent
            );
            const category = clean(
              card.querySelector("a[href*='/interview-questions/category/']")?.textContent
            );
            const date = clean(
              card.querySelector("p.text-xs")?.textContent ||
                Array.from(card.querySelectorAll("p,span,div"))
                  .map((el) => clean(el.textContent))
                  .find((t) => /[A-Za-z]{3}\s+\d{1,2},\s+\d{4}/.test(t))
            );

            rows.push({
              Position: position,
              Category: category,
              Question: question,
              Date: date
            });
          });

          const unique = [];
          const seen = new Set();
          rows.forEach((row) => {
            const key = `${row.Question}|${row.Position}|${row.Category}`.toLowerCase();
            if (!seen.has(key)) {
              seen.add(key);
              unique.push(row);
            }
          });

          return {
            count: unique.length,
            rows: unique,
            title: document.title
          };
        }
      },
      (results) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }

        const value = results?.[0]?.result;
        resolve(value || { count: 0, rows: [] });
      }
    );
  });
}

async function scrapeCompany(company) {
  const activeTab = await getActiveTab();
  if (!activeTab?.id) {
    throw new Error("No active tab available.");
  }

  const originalUrl = activeTab.url;
  const tabId = activeTab.id;

  const allRows = [];
  let pageNo = 1;
  let emptyPages = 0;

  try {
    while (true) {
      const url = `${BASE_URL}?company=${companySlug(company)}&pageNo=${pageNo}`;
      setStatus(`Opening page ${pageNo}...`);

      await updateTab(tabId, url);
      await waitForTabComplete(tabId);
      await sleep(1200);

      setStatus(`Extracting page ${pageNo}...`);
      const result = await executeExtraction(tabId);
      const pageRows = result.rows || [];

      if (pageRows.length === 0) {
        emptyPages += 1;
        if (emptyPages >= 1) break;
      } else {
        emptyPages = 0;
        allRows.push(...pageRows);
      }

      // stop if we've likely reached end
      if (pageNo >= 200) break;
      pageNo += 1;
      await sleep(500);
    }
  } finally {
    if (originalUrl) {
      await updateTab(tabId, originalUrl);
    }
  }

  const deduped = [];
  const seen = new Set();
  allRows.forEach((row) => {
    const key = `${row.Question}|${row.Position}|${row.Category}`.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      deduped.push(row);
    }
  });

  return deduped.map((row, index) => ({ ...row, "Sl No": index + 1 }));
}

function exportToExcel(rows, filename) {
  const worksheet = XLSX.utils.json_to_sheet(rows, {
    header: ["Sl No", "Position", "Category", "Question", "Date"]
  });
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
    setStatus("Starting scraper...");
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
