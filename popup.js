// Ensure debug is available (fallback if debug.js fails to load)
if (typeof window.debug === 'undefined') {
  window.debug = {
    log: console.log.bind(console),
    error: console.error.bind(console),
    warn: console.warn.bind(console)
  };
}

// Load saved settings when popup opens
document.addEventListener("DOMContentLoaded", function () {
  // Load settings from storage
  chrome.storage.sync.get(["filterSettings"], function (result) {
    if (result.filterSettings) {
      document.getElementById("hideApplied").checked =
        result.filterSettings.hideApplied;
      document.getElementById("hideReposted").checked =
        result.filterSettings.hideReposted;
      document.getElementById("hidePromoted").checked =
        result.filterSettings.hidePromoted;
    }
  });

  // Add event listeners to checkboxes
  const checkboxes = ["hideApplied", "hideReposted", "hidePromoted"];

  checkboxes.forEach((id) => {
    document.getElementById(id).addEventListener("change", function () {
      saveSettings();
    });
  });
});

// Save settings and update content script
function saveSettings() {
  const settings = {
    hideApplied: document.getElementById("hideApplied").checked,
    hideReposted: document.getElementById("hideReposted").checked,
    hidePromoted: document.getElementById("hidePromoted").checked,
  };

  debug.log("💾 Saving settings:", settings);

  // Save to storage
  chrome.storage.sync.set({ filterSettings: settings }, function () {
    debug.log("✅ Settings saved to storage");

    // Show status message
    showStatus("Settings saved!");

    // Send message to content script to update filters
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      debug.log("📋 Active tabs:", tabs);

      if (tabs[0]) {
        debug.log("🌐 Current tab URL:", tabs[0].url);

        if (tabs[0].url && tabs[0].url.includes("linkedin.com")) {
          debug.log("📤 Sending message to tab", tabs[0].id);

          chrome.tabs.sendMessage(
            tabs[0].id,
            {
              action: "updateSettings",
              settings: settings,
            },
            function (response) {
              if (chrome.runtime.lastError) {
                debug.error(
                  "❌ Could not send message:",
                  chrome.runtime.lastError.message
                );
                showStatus("Please refresh the page");
              } else {
                debug.log("✅ Message sent successfully:", response);
                showStatus("Filters updated!");
              }
            }
          );
        } else {
          debug.log("⚠️ Not on LinkedIn, skipping message");
          showStatus("Open LinkedIn jobs page");
        }
      } else {
        debug.log("❌ No active tab found");
      }
    });
  });
}

// Show status message
function showStatus(message) {
  const status = document.getElementById("status");
  status.textContent = message;
  status.classList.add("show");

  setTimeout(() => {
    status.classList.remove("show");
    setTimeout(() => {
      status.textContent = "";
    }, 300);
  }, 2000);
}
