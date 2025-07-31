# PoleCheck Desktop - Quick Setup Guide

## 🚀 One-Click Setup (Recommended)

### For Windows Users
1. **Clone the repository:**
   ```bash
   git clone https://github.com/lukifer23/PoleCheck-Desktop.git
   cd PoleCheck-Desktop
   ```

2. **Double-click `setup.bat`**
   - The script will automatically:
     - ✅ Check if Node.js, npm, Git, and Git LFS are installed
     - ✅ Install dependencies (`npm install`)
     - ✅ Download model files (`git lfs pull`)
     - ✅ Create `.env` file (prompts for your Google Maps API key)
     - ✅ Run code quality checks
     - ✅ Launch the application

### For macOS/Linux Users
1. **Clone the repository:**
   ```bash
   git clone https://github.com/lukifer23/PoleCheck-Desktop.git
   cd PoleCheck-Desktop
   ```

2. **Run the setup script:**
   ```bash
   chmod +x setup.sh  # Make executable (first time only)
   ./setup.sh         # Run the setup script
   ```

## 📋 What the Setup Scripts Do

### Prerequisites Check
- ✅ **Node.js** (v18+ recommended)
- ✅ **npm** (comes with Node.js)
- ✅ **Git** (for cloning and Git LFS)
- ✅ **Git LFS** (for downloading model files)

### Automated Steps
1. **Dependency Installation**
   ```bash
   npm install
   ```

2. **Model File Download**
   ```bash
   git lfs pull
   ```
   Downloads the required ML models:
   - `src/assets/models/depth_anything_v2_metric_vkitti_vits.onnx`
   - `models_temp/depth_anything_v2_metric_vkitti_vits.pth`

3. **Environment Setup**
   - Creates `.env` file
   - Prompts for Google Maps API key
   - Provides helpful links if you don't have one

4. **Quality Checks**
   - Runs ESLint for code quality
   - Runs TypeScript type checking
   - Reports any issues found

5. **Application Launch**
   ```bash
   npm run dev
   ```

## 🔧 Manual Setup (Alternative)

If you prefer to set up manually or the automated scripts don't work:

### Step 1: Install Prerequisites
- **Node.js**: Download from [nodejs.org](https://nodejs.org/)
- **Git**: Download from [git-scm.com](https://git-scm.com/)
- **Git LFS**: Install from [git-lfs.com](https://git-lfs.com/)

### Step 2: Clone and Setup
```bash
git clone https://github.com/lukifer23/PoleCheck-Desktop.git
cd PoleCheck-Desktop
git lfs pull
npm install
```

### Step 3: Create Environment File
Create a `.env` file in the project root:
```env
VITE_GOOGLE_MAPS_API_KEY=YOUR_API_KEY_HERE
```

### Step 4: Launch
```bash
npm run dev
```

## 🆘 Troubleshooting

### "Node.js not found"
- Install Node.js from [nodejs.org](https://nodejs.org/)
- Make sure it's added to your PATH

### "Git not found"
- Install Git from [git-scm.com](https://git-scm.com/)
- On Windows, make sure to select "Add to PATH" during installation

### "Git LFS not found"
- Install Git LFS from [git-lfs.com](https://git-lfs.com/)
- Or run: `git lfs install`

### "Model files not downloaded"
- Run manually: `git lfs pull`
- Or download from: [Hugging Face](https://huggingface.co/depth-anything/Depth-Anything-V2-Metric-VKITTI-Small)

### "Google Maps API Key missing"
- Get a free API key from [Google Cloud Console](https://console.cloud.google.com/)
- Enable: Maps JavaScript API, Places API, Street View Static API
- Add to `.env` file: `VITE_GOOGLE_MAPS_API_KEY=YOUR_KEY_HERE`

### "Permission denied" (macOS/Linux)
- Make script executable: `chmod +x setup.sh`
- Or run with sudo if needed: `sudo ./setup.sh`

## 🎯 Next Steps

After successful setup:
1. **Get a Google Maps API key** (if you haven't already)
2. **Test the application** by searching for a location
3. **Generate a depth map** for your first measurement
4. **Read the main README.md** for usage instructions

## 📞 Need Help?

- Check the main [README.md](README.md) for detailed documentation
- Review [CONTRIBUTING.md](CONTRIBUTING.md) for development setup
- Open an issue on GitHub if you encounter problems

---

**Happy measuring! 📏** 