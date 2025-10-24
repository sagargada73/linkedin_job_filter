// LinkedIn Job Filter Extension
console.log("LinkedIn Job Filter Extension loaded! 🎯");

// Check if we're on a jobs page
function isOnJobsPage() {
  return location.href.includes("/jobs");
}

// Diagnostic function to discover LinkedIn's current DOM structure
function diagnosticScan() {
  console.log("🔍 DIAGNOSTIC SCAN - Looking for job elements...");

  // Try to find ANY list items
  const allLis = document.querySelectorAll("li");
  console.log(`Found ${allLis.length} total <li> elements on page`);

  // Look for elements with job-related data attributes
  const jobIdElements = document.querySelectorAll("[data-job-id]");
  const occludableElements = document.querySelectorAll(
    "[data-occludable-job-id]"
  );
  const cardElements = document.querySelectorAll("[class*='job']");

  console.log(`Elements with data-job-id: ${jobIdElements.length}`);
  console.log(
    `Elements with data-occludable-job-id: ${occludableElements.length}`
  );
  console.log(`Elements with 'job' in class: ${cardElements.length}`);

  // Sample the first few elements
  if (jobIdElements.length > 0) {
    console.log("Sample element with data-job-id:", jobIdElements[0]);
    console.log("Its classes:", jobIdElements[0].className);
  }

  if (occludableElements.length > 0) {
    console.log(
      "Sample element with data-occludable-job-id:",
      occludableElements[0]
    );
    console.log("Its classes:", occludableElements[0].className);
  }

  // Look for the jobs list container
  const possibleContainers = [
    ".jobs-search-results-list",
    ".scaffold-layout__list",
    ".jobs-search__results-list",
    "[class*='jobs-search']",
  ];

  possibleContainers.forEach((selector) => {
    const container = document.querySelector(selector);
    if (container) {
      console.log(`✅ Found container: ${selector}`);
      console.log("Container's children count:", container.children.length);
      if (container.children.length > 0) {
        console.log("First child:", container.children[0]);
        console.log("First child classes:", container.children[0].className);
      }
    }
  });
}

// Keep track of processed job cards to avoid reprocessing
let processedJobs = new WeakSet();

// Default settings - all filters enabled
let filterSettings = {
  hideApplied: true,
  hideReposted: true,
  hidePromoted: true,
};

// Load saved settings from storage
chrome.storage.sync.get(["filterSettings"], function (result) {
  if (result.filterSettings) {
    filterSettings = result.filterSettings;
  }
  console.log("Filter settings loaded:", filterSettings);
  // Don't apply filters immediately - let waitForJobsToLoad() handle it
});

