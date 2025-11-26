// LinkedIn Job Filter Extension
debug.log("LinkedIn Job Filter Extension loaded! 🎯");

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Throttle / backoff configuration to avoid 429s
const SCAN_DELAY_BASE_MS = 1400;          // base delay between card clicks
const SCAN_DELAY_JITTER_MS = 800;         // additional random delay
const SCAN_BATCH_SIZE = 15;                // cards per batch
const SCAN_BATCH_COOLDOWN_MS = 5000;     // cooldown between batches
let consecutiveDetailMisses = 0;

function humanDelayMs() {
  return SCAN_DELAY_BASE_MS + Math.random() * SCAN_DELAY_JITTER_MS;
}

async function pauseIfHidden() {
  while (document.visibilityState === "hidden") {
    await wait(1000);
  }
}

function resetMissCounter() { consecutiveDetailMisses = 0; }

async function maybeBackoff() {
  if (consecutiveDetailMisses >= 3) {
    const backoff = Math.min(60000, 5000 * consecutiveDetailMisses);
    debug.log(`⛔ Suspected throttling, backing off for ${backoff}ms`);
    await wait(backoff);
    consecutiveDetailMisses = 0;
  }
}

// Check if we're on a jobs page
function isOnJobsPage() {
  return location.href.includes("/jobs");
}

// Diagnostic function to discover LinkedIn's current DOM structure
function diagnosticScan() {
  debug.log("🔍 DIAGNOSTIC SCAN - Looking for job elements...");

  // Try to find ANY list items
  const allLis = document.querySelectorAll("li");
  debug.log(`Found ${allLis.length} total <li> elements on page`);

  // Look for elements with job-related data attributes
  const jobIdElements = document.querySelectorAll("[data-job-id]");
  const occludableElements = document.querySelectorAll(
    "[data-occludable-job-id]"
  );
  const cardElements = document.querySelectorAll("[class*='job']");

  debug.log(`Elements with data-job-id: ${jobIdElements.length}`);
  debug.log(
    `Elements with data-occludable-job-id: ${occludableElements.length}`
  );
  debug.log(`Elements with 'job' in class: ${cardElements.length}`);

  // Sample the first few elements
  if (jobIdElements.length > 0) {
    debug.log("Sample element with data-job-id:", jobIdElements[0]);
    debug.log("Its classes:", jobIdElements[0].className);
  }

  if (occludableElements.length > 0) {
    debug.log(
      "Sample element with data-occludable-job-id:",
      occludableElements[0]
    );
    debug.log("Its classes:", occludableElements[0].className);
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
      debug.log(`✅ Found container: ${selector}`);
      debug.log("Container's children count:", container.children.length);
      if (container.children.length > 0) {
        debug.log("First child:", container.children[0]);
        debug.log("First child classes:", container.children[0].className);
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
  debug.log("Filter settings loaded:", filterSettings);
});

// Listen to storage changes to update filterSettings in real-time
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === 'sync' && changes.filterSettings) {
    const oldSettings = { ...filterSettings };
    filterSettings = changes.filterSettings.newValue;
    debug.log("🔄 Storage changed - filter settings updated:", filterSettings);
    
    // If reposted filter was turned OFF during scan, it will be caught in the next iteration
    if (oldSettings.hideReposted && !filterSettings.hideReposted) {
      debug.log("⚠️ Reposted filter turned OFF via storage change");
    }
    
    // If reposted filter was turned ON, trigger scan
    if (!oldSettings.hideReposted && filterSettings.hideReposted) {
      debug.log("🔍 Reposted filter turned ON via storage change, starting scan...");
      setTimeout(() => {
        scanAllJobsForReposted();
      }, 500);
    }
  }
});

// Function to extract job ID from card element
function getJobIdFromCard(card) {
  if (!card) return null;
  const id =
    card.getAttribute?.("data-occludable-job-id") ||
    card.getAttribute?.("data-job-id");
  if (id) return id;

  const link =
    card.querySelector?.("a[href*='/jobs/view']") ||
    card.closest?.("a[href*='/jobs/view']");
  const href = link?.getAttribute?.("href") || "";
  const m1 = href.match(/\/jobs\/view\/(\d+)/);
  if (m1) return m1[1];
  const m2 = href.match(/currentJobId=(\d+)/);
  if (m2) return m2[1];
  return null;
}

