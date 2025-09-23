use anyhow::{Result, bail, Context};
use clap::Parser;
use serde::Deserialize;
use std::{fs, io::Read, path::{Path, PathBuf}};
use tempfile::Builder as TempBuilder;
use walkdir::WalkDir;
use atty::Stream;

#[derive(Parser, Debug)]
// #[command(arg_required_else_help = true)]
struct Args {
    /// clipboard | temp
    #[arg(long, default_value = "temp")]
    mode: String,

    /// Header template, supports ${index}, ${basename}, ${relpath}
    #[arg(long, default_value = "file ${index}: ${relpath}")]
    header_format: String,

    /// Separator, supports \n, \t, \r
    #[arg(long, default_value = "\\n\\n")]
    separator: String,

    /// Max size per file in KB
    #[arg(long, default_value_t = 1024)]
    max_kb: usize,

    /// Skip binary-like files
    #[arg(long)]
    skip_binary: bool,

    /// Optional RAM dir (Linux: /run/user/$UID or /dev/shm)
    #[arg(long)]
    ram_dir: Option<PathBuf>,

    /// Enable verbose debug output
    #[arg(long, short)]
    verbose: bool,
}

#[derive(Deserialize)]
struct Input {
    paths: Vec<String>,
    #[serde(alias = "workspaceRoot")] // backward compatibility
    workspace_root: Option<String>,
}

fn ensure_stdin_is_piped() -> Result<()> {
    if atty::is(Stream::Stdin) {
        eprintln!("This command expects JSON on stdin (pipe).\n\nExample:");
        eprintln!("  echo '{{\"paths\":[\".\"]}}' | {} --mode temp", env!("CARGO_BIN_NAME"));
        eprintln!("Use --help for details.");
        std::process::exit(2);
    }
    Ok(())
}

fn unescape(s: &str) -> String {
    s.replace("\\n", "\n").replace("\\r", "\r").replace("\\t", "\t")
}

fn pick_tmp_dir(ram_dir: &Option<PathBuf>) -> PathBuf {
    if let Some(dir) = ram_dir { return dir.clone(); }
    #[cfg(target_os = "linux")]
    {
        if let Some(xdg) = std::env::var_os("XDG_RUNTIME_DIR") {
            let p = PathBuf::from(xdg);
            if p.exists() { return p; }
        }
        let shm = Path::new("/dev/shm");
        if shm.exists() { return shm.to_path_buf(); }
    }
    std::env::temp_dir()
}

fn expand(paths: &[String], verbose: bool) -> Result<Vec<PathBuf>> {
    let mut out = Vec::new();
    let mut errors = Vec::new();
    
    for p in paths {
        let p = PathBuf::from(p);
        debug_print(verbose, &format!("Processing path: {}", p.display()));
        
        match fs::metadata(&p) {
            Ok(md) => {
                if md.is_file() { 
                    debug_print(verbose, &format!("  -> Found file: {}", p.display()));
                    out.push(p); 
                } else if md.is_dir() {
                    debug_print(verbose, &format!("  -> Expanding directory: {}", p.display()));
                    let mut dir_files = 0;
                    for e in WalkDir::new(&p).into_iter() {
                        match e {
                            Ok(entry) => {
                                if entry.file_type().is_file() { 
                                    debug_print(verbose, &format!("    -> Found file in dir: {}", entry.path().display()));
                                    out.push(entry.into_path()); 
                                    dir_files += 1;
                                }
                            }
                            Err(err) => {
                                let msg = format!("Failed to access {}: {}", p.display(), err);
                                debug_print(verbose, &format!("  -> Error: {}", msg));
                                errors.push(msg);
                            }
                        }
                    }
                    debug_print(verbose, &format!("  -> Found {} files in directory", dir_files));
                } else {
                    let msg = format!("{} is neither file nor directory", p.display());
                    debug_print(verbose, &format!("  -> Error: {}", msg));
                    errors.push(msg);
                }
            }
            Err(err) => {
                let msg = format!("Cannot access {}: {}", p.display(), err);
                debug_print(verbose, &format!("  -> Error: {}", msg));
                errors.push(msg);
            }
        }
    }
    
    if !errors.is_empty() && out.is_empty() {
        bail!("No accessible files found. Errors:\n{}", errors.join("\n"));
    }
    
    if !errors.is_empty() {
        debug_print(verbose, &format!("Some errors occurred but {} files found:\n{}", out.len(), errors.join("\n")));
    }
    
    Ok(out)
}

fn is_binary(buf: &[u8]) -> bool {
    if buf.is_empty() { return false; }
    if buf.contains(&0) { return true; }
    let non = buf.iter().filter(|&&b| b < 9 || (14..32).contains(&b)).count();
    (non as f32) > 0.02 * (buf.len() as f32)
}