// Listen for settings changes from popup
chrome.runtime.onMessage.addListener(function (request, sender, sendResponse) {
  console.log("📩 Message received:", request);

  try {
    if (request.action === "updateSettings") {
      const oldSettings = { ...filterSettings };
      filterSettings = request.settings;

      console.log(
        "🔄 Settings updated from:",
        oldSettings,
        "to:",
        filterSettings
      );

      // Log which settings changed
      if (oldSettings.hideApplied !== filterSettings.hideApplied) {
        console.log(
          `🔄 Hide Applied Jobs: ${filterSettings.hideApplied ? "ON" : "OFF"}`
        );
      }
      if (oldSettings.hidePromoted !== filterSettings.hidePromoted) {
        console.log(
          `🔄 Hide Promoted Jobs: ${filterSettings.hidePromoted ? "ON" : "OFF"}`
        );
      }
      if (oldSettings.hideReposted !== filterSettings.hideReposted) {
        console.log(
          `🔄 Hide Reposted Jobs: ${filterSettings.hideReposted ? "ON" : "OFF"}`
        );
      }

      // Clear the processed jobs WeakSet to allow reprocessing
      processedJobs = new WeakSet();
      console.log("🗑️ Cleared processed jobs WeakSet");

      // Get all job cards
      const allJobCards = document.querySelectorAll(`
        .job-card-container,
        .jobs-search-results__list-item,
        .scaffold-layout__list-item,
        li[data-occludable-job-id],
        .jobs-search-results-list__list-item,
        [data-job-id],
        .job-card-list__entity-lockup,
        div.job-card-container
      `);

      console.log(`📋 Found ${allJobCards.length} job cards to reprocess`);

      // Reset all job cards completely
      let resetCount = 0;
      allJobCards.forEach((card) => {
        card.removeAttribute("data-filtered");
        card.removeAttribute("data-hidden-by-filter");
        card.style.removeProperty("display");
        resetCount++;
      });

      console.log(`🔄 Reset ${resetCount} job cards`);

      // Reprocess all job cards
      let hiddenCount = 0;
      let visibleCount = 0;

      allJobCards.forEach((card) => {
        const wasShouldHide = shouldHideJob(card);
        filterJobCard(card);

        if (wasShouldHide) {
          hiddenCount++;
        } else {
          visibleCount++;
        }
      });

      console.log(
        `✅ Re-filtering complete: ${hiddenCount} hidden, ${visibleCount} visible`
      );

      sendResponse({ success: true });
    }
  } catch (error) {
    console.error("❌ Error handling message:", error);
    sendResponse({ success: false, error: error.message });
  }

  return true; // Keep the message channel open for async response
});

// Function to check if a job card should be hidden
function shouldHideJob(jobCard) {
  // Safety check
  if (!jobCard || !jobCard.textContent) {
    return false;
  }

  // Get the text content of the entire card
  const cardText = jobCard.textContent || "";

  // Check for "Applied" status
  if (filterSettings.hideApplied) {
    // Multiple selectors for Applied status (LinkedIn changes these)
    const appliedSelectors = [
      ".job-card-container__footer-job-state",
      ".artdeco-inline-feedback",
      '[data-job-state="APPLIED"]',
    ];

    for (let selector of appliedSelectors) {
      const appliedElement = jobCard.querySelector(selector);
      if (appliedElement && appliedElement.textContent.includes("Applied")) {
        return true;
      }
    }

    // Fallback: check entire card text
    if (cardText.includes("Applied") && cardText.includes("ago")) {
      return true;
    }
  }

  // Check for "Promoted" status
  if (filterSettings.hidePromoted) {
    if (
      cardText.includes("Promoted") ||
      cardText.includes("Sponsored") ||
      jobCard.querySelector('[data-promoted="true"]')
    ) {
      return true;
    }
  }

  // Check for "Reposted"
  if (filterSettings.hideReposted) {
    if (
      cardText.includes("Reposted") ||
      jobCard.getAttribute("data-reposted") === "true"
    ) {
      return true;
    }
  }

  return false;
}

// Function to check if job detail contains "Reposted"
function checkJobDetailsForReposted() {
  const jobDetails = document.querySelector(
    ".job-details-jobs-unified-top-card__primary-description-container"
  );
  if (jobDetails) {
    const repostedText = jobDetails.textContent;
    if (repostedText.includes("Reposted")) {
      // Mark the currently active job card as reposted
      const activeJobCard = document.querySelector(
        ".jobs-search-results-list__list-item--active"
      );
      if (activeJobCard) {
        activeJobCard.setAttribute("data-reposted", "true");
        if (filterSettings.hideReposted) {
          activeJobCard.style.setProperty("display", "none", "important");
        }
      }
    }
  }
}

// Function to filter a single job card
function filterJobCard(jobCard) {
  // Skip if already processed
  if (processedJobs.has(jobCard) || jobCard.hasAttribute("data-filtered")) {
    return;
  }

  // Mark as processed immediately to prevent reprocessing
  processedJobs.add(jobCard);
  jobCard.setAttribute("data-filtered", "true");

  // Check if should be hidden
  if (shouldHideJob(jobCard)) {
    jobCard.style.setProperty("display", "none", "important");
    jobCard.setAttribute("data-hidden-by-filter", "true");
  } else {
    jobCard.style.removeProperty("display");
    jobCard.removeAttribute("data-hidden-by-filter");
  }
}