function isScannableElement(el) {
  if (!el || !document.contains(el)) return false;
  if (el.closest?.(".jobs-list-skeleton__artdeco-card--no-top-right-radius")) return false;
  if (el.hasAttribute?.("hidden")) return false;
  const cs = getComputedStyle(el);
  if (cs.display === "none" || cs.visibility === "hidden" || parseFloat(cs.opacity) === 0) {
    return false;
  }
  return true;
}

function collectCanonicalJobCards() {
  const selectors = [
    ".job-card-container",
    ".jobs-search-results__list-item",
    ".scaffold-layout__list-item",
    "li[data-occludable-job-id]",
    ".jobs-search-results-list__list-item",
    "[data-job-id]",
    ".job-card-list__entity-lockup",
    "div.job-card-container",
  ];

  const seenNodes = new Set();
  const byId = new Map();
  const dupes = new Map();

  selectors.forEach((selector) => {
    try {
      document.querySelectorAll(selector).forEach((node) => {
        if (seenNodes.has(node)) return;
        seenNodes.add(node);

        const jobId = getJobIdFromCard(node);
        if (!jobId) return;

        const canonical = node.closest?.("li[data-occludable-job-id]") || node;

        if (!byId.has(jobId)) {
          byId.set(jobId, canonical);
          dupes.set(jobId, [canonical]);
        } else {
          const arr = dupes.get(jobId);
          const currentCanonical = byId.get(jobId);
          const preferred =
            canonical.matches?.("li[data-occludable-job-id]") ? canonical : currentCanonical;
          byId.set(jobId, preferred);
          if (!arr.includes(canonical)) arr.push(canonical);
        }
      });
    } catch (e) {
      debug.log(`Error with selector ${selector}:`, e);
    }
  });

  return { byId, dupes };
}

// Overlay elements for scan progress
let overlayEl = null;

function ensureScanOverlay() {
  if (overlayEl) return overlayEl;

  overlayEl = document.createElement("div");
  overlayEl.id = "ljf-scan-overlay";
  overlayEl.setAttribute("role", "dialog");
  overlayEl.setAttribute("aria-live", "polite");
  overlayEl.style.cssText = [
    "position:fixed",
    "inset:0",
    "background:rgba(0,0,0,0.45)",
    "display:none",
    "align-items:center",
    "justify-content:center",
    "z-index:2147483647",
    "opacity:0",
    "transition:opacity 180ms ease-in-out"
  ].join(";");

  const panel = document.createElement("div");
  panel.style.cssText = [
    "min-width:320px",
    "max-width:90vw",
    "padding:20px 24px",
    "border-radius:12px",
    "background:#1f1f1f",
    "color:#fff",
    "box-shadow:0 10px 30px rgba(0,0,0,0.5)",
    "font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif"
  ].join(";");

  const title = document.createElement("div");
  title.id = "ljf-scan-title";
  title.textContent = "Scanning for reposted jobs…";
  title.style.cssText = "font-size:16px;font-weight:600;margin-bottom:10px";

  const row = document.createElement("div");
  row.style.cssText = "display:flex;align-items:center;gap:12px";

  const spinner = document.createElement("div");
  spinner.setAttribute("aria-hidden", "true");
  spinner.style.cssText = [
    "width:18px",
    "height:18px",
    "border:2px solid rgba(255,255,255,0.25)",
    "border-top-color:#fff",
    "border-radius:50%",
    "animation:ljf-spin 700ms linear infinite"
  ].join(";");

  const progress = document.createElement("div");
  progress.id = "ljf-scan-progress";
  progress.textContent = "0 / 0 • found 0";
  progress.style.cssText = "font-size:13px;opacity:0.85";

  const style = document.createElement("style");
  style.textContent = "@keyframes ljf-spin{to{transform:rotate(360deg)}}";

  row.appendChild(spinner);
  row.appendChild(progress);
  panel.appendChild(title);
  panel.appendChild(row);
  overlayEl.appendChild(style);
  overlayEl.appendChild(panel);
  document.documentElement.appendChild(overlayEl);
  return overlayEl;
}