fn debug_print(verbose: bool, msg: &str) {
    if verbose {
        eprintln!("[DEBUG] {}", msg);
    }
}

fn main() -> Result<()> {
    let args = Args::parse();

    ensure_stdin_is_piped()?;

    debug_print(args.verbose, &format!("Args: {:?}", args));

    // read stdin JSON with better error handling
    let mut s = String::new();
    std::io::stdin().read_to_string(&mut s)
        .context("Failed to read from stdin")?;
    
    if s.trim().is_empty() {
        bail!("No input provided. Expected JSON on stdin like: {{\"paths\":[\"./file.txt\"],\"workspace_root\":\".\"}}");
    }

    debug_print(args.verbose, &format!("Input JSON: {}", s.trim()));

    let input: Input = serde_json::from_str(&s)
        .context("Failed to parse JSON input. Expected format: {\"paths\":[\"path1\",\"path2\"],\"workspace_root\":\"optional\"}")?;
    
    debug_print(args.verbose, &format!("Parsed input: paths={:?}, workspace_root={:?}", input.paths, input.workspace_root));

    if input.paths.is_empty() {
        bail!("No paths provided in input JSON");
    }

    let files = expand(&input.paths, args.verbose)
        .context("Failed to expand paths to files")?;
    debug_print(args.verbose, &format!("Expanded {} paths to {} files", input.paths.len(), files.len()));
    
    if files.is_empty() { 
        bail!("No files found from provided paths: {:?}", input.paths); 
    }

    let ws = input.workspace_root.as_deref();
    let sep = unescape(&args.separator);
    let max_bytes = args.max_kb * 1024;

    let mut acc = String::new();
    let mut processed = 0;
    let mut skipped = 0;
    
    debug_print(args.verbose, "Starting file processing...");
    
    for (i, f) in files.iter().enumerate() {
        debug_print(args.verbose, &format!("Processing file {} of {}: {}", i+1, files.len(), f.display()));
        
        let base = f.file_name().and_then(|x| x.to_str()).unwrap_or("unknown");
        let rel = ws.map(|w| pathdiff::diff_paths(f, w).unwrap_or(f.clone()))
                    .unwrap_or_else(|| f.clone());
        let rel_s = rel.to_string_lossy();

        let header = args.header_format
            .replace("${index}", &(i+1).to_string())
            .replace("${basename}", base)
            .replace("${relpath}", &rel_s);

        acc.push_str(&header);
        acc.push('\n');

        let meta = fs::metadata(f)
            .with_context(|| format!("Failed to get metadata for {}", f.display()))?;
            
        if meta.len() as usize > max_bytes {
            debug_print(args.verbose, &format!("  -> Skipped: too large ({} bytes > {} bytes)", meta.len(), max_bytes));
            acc.push_str("<skipped: too large>\n");
            skipped += 1;
        } else {
            let buf = fs::read(f)
                .with_context(|| format!("Failed to read file {}", f.display()))?;
                
            if args.skip_binary && is_binary(&buf) {
                debug_print(args.verbose, "  -> Skipped: binary file detected");
                acc.push_str("<skipped: binary>\n");
                skipped += 1;
            } else {
                debug_print(args.verbose, &format!("  -> Added: {} bytes", buf.len()));
                let text = String::from_utf8_lossy(&buf);
                acc.push_str(text.trim_end());
                acc.push('\n');
                processed += 1;
            }
        }
        if i + 1 != files.len() { acc.push_str(&sep); }
    }
    
    debug_print(args.verbose, &format!("File processing complete: {} processed, {} skipped", processed, skipped));

    match args.mode.as_str() {
        "clipboard" => { 
            debug_print(args.verbose, &format!("Output mode: clipboard, {} chars", acc.len()));
            print!("{acc}"); 
        }
        "temp" => {
            let dir = pick_tmp_dir(&args.ram_dir);
            debug_print(args.verbose, &format!("Output mode: temp file in {}", dir.display()));
            
            let file = TempBuilder::new()
                .prefix("combined-")
                .suffix(".txt")
                .tempfile_in(&dir)
                .with_context(|| format!("Failed to create temp file in {}", dir.display()))?;
                
            let path = file.into_temp_path();       // scheduled for deletion on drop
            let final_path = path.keep()
                .context("Failed to keep temp file")?;          // we keep it for user
                
            debug_print(args.verbose, &format!("Writing {} chars to {}", acc.len(), final_path.display()));
            
            fs::write(&final_path, &acc)
                .with_context(|| format!("Failed to write content to {}", final_path.display()))?;
                
            println!("{}", final_path.to_string_lossy());
        }
        _ => bail!("Unknown mode '{}'. Use 'clipboard' or 'temp'", args.mode),
    }
    Ok(())
}
