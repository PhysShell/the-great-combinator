{
  description = "Dev shells: Rust core, VSCode TS, Visual Studio .NET (Windows)";

  inputs = {
    nixpkgs.url      = "github:NixOS/nixpkgs/nixos-unstable";
    rust-overlay.url = "github:oxalica/rust-overlay";
  };
  outputs = { self, nixpkgs, rust-overlay }:
  let
    forAll = f: nixpkgs.lib.genAttrs [ "x86_64-linux" "aarch64-linux" "x86_64-darwin" "aarch64-darwin" ] (system:
      let overlays = [ (import rust-overlay) ];
      pkgs = import nixpkgs { inherit system; overlays = overlays; }; in f pkgs);
  in {
    devShells = forAll (pkgs: {
      # 1) Rust (core)
      rust = pkgs.mkShell {
        packages = [
          (pkgs.rust-bin.stable.latest.default)
          pkgs.lldb
          pkgs.rust-analyzer
          pkgs.pkg-config
	  pkgs.clippy
        ];
        shellHook = ''
          export TGC_CORE_BIN="$PWD/core/target/debug/the-great-combinator"
          echo "[Rust shell] cargo build"
          echo "🦀 TGC_CORE_BIN=$TGC_CORE_BIN"
        '';
      };

      # 2) TypeScript (VS Code extension)
      ts = pkgs.mkShell {
        packages = with pkgs; [
          pkgs.nodejs_20
          pkgs.yarn
          pkgs.esbuild
	  pkgs.xclip # For attachment-copy behavior test
        ];
        shellHook = ''
          export TGC_CORE_BIN="$PWD/core/target/debug/the-great-combinator"
          echo "[TS shell] cd vscode-ext && yarn && yarn build"
          echo "🦀 TGC_CORE_BIN=$TGC_CORE_BIN"
        '';
      };

      # 3) .NET for Visual Studio (Windows-only realistically)
      dotnet = pkgs.mkShell {
        packages = with pkgs; [
          dotnet-sdk_8
        ];
        shellHook = ''
          echo "[.NET shell] cd vs-ext"
        '';
      };
    });
  };
}
