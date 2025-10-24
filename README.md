# LinkedIn Job Filter 🎯

A Chrome extension that automatically hides Applied, Promoted, and Reposted jobs on LinkedIn, making your job search cleaner and more efficient.

## ✨ Features

- 🚫 **Hide Applied Jobs** - Remove jobs you've already applied to
- 🔇 **Hide Promoted Jobs** - Filter out sponsored/promoted listings
- 🔄 **Hide Reposted Jobs** - Remove jobs that have been reposted
- ⚡ **Live Filtering** - Works instantly without page refresh
- 🎨 **Clean Interface** - Simple toggle switches in the popup
- 🔄 **Auto-Detection** - Activates automatically when you navigate to LinkedIn Jobs

## 📦 Installation

### Method 1: Load Unpacked (Recommended for Testing)

1. **Download this extension**
   - Click the green "Code" button above
   - Select "Download ZIP"
   - Extract the ZIP file to a folder

2. **Open Chrome Extensions**
   - Go to `chrome://extensions/`
   - Or click the puzzle icon (Extensions) → "Manage Extensions"

3. **Enable Developer Mode**
   - Toggle the "Developer mode" switch in the top-right corner

4. **Load the Extension**
   - Click "Load unpacked"
   - Select the folder where you extracted the files
   - The extension should now appear in your extensions list

5. **Pin the Extension** (Optional)
   - Click the puzzle icon in the Chrome toolbar
   - Find "LinkedIn Job Filter"
   - Click the pin icon to keep it visible

### Method 2: Chrome Web Store (Coming Soon)
The extension will be available on the Chrome Web Store soon for easy one-click installation.

## 🚀 Usage

1. **Go to LinkedIn Jobs**
   - Navigate to https://www.linkedin.com/jobs/search/
   - The extension activates automatically

2. **Configure Filters**
   - Click the extension icon in your toolbar
   - Toggle the switches to enable/disable filters:
     - Hide Applied Jobs
     - Hide Promoted Jobs
     - Hide Reposted Jobs

3. **See Results Instantly**
   - Jobs matching your filters are hidden immediately
   - No page refresh needed!
   - Console logs show filtering activity (press F12 to see)

## 🔧 How It Works

The extension:
- Detects when you're on a LinkedIn Jobs page
- Scans job cards for "Applied", "Promoted", or "Reposted" labels
- Hides matching jobs using CSS (`display: none !important`)
- Continues monitoring for new jobs as you scroll
- Responds to filter changes in real-time

## 🛡️ Privacy

- **No data collection** - All filtering happens locally in your browser
- **No external requests** - Extension only works on LinkedIn pages
- **No tracking** - Your job search activity is never recorded or transmitted

## 🐛 Troubleshooting

**Extension not working?**
- Refresh the LinkedIn Jobs page once after installing
- Make sure you're on `linkedin.com/jobs/search/`
- Check that the extension is enabled in `chrome://extensions/`

**Jobs still showing?**
- Open the extension popup and verify filters are toggled ON
- Check browser console (F12) for any error messages
- LinkedIn may have changed their HTML structure - please report an issue!

**Conflicts with other extensions?**
- If you have other LinkedIn job filtering extensions (Hide n' Seek, Simplify, etc.), they may conflict
- Try disabling other job-related extensions to test

## 📝 Known Issues

- LinkedIn sometimes changes their page structure, which may require extension updates
- Very rarely, LinkedIn's own JavaScript errors may spam the console (not from this extension)

## 🤝 Contributing

Found a bug or want to add a feature? Contributions are welcome!

1. Fork this repository
2. Create a feature branch: `git checkout -b feature-name`
3. Commit your changes: `git commit -m 'Add some feature'`
4. Push to the branch: `git push origin feature-name`
5. Open a Pull Request

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

Built to make LinkedIn job searching less cluttered and more efficient. Happy job hunting! 🎉

## 📞 Support

If you encounter issues or have suggestions:
- Open an issue on GitHub
- Provide details: Chrome version, LinkedIn page URL, console logs (F12)

---

**Made with ❤️ for job seekers**