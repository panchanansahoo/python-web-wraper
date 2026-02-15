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

    const poll = () => {
      chrome.tabs.get(tabId, (tab) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }

        if (tab.status === "complete") {
          resolve();
          return;
        }

        if (Date.now() - start > timeoutMs) {
          reject(new Error("Timed out waiting for page load."));
          return;
        }

        setTimeout(poll, 250);
      });
    };

    poll();
  });
}

function executeExtraction(tabId) {
  return new Promise((resolve, reject) => {
    chrome.scripting.executeScript(
      {
        target: { tabId },
        func: () => {
          const clean = (text) => (text || "").replace(/\s+/g, " ").trim();
          const dateRegex = /[A-Za-z]{3}\s+\d{1,2},\s+\d{4}/;

          const isQuestionHref = (href) => {
            if (!href) return false;
            let pathname = href;
            try {
              pathname = new URL(href, location.origin).pathname;
            } catch (_e) {
              // keep original href
            }

            if (!pathname.startsWith("/interview-questions/")) return false;
            if (pathname.includes("/position/")) return false;
            if (pathname.includes("/category/")) return false;
            if (pathname.includes("/company/")) return false;

            const suffix = pathname.replace("/interview-questions/", "");
            return Boolean(suffix) && !suffix.includes("/");
          };

          const cards = Array.from(document.querySelectorAll("div[class*='rounded-lg'], article, li"));
          const rows = [];

          cards.forEach((card) => {
            const questionLink = Array.from(card.querySelectorAll("a[href]"))
              .find((a) => isQuestionHref(a.getAttribute("href")) && clean(a.textContent).length > 8);

            if (!questionLink) return;

            const question = clean(questionLink.textContent);
            if (!question) return;

            const position = clean(
              card.querySelector("a[href*='/interview-questions/position/']")?.textContent
            );
            const category = clean(
              card.querySelector("a[href*='/interview-questions/category/']")?.textContent
            );

            const date = clean(
              card.querySelector("p.text-xs")?.textContent ||
              Array.from(card.querySelectorAll("p,span,div,time"))
                .map((el) => clean(el.textContent))
                .find((t) => dateRegex.test(t))
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
            title: document.title,
            url: location.href
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

      let pageRows = [];
      for (let attempt = 1; attempt <= 5; attempt += 1) {
        await sleep(800);
        setStatus(`Extracting page ${pageNo} (attempt ${attempt}/5)...`);
        const result = await executeExtraction(tabId);
        pageRows = result.rows || [];
        if (pageRows.length > 0) break;
      }

      if (pageRows.length === 0) {
        emptyPages += 1;
        if (emptyPages >= 2) break;
      } else {
        emptyPages = 0;
        allRows.push(...pageRows);
      }

      if (pageNo >= 200) break;
      pageNo += 1;
      await sleep(300);
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