// Function to apply filters to all job cards
function applyFilters() {
  try {
    // Multiple selectors to handle LinkedIn's changing DOM
    const selectors = [
      ".job-card-container",
      ".jobs-search-results__list-item",
      ".scaffold-layout__list-item",
      "li[data-occludable-job-id]",
      ".jobs-search-results-list__list-item",
      "[data-job-id]", // Any element with job ID
      ".job-card-list__entity-lockup", // New LinkedIn layout
      "div.job-card-container", // Specific div job cards
    ];

    let allJobCards = [];

    // Try each selector and collect all job cards
    selectors.forEach((selector) => {
      try {
        const cards = document.querySelectorAll(selector);
        cards.forEach((card) => {
          // Avoid duplicates and skip skeleton elements
          if (
            !allJobCards.includes(card) &&
            !card.classList.contains(
              "jobs-list-skeleton__artdeco-card--no-top-right-radius"
            )
          ) {
            allJobCards.push(card);
          }
        });
      } catch (error) {
        console.log(`Error with selector ${selector}:`, error);
      }
    });

    console.log(
      `Found ${allJobCards.length} job cards using multiple selectors`
    );

    if (allJobCards.length === 0) {
      console.warn(
        "⚠️ No job cards found. The page might still be loading or LinkedIn's structure changed."
      );
      console.log(
        "Tip: Make sure you're on https://www.linkedin.com/jobs/search/ with actual job listings visible"
      );
      return;
    }

    // Clear processed jobs set and data-filtered attributes for fresh filtering
    allJobCards.forEach((card) => {
      processedJobs.delete(card);
      card.removeAttribute("data-filtered");
    });

    allJobCards.forEach((jobCard) => {
      filterJobCard(jobCard);
    });

    // Also check job details for reposted status
    checkJobDetailsForReposted();
  } catch (error) {
    console.error("Error in applyFilters:", error);
  }
}

// Watch for new job cards being added to the page
const observer = new MutationObserver((mutations) => {
  let shouldReapply = false;

  mutations.forEach((mutation) => {
    mutation.addedNodes.forEach((node) => {
      // Skip text nodes
      if (!node.classList && !node.querySelectorAll) return;

      // Check if the node itself is a job card (multiple class checks)
      const isJobCard =
        node.classList &&
        (node.classList.contains("job-card-container") ||
          node.classList.contains("jobs-search-results__list-item") ||
          node.classList.contains("scaffold-layout__list-item") ||
          node.classList.contains("jobs-search-results-list__list-item") ||
          node.hasAttribute("data-occludable-job-id"));

      if (isJobCard) {
        filterJobCard(node);
      }

      // If the added node contains job cards
      if (node.querySelectorAll) {
        const selectors = [
          ".job-card-container",
          ".jobs-search-results__list-item",
          ".scaffold-layout__list-item",
          "li[data-occludable-job-id]",
          ".jobs-search-results-list__list-item",
        ];

        selectors.forEach((selector) => {
          const jobCards = node.querySelectorAll(selector);
          if (jobCards.length > 0) {
            jobCards.forEach((jobCard) => filterJobCard(jobCard));
          }
        });

        // Check if job details were added (for reposted check)
        const jobDetails = node.querySelector(
          ".job-details-jobs-unified-top-card__primary-description-container"
        );
        if (jobDetails) {
          checkJobDetailsForReposted();
        }
      }
    });
  });
});

// Start observing the document for changes
if (document.body) {
  observer.observe(document.body, {
    childList: true,
    subtree: true,
  });
}

// Don't apply filters immediately - wait for jobs to load first
// applyFilters() will be called by waitForJobsToLoad()

