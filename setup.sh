#!/bin/bash

echo "========================================"
echo "PoleCheck Desktop - Auto Setup Script"
echo "========================================"
echo ""
echo "This script will automatically set up PoleCheck Desktop"
echo "for development and launch the application."
echo ""

# Function to check if command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# Check prerequisites
echo "Checking prerequisites..."

# Check Node.js
if ! command_exists node; then
    echo "ERROR: Node.js is not installed"
    echo "Please install Node.js from https://nodejs.org/"
    echo "Then run this script again."
    echo ""
    read -p "Press Enter to exit..."
    exit 1
fi
echo "✓ Node.js found"

# Check npm
if ! command_exists npm; then
    echo "ERROR: npm is not available"
    echo "Please ensure npm is installed with Node.js"
    read -p "Press Enter to exit..."
    exit 1
fi
echo "✓ npm found"

# Check Git
if ! command_exists git; then
    echo "ERROR: Git is not installed"
    echo "Please install Git from https://git-scm.com/"
    echo "Then run this script again."
    echo ""
    read -p "Press Enter to exit..."
    exit 1
fi
echo "✓ Git found"

# Check Git LFS
if ! command_exists git-lfs; then
    echo "WARNING: Git LFS is not installed"
    echo "Installing Git LFS..."
    
    # Try different installation methods
    if command_exists brew; then
        brew install git-lfs
    elif command_exists apt-get; then
        sudo apt-get update && sudo apt-get install -y git-lfs
    elif command_exists yum; then
        sudo yum install -y git-lfs
    elif command_exists dnf; then
        sudo dnf install -y git-lfs
    else
        echo "ERROR: Could not install Git LFS automatically"
        echo "Please install Git LFS manually from https://git-lfs.com/"
        read -p "Press Enter to exit..."
        exit 1
    fi
fi

# Initialize Git LFS
git lfs install
echo "✓ Git LFS ready"

echo ""
echo "Installing dependencies..."
npm install
if [ $? -ne 0 ]; then
    echo "ERROR: Failed to install dependencies"
    read -p "Press Enter to exit..."
    exit 1
fi
echo "✓ Dependencies installed"

echo ""
echo "Downloading model files..."
git lfs pull
if [ $? -ne 0 ]; then
    echo "WARNING: Failed to download model files automatically"
    echo "You may need to download them manually from:"
    echo "https://huggingface.co/depth-anything/Depth-Anything-V2-Metric-VKITTI-Small"
    echo ""
    read -p "Continue without models? (y/N): " continue_without_models
    if [[ ! $continue_without_models =~ ^[Yy]$ ]]; then
        echo "Setup cancelled"
        read -p "Press Enter to exit..."
        exit 1
    fi
else
    echo "✓ Model files downloaded"
fi

# Check if .env file exists
if [ ! -f ".env" ]; then
    echo ""
    echo "Creating .env file..."
    echo "Please enter your Google Maps API key:"
    echo "(You can get one from https://console.cloud.google.com/)"
    echo ""
    read -p "Enter your Google Maps API key: " api_key
    if [ ! -z "$api_key" ]; then
        echo "VITE_GOOGLE_MAPS_API_KEY=$api_key" > .env
        echo "✓ .env file created"
    else
        echo "WARNING: No API key provided"
        echo "You can add it later by editing the .env file"
        echo "VITE_GOOGLE_MAPS_API_KEY=YOUR_API_KEY_HERE" > .env
    fi
else
    echo "✓ .env file found"
fi

echo ""
echo "Running linting check..."
npm run lint
if [ $? -ne 0 ]; then
    echo "WARNING: Linting found issues"
    echo "You can fix them later by running: npm run lint"
else
    echo "✓ Code quality check passed"
fi

echo ""
echo "Running type checking..."
npm run typecheck
if [ $? -ne 0 ]; then
    echo "WARNING: Type checking found issues"
    echo "You can fix them later by running: npm run typecheck"
else
    echo "✓ Type checking passed"
fi

echo ""
echo "========================================"
echo "Setup completed successfully!"
echo "========================================"
echo ""
echo "Starting PoleCheck Desktop..."
echo ""
echo "If the app doesn't start automatically, you can run:"
echo "npm run dev"
echo ""
echo "To build for production:"
echo "npm run build"
echo ""

# Start the application
npm run dev

echo ""
echo "Application closed."
read -p "Press Enter to exit..." 