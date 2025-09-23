import { commands, env, window, Uri, workspace, ExtensionContext } from 'vscode';
import { spawn } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

// Function to copy file to clipboard as attachment
async function copyFileToClipboard(filePath: string): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      let cmd: string;
      let args: string[];
      
      const platform = process.platform;
      const fileUri = `file://${filePath}`;
      
      if (platform === 'linux') {
        // Linux: use xclip to copy file URI
        cmd = 'xclip';
        args = ['-selection', 'clipboard', '-t', 'text/uri-list'];
      } else if (platform === 'darwin') {
        // macOS: use osascript to copy file
        cmd = 'osascript';
        args = ['-e', `set the clipboard to POSIX file "${filePath}" as «class furl»`];
      } else if (platform === 'win32') {
        // Windows: use PowerShell for CF_HDROP equivalent
        cmd = 'powershell';
        args = ['-Command', 
          `Add-Type -AssemblyName System.Windows.Forms; ` +
          `[System.Windows.Forms.Clipboard]::SetFileDropList([System.Collections.Specialized.StringCollection]@('${filePath.replace(/'/g, "''")}')); ` +
          `Write-Host 'File copied to clipboard'`
        ];
      } else {
        console.log('❌ Unsupported platform for file clipboard:', platform);
        resolve(false);
        return;
      }
      
      console.log('🔄 Copying file to clipboard:', cmd, args);
      
      const child = spawn(cmd, args, { 
        stdio: platform === 'linux' ? ['pipe', 'pipe', 'pipe'] : ['ignore', 'pipe', 'pipe']
      });
      
      // For Linux, pass URI through stdin
      if (platform === 'linux' && child.stdin) {
        child.stdin.write(fileUri);
        child.stdin.end();
      }
      
      child.on('close', (code) => {
        console.log('📄 File clipboard command finished with code:', code);
        resolve(code === 0);
      });
      
      child.on('error', (error) => {
        console.error('💥 File clipboard command error:', error);
        resolve(false);
      });
      
    } catch (error) {
      console.error('💥 copyFileToClipboard error:', error);
      resolve(false);
    }
  });
}

function pathExists(p?: string | null): p is string {
  return !!p && fs.existsSync(p);
}

function expand(p: string): string {
  if (p.startsWith('~')) return path.join(os.homedir(), p.slice(1));
  // простая подстановка ${workspaceFolder}
  const wf = workspace.workspaceFolders?.[0]?.uri.fsPath;
  return p.replace('${workspaceFolder}', wf ?? '');
}

function repoRootFromExtension(context: ExtensionContext): string {
  // context.extensionPath -> .../vscode-ext
  // корень репо обычно на уровень выше
  return path.resolve(context.extensionPath, '..');
}

function tryDebugBinFromRepo(context: ExtensionContext, exe: string): string | null {
  const repoRoot = repoRootFromExtension(context);
  const p = path.join(repoRoot, 'target', 'debug', exe);
  return pathExists(p) ? p : null;
}

function tryDebugBinFromWorkspace(exe: string): string | null {
  // Если dev-host открыт на реальном корне — сработает,
  // если на .dev-workspace — нет, но это лишь fallback.
  const wf = workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!wf) return null;
  const p = path.join(wf, 'target', 'debug', exe);
  return pathExists(p) ? p : null;
}

function tryPackagedBin(context: ExtensionContext, exe: string): string | null {
  const dir = `${process.platform}-${process.arch}`; // например linux-x64
  const p = context.asAbsolutePath(path.join('bin', dir, exe));
  return pathExists(p) ? p : null;
}

function whichOnPath(exe: string): string | null {
  // простая проверка: если просто имя, надеемся что в PATH
  return exe; // spawn сам скажет ENOENT, если нет
}