// Periodically recheck for any jobs that slipped through
setInterval(() => {
  const selectors = [
    ".job-card-container:not([data-filtered])",
    ".jobs-search-results__list-item:not([data-filtered])",
    ".scaffold-layout__list-item:not([data-filtered])",
    "li[data-occludable-job-id]:not([data-filtered])",
    ".jobs-search-results-list__list-item:not([data-filtered])",
  ];

  let unprocessedJobs = [];
  selectors.forEach((selector) => {
    const jobs = document.querySelectorAll(selector);
    jobs.forEach((job) => {
      // Skip skeleton elements and already included jobs
      if (
        !unprocessedJobs.includes(job) &&
        !job.classList.contains(
          "jobs-list-skeleton__artdeco-card--no-top-right-radius"
        ) &&
        !processedJobs.has(job)
      ) {
        unprocessedJobs.push(job);
      }
    });
  });

  if (unprocessedJobs.length > 0) {
    // Only log if it's a significant number (avoids spam)
    if (unprocessedJobs.length > 5) {
      console.log(
        `Found ${unprocessedJobs.length} unprocessed jobs, filtering...`
      );
    }
    unprocessedJobs.forEach((jobCard) => filterJobCard(jobCard));
  }
}, 2000); // Check every 2 seconds (reduced frequency)

console.log("LinkedIn Job Filter Extension activated! ✨");

// Function to wait for jobs to load (skeleton replacements)
function waitForJobsToLoad() {
  let attempts = 0;
  const maxAttempts = 20; // Try for 20 seconds

  const checkInterval = setInterval(() => {
    attempts++;

    // Check if skeleton is gone and real jobs are present
    const skeleton = document.querySelector(
      ".jobs-list-skeleton__artdeco-card--no-top-right-radius"
    );
    const hasJobIds =
      document.querySelectorAll("[data-occludable-job-id]").length > 0;
    const hasJobCards =
      document.querySelectorAll('[class*="job-card"]').length > 0;

    if ((hasJobIds || hasJobCards) && !skeleton) {
      console.log("✅ Jobs loaded! Starting filter...");
      clearInterval(checkInterval);
      applyFilters();
      return;
    }

    if (attempts >= maxAttempts) {
      console.log(
        "⚠️ Timeout waiting for jobs to load. Trying to filter anyway..."
      );
      clearInterval(checkInterval);
      applyFilters();
    } else {
      console.log(
        `⏳ Waiting for jobs to load... (attempt ${attempts}/${maxAttempts})`
      );
    }
  }, 1000);
}

// Start waiting for jobs to load (only if on jobs page)
if (isOnJobsPage()) {
  console.log("📍 On jobs page, starting filter initialization...");
  waitForJobsToLoad();
} else {
  console.log("📍 Not on jobs page yet, waiting for navigation...");
}

// Detect URL changes (for when user navigates from feed to jobs without refresh)
let lastUrl = location.href;
new MutationObserver(() => {
  const currentUrl = location.href;
  if (currentUrl !== lastUrl) {
    lastUrl = currentUrl;

    // Check if navigated to jobs page
    if (currentUrl.includes("/jobs")) {
      console.log("🔄 Navigated to jobs page, re-initializing filters...");

      // Wait a moment for the page to render, then apply filters
      setTimeout(() => {
        waitForJobsToLoad();
      }, 1000);
    }
  }
}).observe(document, { subtree: true, childList: true });

console.log(
  "🔍 URL change detection active - extension will auto-activate on jobs page"
);

// Diagnostic scan - uncomment if needed for debugging
// setTimeout(() => {
//   diagnosticScan();
// }, 2000);

// Also run diagnostic when user clicks anywhere (helps if page loads slowly)
// document.addEventListener(
//   "click",
//   function runOnce() {
//     setTimeout(diagnosticScan, 500);
//     document.removeEventListener("click", runOnce);
//   },
//   { once: true }
// );