function showScanOverlay(progressState) {
  const el = ensureScanOverlay();
  const title = el.querySelector("#ljf-scan-title");
  const progress = el.querySelector("#ljf-scan-progress");
  if (title) title.textContent = "Scanning for reposted jobs…";
  if (progress) {
    const total = progressState?.total ?? 0;
    const processed = progressState?.processed ?? 0;
    const found = progressState?.found ?? 0;
    progress.textContent = `${processed} / ${total} • found ${found}`;
  }
  el.style.display = "flex";
  requestAnimationFrame(() => (el.style.opacity = "1"));
}

function updateScanOverlay(progressState) {
  if (!overlayEl) return;
  const progress = overlayEl.querySelector("#ljf-scan-progress");
  if (!progress) return;
  const total = progressState?.total ?? 0;
  const processed = progressState?.processed ?? 0;
  const found = progressState?.found ?? 0;
  progress.textContent = `${processed} / ${total} • found ${found}`;
}

function hideScanOverlay(finalText) {
  if (!overlayEl) return;
  const title = overlayEl.querySelector("#ljf-scan-title");
  if (title && finalText) title.textContent = finalText;
  setTimeout(() => {
    overlayEl.style.opacity = "0";
    setTimeout(() => {
      if (overlayEl) overlayEl.style.display = "none";
    }, 200);
  }, 600);
}