function pickBinary(context: ExtensionContext) {
  const exe = process.platform === 'win32' ? 'the-great-combinator.exe' : 'the-great-combinator';

  // 1) настройка пользователя
  const cfgPath = (workspace.getConfiguration('tgc').get<string>('coreBinPath') || '').trim();
  const cfgExpanded = cfgPath ? expand(cfgPath) : '';

  // 2) env переменная
  const envPath = process.env.TGC_CORE_BIN;

  // 3) dev от корня репо (надежно, не зависит от workspace_root)
  const devFromRepo = tryDebugBinFromRepo(context, exe);

  // 4) dev от workspace (вдруг открыт реальный корень)
  const devFromWF = tryDebugBinFromWorkspace(exe);

  // 5) упакованный
  const packaged = tryPackagedBin(context, exe);

  // 6) PATH
  const onPath = whichOnPath(exe);

  const candidates = [
    cfgExpanded || null,
    envPath || null,
    devFromRepo,
    devFromWF,
    packaged,
    onPath
  ].filter(Boolean) as string[];

  console.log('🔍 Binary search candidates:', candidates);
  console.log('🏠 Extension path:', context.extensionPath);
  console.log('📁 Repo root (calculated):', repoRootFromExtension(context));

  // Возьми первый существующий путь (кроме bare name на PATH мы не проверим заранее)
  for (const c of candidates) {
    if (path.basename(c) === c) {
      console.log('🎯 Selected binary (PATH):', c);
      return c; // имя без пути — оставим как есть
    }
    if (pathExists(c)) {
      console.log('🎯 Selected binary (found):', c);
      return c;
    } else {
      console.log('❌ Binary not found at:', c);
    }
  }
  
  // последний шанс — имя на PATH
  console.log('🎯 Fallback to PATH:', exe);
  return exe;
}

