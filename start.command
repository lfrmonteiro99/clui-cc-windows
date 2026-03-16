#!/bin/bash
set -e
cd "$(dirname "$0")"

# ── Helpers ──

fail=0
INSTALL_WHISPER=0

for arg in "$@"; do
  case "$arg" in
    --with-voice)
      INSTALL_WHISPER=1
      ;;
    --help|-h)
      echo "Usage: ./start.command [--with-voice]"
      echo
      echo "  --with-voice   Install whisper-cli via Homebrew before launch."
      exit 0
      ;;
  esac
done

step() {
  echo
  echo "--- $1"
}

pass() {
  echo "  OK: $1"
}

fail() {
  echo "  FAIL: $1"
  fail=1
}

fix() {
  echo
  echo "  To fix, copy and run this command:"
  echo
  echo "    $1"
  echo
}

fix_block() {
  echo
  echo "  To fix, run these commands one at a time:"
  echo
  while [ $# -gt 0 ]; do
    echo "    $1"
    shift
  done
  echo
}

# ── Version helpers ──

# Compare two dotted versions: returns 0 if $1 >= $2
version_gte() {
  [ "$(printf '%s\n%s' "$1" "$2" | sort -V | head -1)" = "$2" ]
}

# ── Preflight Checks ──

step "Checking environment"
SDK_PATH=""

# 0. macOS
if [ "$(uname)" != "Darwin" ]; then
  fail "Clui CC requires macOS 13+. Detected: $(uname). This project does not run on Linux or Windows."
else
  macos_ver=$(sw_vers -productVersion 2>/dev/null || echo "0")
  if version_gte "$macos_ver" "13.0"; then
    pass "macOS $macos_ver"
  else
    fail "macOS $macos_ver is too old. Clui CC requires macOS 13+."
    echo
    echo "  Update macOS in System Settings > General > Software Update."
    echo
  fi
fi

# 1. Node
if command -v node &>/dev/null; then
  node_ver=$(node --version | sed 's/^v//')
  if version_gte "$node_ver" "18.0.0"; then
    pass "Node.js v$node_ver"
  else
    fail "Node.js v$node_ver is too old. Clui CC requires Node 18+."
    fix "brew install node"
  fi
else
  fail "Node.js is not installed."
  fix "brew install node"
fi

# 2. npm
if command -v npm &>/dev/null; then
  pass "npm $(npm --version)"
else
  fail "npm is not installed (should come with Node.js)."
  fix "brew install node"
fi

# 3. Python 3
if command -v python3 &>/dev/null; then
  pass "Python $(python3 --version 2>&1 | awk '{print $2}')"
else
  fail "Python 3 is not installed."
  fix "brew install python@3.11"
fi

# 4. distutils (Python setuptools)
if command -v python3 &>/dev/null; then
  if python3 -c "import distutils" 2>/dev/null; then
    pass "Python distutils available"
  else
    fail "Python is missing 'distutils' (needed by native module compiler)."
    fix "python3 -m pip install --upgrade pip setuptools"
  fi
fi

# 5. Xcode Command Line Tools
if xcode-select -p &>/dev/null; then
  pass "Xcode CLT at $(xcode-select -p)"
else
  fail "Xcode Command Line Tools are not installed."
  fix "xcode-select --install"
fi

# 6. macOS SDK
if xcrun --sdk macosx --show-sdk-path &>/dev/null; then
  SDK_PATH=$(xcrun --sdk macosx --show-sdk-path)
  pass "macOS SDK at $SDK_PATH"
else
  fail "macOS SDK not found. Xcode Command Line Tools may be broken."
  echo
  echo "  Try reinstalling Xcode Command Line Tools:"
  echo
  echo "    xcode-select --install"
  echo
  echo "  If that doesn't help, remove and reinstall them:"
  echo
  echo "    sudo rm -rf /Library/Developer/CommandLineTools"
  echo "    xcode-select --install"
  echo
fi

# 7. C++ compiler
if command -v clang++ &>/dev/null; then
  pass "clang++ available"

  # 8. C++ headers probe (only if clang++ exists)
  PROBE_DIR=$(mktemp -d)
  PROBE_FILE="$PROBE_DIR/probe.cpp"
  echo '#include <functional>' > "$PROBE_FILE"
  echo 'int main() { return 0; }' >> "$PROBE_FILE"
  if clang++ -std=c++17 -c "$PROBE_FILE" -o "$PROBE_DIR/probe.o" 2>/dev/null; then
    pass "C++ standard headers OK"
  elif [ -n "$SDK_PATH" ] && clang++ -std=c++17 -isysroot "$SDK_PATH" -I"$SDK_PATH/usr/include/c++/v1" -c "$PROBE_FILE" -o "$PROBE_DIR/probe.o" 2>/dev/null; then
    pass "C++ standard headers OK (using SDK include path)"
  else
    fail "C++ headers are broken (<functional> not found)."
    echo
    echo "  Try reinstalling Xcode Command Line Tools:"
    echo
    echo "    xcode-select --install"
    echo
    echo "  If that doesn't help, remove and reinstall them:"
    echo
    echo "    sudo rm -rf /Library/Developer/CommandLineTools"
    echo "    xcode-select --install"
    echo
    echo "  Then rerun ./start.command"
  fi
  rm -rf "$PROBE_DIR"
else
  fail "clang++ not found. Xcode Command Line Tools may be broken."
  fix "xcode-select --install"
fi

# 9. Claude CLI
if command -v claude &>/dev/null; then
  pass "Claude Code CLI found"
else
  fail "Claude Code CLI is not installed."
  fix "npm install -g @anthropic-ai/claude-code"
fi

# Bail if any check failed
if [ "$fail" -ne 0 ]; then
  echo
  echo "Some checks failed. Fix them above, then rerun:"
  echo
  echo "  ./start.command"
  echo
  exit 1
fi

echo
echo "All checks passed."

# ── Optional Voice Setup ──

if command -v whisper-cli &>/dev/null || command -v whisper &>/dev/null; then
  pass "Whisper CLI found (voice input ready)"
elif [ "$INSTALL_WHISPER" -eq 1 ]; then
  step "Installing optional voice dependency (Whisper)"
  if command -v brew &>/dev/null; then
    if brew install whisper-cli; then
      pass "Whisper CLI installed"
    else
      echo "  Could not install whisper-cli automatically."
      echo "  You can retry manually: brew install whisper-cli"
    fi
  else
    echo "  Homebrew not found. Install whisper manually if needed."
    echo "  See: https://brew.sh"
  fi
else
  echo
  echo "  INFO: Voice input is optional and Whisper CLI is not installed."
  echo "  Install anytime with:"
  echo "    brew install whisper-cli"
  echo "  Or run this script with:"
  echo "    ./start.command --with-voice"
fi

# ── Install ──

if [ ! -d "node_modules" ]; then
  step "Installing dependencies"
  if [ -n "$SDK_PATH" ]; then
    export SDKROOT="$SDK_PATH"
    export CXXFLAGS="-isysroot $SDKROOT -I$SDKROOT/usr/include/c++/v1 ${CXXFLAGS:-}"
  fi
  if ! npm install; then
    echo
    echo "npm install failed. Most common fixes:"
    echo
    echo "  1. Install Xcode Command Line Tools:"
    echo "       xcode-select --install"
    echo
    echo "  2. Install Python setuptools:"
    echo "       python3 -m pip install --upgrade pip setuptools"
    echo
    echo "  3. Rerun this script:"
    echo "       ./start.command"
    echo
    exit 1
  fi
fi

# ── Build ──

step "Building Clui CC"
if ! npx electron-vite build --mode production; then
  echo
  echo "Build failed. Most common fixes:"
  echo
  echo "  1. Install Xcode Command Line Tools:"
  echo "       xcode-select --install"
  echo
  echo "  2. Install Python setuptools:"
  echo "       python3 -m pip install --upgrade pip setuptools"
  echo
  echo "  3. Reinstall dependencies:"
  echo "       rm -rf node_modules && npm install"
  echo
  echo "  4. Rerun this script:"
  echo "       ./start.command"
  echo
  exit 1
fi

# ── Launch ──

step "Launching Clui CC"
echo "  Alt+Space to toggle the overlay."
echo "  Use ./stop.command or tray icon > Quit to close."
echo
exec npx electron .