// Listen for settings changes from popup
chrome.runtime.onMessage.addListener(function (request, sender, sendResponse) {
  debug.log("📩 Message received:", request);

  try {
    if (request.action === "updateSettings") {
      const oldSettings = { ...filterSettings };
      filterSettings = request.settings;

      debug.log("🔄 Settings updated from:", oldSettings, "to:", filterSettings);

      if (oldSettings.hideApplied !== filterSettings.hideApplied) {
        debug.log(`🔄 Hide Applied Jobs: ${filterSettings.hideApplied ? "ON" : "OFF"}`);
      }
      if (oldSettings.hidePromoted !== filterSettings.hidePromoted) {
        debug.log(`🔄 Hide Promoted Jobs: ${filterSettings.hidePromoted ? "ON" : "OFF"}`);
      }
      if (oldSettings.hideReposted !== filterSettings.hideReposted) {
        debug.log(`🔄 Hide Reposted Jobs: ${filterSettings.hideReposted ? "ON" : "OFF"}`);
      }

      processedJobs = new WeakSet();
      debug.log("🗑️ Cleared processed jobs WeakSet");

      // Use canonical deduplication to get accurate count
      const { byId, dupes } = collectCanonicalJobCards();
      const allJobCards = Array.from(byId.values());

      debug.log(`📋 Found ${allJobCards.length} unique job cards to reprocess`);

      let resetCount = 0;
      // Reset canonical cards AND all duplicates
      dupes.forEach((dupArray) => {
        dupArray.forEach((card) => {
          card.removeAttribute("data-filtered");
          card.removeAttribute("data-hidden-by-filter");
          card.removeAttribute("data-reposted");
          card.style.removeProperty("display");
          resetCount++;
        });
      });

      debug.log(`🔄 Reset ${resetCount} total DOM nodes (${allJobCards.length} unique jobs)`);

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

      debug.log(`✅ Re-filtering complete: ${hiddenCount} hidden, ${visibleCount} visible`);

      // If reposted filter was turned ON (from OFF), start scan
      if (filterSettings.hideReposted && !oldSettings.hideReposted) {
        debug.log("🔍 Reposted filter enabled, starting scan...");
        setTimeout(() => {
          scanAllJobsForReposted();
        }, 500);
      }

      sendResponse({ success: true });
    }
  } catch (error) {
    debug.error("❌ Error handling message:", error);
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

// Function to programmatically check all jobs for reposted status
// This is necessary because "Reposted" text only appears in the job details panel
// (right side) when you click a job card, not in the job list cards themselves.
// Solution: Automatically click through all visible job cards to check their details.
let isScanning = false; // Flag to prevent concurrent scans

const normalizeText = (text) =>
  text ? text.replace(/\s+/g, " ").trim().toLowerCase() : "";

function getJobTitleFromCard(jobCard) {
  if (!jobCard) {
    return "";
  }

  const selectors = [
    ".job-card-list__title",
    ".job-card-container__title",
    ".job-card-container__link",
    ".job-card-list__title a",
    "a.job-card-list__title",
  ];

  for (const selector of selectors) {
    const element = jobCard.querySelector(selector);
    if (element && element.textContent) {
      return element.textContent;
    }
  }

  return jobCard.textContent || "";
}

async function waitForJobDetailsMatch(jobCard) {
  const targetTitle = normalizeText(getJobTitleFromCard(jobCard));
  const detailSelectors = [
    ".job-details-jobs-unified-top-card__job-title h1",
    ".job-details-jobs-unified-top-card__job-title a",
    ".job-details-jobs-unified-top-card__job-title",
    ".jobs-unified-top-card__job-title h1",
  ];

  for (let attempt = 0; attempt < 10; attempt++) {
    await wait(200);

    let titleElement = null;
    for (const selector of detailSelectors) {
      const candidate = document.querySelector(selector);
      if (candidate && candidate.textContent) {
        titleElement = candidate;
        break;
      }
    }

    if (!titleElement) {
      continue;
    }

    const detailTitle = normalizeText(titleElement.textContent);
    if (
      !targetTitle ||
      detailTitle.includes(targetTitle) ||
      targetTitle.includes(detailTitle)
    ) {
      return true;
    }
  }

  return false;
}

async function processJobCards(jobCards, attempt, maxAttempts, progressState, processedIds, duplicatesById) {
  let repostedCount = 0;
  const skippedCards = [];
  let processedInBatch = 0;

  for (let i = 0; i < jobCards.length; i++) {
    // Check if filter was turned off mid-scan with detailed logging
    debug.log(`[Scan Check ${i}] hideReposted = ${filterSettings.hideReposted}`);
    if (!filterSettings.hideReposted) {
      debug.log("⏸️ Reposted filter turned off, stopping scan");
      return { repostedCount, skippedCards: [], cancelled: true };
    }

    const jobCard = jobCards[i];
    if (!jobCard || !document.contains(jobCard)) continue;

    const jobId = getJobIdFromCard(jobCard);
    if (!jobId) continue;

    if (jobCard.getAttribute("data-reposted") === "true") continue;

    const cardIndex = jobCard.dataset.scanIndex || i;
    const jobTitleForLog = (getJobTitleFromCard(jobCard) || "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 80);

    // Count unique jobId for progress (only once overall)
    if (progressState && processedIds && !processedIds.has(jobId)) {
      processedIds.add(jobId);
      progressState.processed = (progressState.processed || 0) + 1;
      updateScanOverlay(progressState);
    }

    try {
      jobCard.scrollIntoView({ block: "center", behavior: "auto" });

      const clickableElement =
        jobCard.querySelector("a[href*='/jobs/view']") || jobCard;

      if (typeof clickableElement.click === "function") {
        clickableElement.click();
      } else if (typeof jobCard.click === "function") {
        jobCard.click();
      }

      const detailsReady = await waitForJobDetailsMatch(jobCard);

      if (!detailsReady) {
        consecutiveDetailMisses++;
        await maybeBackoff();
        debug.warn(
          `⚠️ Job details did not update for card index ${cardIndex} (${jobTitleForLog || "unknown title"}), attempt ${attempt}/${maxAttempts}, scheduling retry`
        );
        skippedCards.push(jobCard);
        await pauseIfHidden();
        await wait(300 + Math.random() * 300);
        continue;
      } else {
        resetMissCounter();
      }

      const jobDetails = document.querySelector(
        ".job-details-jobs-unified-top-card__primary-description-container"
      );

      if (jobDetails && jobDetails.textContent.includes("Reposted")) {
        debug.log(`✓ Found reposted job: ${jobTitleForLog || "[no title]"}`);

        // Mark and hide all duplicates for this job id
        const allForId = (duplicatesById?.get(jobId) || [jobCard]);
        allForId.forEach((el) => {
          el.setAttribute("data-reposted", "true");
          el.style.setProperty("display", "none", "important");
          el.setAttribute("data-hidden-by-filter", "true");
        });

        repostedCount++;
        if (progressState) progressState.found = (progressState.found || 0) + 1;
      }
    } catch (error) {
      debug.error(`Error scanning job card ${cardIndex}:`, error);
    }

    processedInBatch++;
    await pauseIfHidden();
    await wait(humanDelayMs());

    if (processedInBatch % SCAN_BATCH_SIZE === 0 && i < jobCards.length - 1) {
      debug.log(`🛑 Cooling down for ${SCAN_BATCH_COOLDOWN_MS}ms after ${SCAN_BATCH_SIZE} cards`);
      await wait(SCAN_BATCH_COOLDOWN_MS);
      
      // Re-check filter after cooldown with logging
      debug.log(`[Post-Cooldown Check] hideReposted = ${filterSettings.hideReposted}`);
      if (!filterSettings.hideReposted) {
        debug.log("⏸️ Reposted filter turned off during cooldown, stopping scan");
        return { repostedCount, skippedCards: [], cancelled: true };
      }
    }
  }

  return { repostedCount, skippedCards };
}

async function scanAllJobsForReposted() {
  if (!filterSettings.hideReposted) {
    debug.log("⏭️ Reposted filter disabled, skipping scan");
    return;
  }
  if (isScanning) {
    debug.log("⏸️ Scan already in progress, skipping...");
    return;
  }

  isScanning = true;
  debug.log("🔍 Starting scan for reposted jobs...");

  let totalReposted = 0;
  let skippedCards = [];
  const maxAttempts = 2;
  let cancelled = false;

  const progress = { total: 0, processed: 0, found: 0 };
  const processedIds = new Set();

  try {
    const { byId, dupes } = collectCanonicalJobCards();

    const visibleEntries = Array.from(byId.entries()).filter(([, el]) => {
      if (el.getAttribute("data-hidden-by-filter") === "true") return false;
      return isScannableElement(el);
    });

    const visibleCards = visibleEntries.map(([, el], index) => {
      el.dataset.scanIndex = String(index);
      return el;
    });

    progress.total = visibleCards.length;
    debug.log(`📋 Found ${visibleCards.length} unique job cards to scan`);
    showScanOverlay(progress);

    let attempt = 1;
    let cardsToProcess = visibleCards;

    while (cardsToProcess.length > 0 && attempt <= maxAttempts) {
      // Check before each attempt with logging
      debug.log(`[Attempt ${attempt} Start] hideReposted = ${filterSettings.hideReposted}`);
      if (!filterSettings.hideReposted) {
        debug.log("⏸️ Reposted filter turned off, cancelling scan");
        cancelled = true;
        break;
      }

      if (attempt > 1) {
        debug.log(`🔁 Retrying ${cardsToProcess.length} job cards (attempt ${attempt}/${maxAttempts})`);
      }

      const result = await processJobCards(cardsToProcess, attempt, maxAttempts, progress, processedIds, dupes);
      
      if (result.cancelled) {
        cancelled = true;
        totalReposted += result.repostedCount;
        break;
      }

      totalReposted += result.repostedCount;

      skippedCards = result.skippedCards.filter(
        (card) => card && document.contains(card) && isScannableElement(card) && card.style.display !== "none"
      );

      if (skippedCards.length === 0) break;

      attempt++;
      if (attempt > maxAttempts) break;

      await wait(1500);
      cardsToProcess = skippedCards;
    }
  } finally {
    if (cancelled) {
      hideScanOverlay(`Cancelled • scanned ${progress.processed} of ${progress.total}`);
      debug.log(`⏸️ Scan cancelled by user after processing ${progress.processed} jobs`);
    } else {
      if (skippedCards.length > 0) {
        debug.warn(`⚠️ Could not verify ${skippedCards.length} job cards after ${maxAttempts} attempts`);
      }
      hideScanOverlay(`Done • hid ${totalReposted} reposted job${totalReposted === 1 ? "" : "s"}`);
      debug.log(`✅ Scan complete! Found and hid ${totalReposted} reposted jobs`);
    }
    isScanning = false;
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
        debug.log(`Error with selector ${selector}:`, error);
      }
    });

    debug.log(
      `Found ${allJobCards.length} job cards using multiple selectors`
    );

    if (allJobCards.length === 0) {
      debug.warn(
        "⚠️ No job cards found. The page might still be loading or LinkedIn's structure changed."
      );
      debug.log(
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
    debug.error("Error in applyFilters:", error);
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
      debug.log(
        `Found ${unprocessedJobs.length} unprocessed jobs, filtering...`
      );
    }
    unprocessedJobs.forEach((jobCard) => filterJobCard(jobCard));
  }
}, 2000); // Check every 2 seconds (reduced frequency)

debug.log("LinkedIn Job Filter Extension activated! ✨");

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
      debug.log("✅ Jobs loaded! Starting filter...");
      clearInterval(checkInterval);
      applyFilters();
      
      // Scan for reposted jobs after initial filter (slightly longer delay)
      setTimeout(() => {
        scanAllJobsForReposted();
      }, 3000);
      
      return;
    }

    if (attempts >= maxAttempts) {
      debug.log(
        "⚠️ Timeout waiting for jobs to load. Trying to filter anyway..."
      );
      clearInterval(checkInterval);
      applyFilters();
      
      // Also scan for reposted on timeout (increased delay)
      setTimeout(() => {
        scanAllJobsForReposted();
      }, 3000);
    } else {
      debug.log(
        `⏳ Waiting for jobs to load... (attempt ${attempts}/${maxAttempts})`
      );
    }
  }, 1000);
}