async function run(mode: 'clipboard'|'temp', context: ExtensionContext, uri?: Uri, uris?: Uri[]) {
  console.log('🎯 run() called with mode:', mode);
  console.log('📂 run() received:', { uri, uris });
  
  try {
    const picks = Array.isArray(uris) && uris.length ? uris : (uri ? [uri] : []);
    console.log('📝 Selected files:', picks.map(p => p.fsPath));
    
    if (!picks.length) { 
      console.log('⚠️ No files selected');
      window.showWarningMessage('No files selected! Right-click on files/folders in Explorer first.'); 
      return; 
    }

  const cfg = workspace.getConfiguration('tgc');
  const payload = {
    paths: picks.map(u => u.fsPath),
    workspace_root: workspace.workspaceFolders?.[0]?.uri.fsPath
  };

  const args = [
    '--mode', mode,
    '--header-format', cfg.get('headerFormat') as string,
    '--separator', cfg.get('separator') as string,
    '--max-kb', String(cfg.get('maxFileSizeKB') as number),
    // '--skip-binary', String(cfg.get('skipBinary') as boolean),
  ];

    const binaryPath = pickBinary(context);
    console.log('🔨 Using CLI binary:', binaryPath);
    console.log('📤 Sending payload:', JSON.stringify(payload, null, 2));
    console.log('⚙️ CLI args:', args);
    
    const child = spawn(binaryPath, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    
    child.on('error', (error) => {
      console.error('💥 Process spawn error:', error);
      window.showErrorMessage(`Failed to start CLI: ${error.message}`);
    });
    
    child.stdin.write(JSON.stringify(payload)); 
    child.stdin.end();

    let out = ''; let err = '';
    child.stdout.on('data', d => {
      const data = d.toString();
      out += data;
      console.log('📄 CLI stdout:', data);
    });
    
    child.stderr.on('data', d => {
      const data = d.toString();
      err += data;
      console.error('❌ CLI stderr:', data);
    });

    child.on('close', async (code) => {
      console.log(`✅ CLI finished with code: ${code}`);
      console.log('📤 CLI output:', out);
      console.log('❌ CLI errors:', err);
      
      if (code !== 0) { 
        const errorMsg = `CLI failed (code: ${code})\nStdout: ${out}\nStderr: ${err}`;
        console.error('💥 CLI Error:', errorMsg);
        window.showErrorMessage(errorMsg); 
        return; 
      }
      
      const result = out.trim();
      if (mode === 'clipboard') {
        await env.clipboard.writeText(result);
        window.showInformationMessage(`✅ Combined ${picks.length} files to clipboard!`);
      } else {
        const fileUri = Uri.file(result);
        const action = cfg.get<string>('onTempOpen');
        
        // Open file in editor
        if (action === 'openAndReveal' || action === 'openOnly') {
          try { await window.showTextDocument(fileUri, { preview: false }); } catch {}
        }
        
        // Show in file manager  
        if (action === 'openAndReveal' || action === 'revealOnly') {
          try { await commands.executeCommand('revealFileInOS', fileUri); } catch {}
        }
        
        // Copy path to clipboard
        if (action === 'copyPath') {
          await env.clipboard.writeText(result);
          window.showInformationMessage(`✅ Temp file created and path copied to clipboard!`);
        } 
        // Copy file as attachment (CF_HDROP equivalent)
        else if (action === 'copyAsFile') {
          const success = await copyFileToClipboard(result);
          if (success) {
            window.showInformationMessage(`✅ Temp file copied as attachment! Use Ctrl+V to paste.`);
          } else {
            window.showWarningMessage(`⚠️ Failed to copy file as attachment. Path copied instead.`);
            await env.clipboard.writeText(result);
          }
        }
        else if (action === 'none') {
          window.showInformationMessage(`✅ Temp file created: ${result}`);
        } else {
          window.showInformationMessage(`✅ Created temp file: ${result}`);
        }
      }
    });
    
  } catch (error: any) {
    console.error('💥 run() error:', error);
    window.showErrorMessage(`Extension error: ${error.message}`);
  }
}

// Функция для отладки - вызывает debug сборку CLI
async function debugRun(context: ExtensionContext) {
  try {
    const workspace_root = workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspace_root) {
      window.showErrorMessage('Open workspace first!');
      return;
    }

    // Путь к debug бинарнику
    const binName = process.platform === 'win32' ? 'the-great-combinator.exe' : 'the-great-combinator';
    const debugBinPath = path.join(workspace_root, 'target', 'debug', binName);
    
    console.log('Debug: Trying to run CLI at:', debugBinPath);

    const child = spawn(debugBinPath, ['--mode', 'clipboard'], {
      cwd: workspace_root,
      stdio: ['pipe', 'pipe', 'pipe']
    });

    let out = ''; let err = '';
    child.stdout.on('data', (d) => {
      const data = d.toString();
      out += data;
      console.log('[CLI stdout]', data);
    });
    
    child.stderr.on('data', (d) => {
      const data = d.toString();
      err += data;
      console.error('[CLI stderr]', data);
    });

    // Тестовый JSON для CLI
    const testInput = JSON.stringify({
      paths: [path.join(workspace_root, 'README.md')],
      workspace_root: workspace_root
    });
    
    console.log('Debug: Sending JSON:', testInput);
    child.stdin.write(testInput);
    child.stdin.end();

    const code = await new Promise<number>((resolve) => {
      child.on('close', resolve);
      child.on('error', (err) => {
        console.error('Debug: Process error:', err);
        resolve(-1);
      });
    });
    
    console.log(`Debug: CLI exited with code ${code}`);
    console.log('Debug: stdout:', out);
    console.log('Debug: stderr:', err);

    if (code === 0) {
      window.showInformationMessage(`CLI Debug Success! Output: ${out.substring(0, 100)}...`);
    } else {
      window.showErrorMessage(`CLI Debug Failed (code: ${code}): ${err || 'No error output'}`);
    }
  } catch (e: any) {
    const msg = `Debug run failed: ${e?.message ?? e}`;
    console.error('Debug error:', e);
    window.showErrorMessage(msg);
  }
}

export function activate(context: ExtensionContext) {
  console.log('🚀 Tgc Extension is activating...');
  
    // Register commands with additional logging
  const copyCommand = commands.registerCommand('tgc.copy', (uri, uris) => {
    console.log('📋 tgc.copy called with:', { uri, uris });
    return run('clipboard', context, uri, uris);
  });
  
  const tempCommand = commands.registerCommand('tgc.temp', (uri, uris) => {
    console.log('📁 tgc.temp called with:', { uri, uris });  
    return run('temp', context, uri, uris);
  });
  
  const debugCommand = commands.registerCommand('tgc.debug', () => {
    console.log('🔧 tgc.debug called');
    return debugRun(context);
  });

  context.subscriptions.push(copyCommand, tempCommand, debugCommand);
  
  console.log('✅ Tgc Extension activated successfully!');
  window.showInformationMessage('🎉 Tgc Extension is ready!');
}
export function deactivate() {}
