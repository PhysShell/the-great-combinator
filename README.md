# The Great Combinator - Files to Clipboard/TempFile

Tired of copy-pasting multiple files one by one to vibecode it to the LLM? Well, me too.

The Great Combinator is here to simplify it for you: select multiple files in VS Code explorer and `The Great Combinator → Copy` from context menu. All files are combined into single artifact.

Want to make it as an attachment? `The Great Combinator → Temp File` will get you going!

Now boring LLM's generated text:

- **Clipboard mode**: result to clipboard
- **Temp File mode**: creates temporary file that can be pasted as attachment

## Architecture

- **Rust CLI** (`core/`) - cross-platform core
- **VS Code Extension** (`vscode-ext/`) - TypeScript adapter 
- **Visual Studio VSIX** (`vs-ext/`) - C# adapter for Windows

## Quick Start

### 1. Build CLI

```bash
# Nix environment
nix develop .#rust

# In root directory
cargo build --release
```

### 2. VS Code Extension

```bash
# Nix environment  
nix develop .#ts

# Build CLI and copy binaries
./scripts/build-all.sh

# Build extension
./scripts/package-vscode.sh
```

### 3. CLI Demo

```bash
./scripts/run-cli-demo.sh
```

## Usage

### VS Code

1. Select files/folders in Explorer
2. Right-click → **The Great Combinator → Copy** / **The Great Combinator → Temp File**
3. Or hotkeys: `Ctrl+Alt+Shift+C` / `Ctrl+Alt+Shift+F`

### Direct CLI usage

```bash
echo '{"paths":["./src","./README.md"],"workspace_root":"."}' | \
  ./target/release/the-great-combinator \
  --mode clipboard \
  --header-format 'File ${index}: ${relpath}' \
  --separator '\n---\n'
```

## VS Code Settings

- `tgc.headerFormat` - header template (default: `File ${index}: ${relpath}`)
- `tgc.separator` - separator between files (default: `\\n\\n`) 
- `tgc.maxFileSizeKB` - file size limit (default: 1024)
- `tgc.skipBinary` - skip binary files (default: true)
- `tgc.onTempOpen` - action after creating temp file (default: `copyAsFile`)
  - `copyAsFile` - copy file as attachment (like Ctrl+C on file in file manager)
  - `copyPath` - copy file path to clipboard
  - `openAndReveal` - open file and show in file manager
  - `openOnly` - open file only
  - `revealOnly` - show in file manager only
  - `none` - do nothing

## Development

### Dev Shells (Nix)

- `nix develop .#rust` - Rust development (core/)
- `nix develop .#ts` - TypeScript/Node.js (vscode-ext/) 
- `nix develop .#dotnet` - .NET for Visual Studio (vs-ext/)

### Tests

```bash
cargo test
cargo test --test cli_smoke
```

## 🔍 Extension Debugging Guide

### ✅ What's Fixed

1. **Multi-step binary search** (independent of workspace_root):
   - 📝 User setting (`tgc.coreBinPath`)
   - 🔧 ENV variable (`TGC_CORE_BIN`)
   - 🏠 Debug binary relative to extensionPath (`../target/debug/`)
   - 📁 Fallback to workspace_root (`./target/debug/`)
   - 📦 Production binary in `.vsix` (`./bin/linux-x64/`)
   - 🌐 System PATH

2. **Detailed logging** for each search step and execution

### 🚀 How to Test

#### 1️⃣ **Start debugging:**
**Core**:
Set up basic launch target in settings.json:
```json
{
  "name": "Debug (cargo bin the-great-combinator)",
  "type": "lldb",
  "request": "launch",
  "terminal": "integrated", 
  "cargo": {
    "args": ["build", "--package", "the-great-combinator", "--bin", "the-great-combinator"]
  },
  "args": []
},
```

Then:

```bash
Ctrl+Shift+D → "Debug (cargo bin the-great-combinator)" → F5
```

**Extension**:
Same here:
```json
{
  "name": "🔧 Debug Extension (Dev Workspace)",
  "type": "extensionHost",
  "request": "launch",
  "args": [
      "--extensionDevelopmentPath=${workspaceFolder}/vscode-ext",
      "${workspaceFolder}/vscode-ext/.dev-workspace"
  ],
  "outFiles": [
      "${workspaceFolder}/vscode-ext/out/**/*.js"
  ],
  "preLaunchTask": "npm: build - vscode-ext"
},
```

Then:

```bash
Ctrl+Shift+D → "🔧 Debug Extension (Dev Workspace)" → F5
```

#### 2️⃣ **Expected logs in DEBUG CONSOLE:**
```console
🚀 Tgc Extension is activating...
🔍 Binary search candidates: [null, "/path/to/target/debug/the-great-combinator", ...]
🏠 Extension path: /path/to/vscode-ext
📁 Repo root (calculated): /path/to/repo
🎯 Selected binary (found): /path/to/target/debug/the-great-combinator
✅ Tgc Extension activated successfully!
```

#### 3️⃣ **Testing commands:**

**A) Debug command:**
- In new VS Code: `Ctrl+Shift+P` → `🔧 The Great Combinator: Debug CLI`

**B) Real commands:**
- Select files in `.dev-workspace`
- Right-click → `The Great Combinator Selected → Copy`

#### 4️⃣ **Expected logs during execution:**
```console
📋 tgc.copy called with: {...}
🎯 run() called with mode: clipboard
📂 run() received: {...}
📝 Selected files: ["/path/to/demo1.txt"]
🔨 Using CLI binary: /path/to/target/debug/the-great-combinator
📤 Sending payload: {"paths":[...], "workspace_root":"..."}
⚙️ CLI args: ["--mode", "clipboard", ...]
📄 CLI stdout: File 1: demo1.txt
...
✅ CLI finished with code: 0
```

### 🛠 Problem Diagnosis

#### ❌ **Binary not found:**
```console
❌ Binary not found at: /path/to/target/debug/the-great-combinator
🎯 Fallback to PATH: the-great-combinator
💥 Process spawn error: Error: ENOENT
```
**Solution:** Run `cargo build` in root

#### ❌ **Extension doesn't activate:**
- No logs `🚀 Tgc Extension is activating...`
- **Solution:** Check TypeScript errors in DEBUG CONSOLE

#### ❌ **Commands not called:**
- No logs `📋 tgc.copy called`
- **Solution:** Check file selection in Explorer

### 🎯 Additional Settings

#### ENV variable (automatically in nix shell):
```bash
export TGC_CORE_BIN="/path/to/target/debug/the-great-combinator"
```

#### Manual setting in VS Code:
- `Ctrl+,` → Search: `tgc.coreBinPath`
- Value: `/absolute/path/to/the-great-combinator`

#### Check ENV works:
```bash
echo $TGC_CORE_BIN
```

## Project Structure

```
the-great-combinator/
├── flake.nix              # Nix dev environments
├── core/                  # Rust CLI core
│   ├── Cargo.toml
│   ├── src/main.rs
│   └── tests/
├── vscode-ext/           # VS Code extension
│   ├── package.json
│   └── src/extension.ts
├── vs-ext/               # Visual Studio VSIX
│   └── src/
└── scripts/              # Build scripts
    ├── build-all.sh
    ├── package-vscode.sh
    └── run-cli-demo.sh
```

## Roadmap

- [ ] Support .gitignore in recursive traversal
- [ ] Markdown mode (sections + code blocks)
- [ ] Parallel file reading (rayon)
- [ ] UI for formatting presets
- [ ] ZIP mode
- [ ] Localization

## License

WTFPL v2