// Start waiting for jobs to load (only if on jobs page)
if (isOnJobsPage()) {
  debug.log("📍 On jobs page, starting filter initialization...");
  waitForJobsToLoad();
} else {
  debug.log("📍 Not on jobs page yet, waiting for navigation...");
}

// Detect URL changes (for when user navigates from feed to jobs without refresh)
// Using setInterval instead of MutationObserver to avoid constant triggering
function getNavigationSignature() {
  try {
    const currentUrl = new URL(location.href);
    const params = new URLSearchParams(currentUrl.search);

    // Remove transient params that change when simply selecting a job card
    [
      "currentJobId",
      "currentJobUrl",
      "currentJobUrlEncoded",
      "trackingId",
      "refId",
    ].forEach((key) => params.delete(key));

    if (typeof params.sort === "function") {
      params.sort();
    }

    const query = params.toString();
    return query ? `${currentUrl.pathname}?${query}` : currentUrl.pathname;
  } catch (error) {
    debug.warn("⚠️ Failed to build navigation signature, falling back to pathname", error);
    return location.pathname;
  }
}

let lastNavigationSignature = getNavigationSignature();
let urlChangeTimeout = null;

setInterval(() => {
  const navigationSignature = getNavigationSignature();

  if (navigationSignature === lastNavigationSignature) {
    return;
  }

  if (isScanning) {
    debug.log("⏳ Ignoring URL change during active scan");
    lastNavigationSignature = navigationSignature;
    return;
  }

  lastNavigationSignature = navigationSignature;

  if (!location.pathname.includes("/jobs")) {
    return;
  }

  debug.log("🔄 Navigated to jobs page (signature change), re-initializing filters...");

  processedJobs = new WeakSet();

  if (urlChangeTimeout) {
    clearTimeout(urlChangeTimeout);
  }

  urlChangeTimeout = setTimeout(() => {
    waitForJobsToLoad();
  }, 2000);
}, 1000); // Check URL every second instead of on every DOM mutation

debug.log(
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
