using Community.VisualStudio.Toolkit;
using Microsoft.VisualStudio.Shell;
using System.Diagnostics;
using System.Text.Json;

namespace Tgc;
[Command(PackageIds.TgcTempCommand)]
internal sealed class TgcTempCommand : BaseCommand<TgcTempCommand>
{
    protected override async Task ExecuteAsync(OleMenuCmdEventArgs e)
    {
        var selection = await VS.Solutions.GetActiveSelectionAsync();
        var paths = new List<string>();
        foreach (var item in selection)
        {
            if (item.Type == SolutionItemType.PhysicalFile) paths.Add(item.FullPath);
            if (item.Type == SolutionItemType.PhysicalFolder)
                paths.AddRange(Directory.EnumerateFiles(item.FullPath, "*", SearchOption.AllDirectories));
        }
        if (paths.Count == 0) { await VS.MessageBox.ShowAsync("The Great Combinator", "No selection"); return; }

        var payload = JsonSerializer.Serialize(new { paths = paths, workspace_root = "" });

        var psi = new ProcessStartInfo {
            FileName = PathToCli(), // TODO: adequate path to the CLI
            Arguments = "--mode temp --header-format \"file ${index}: ${relpath}\" --separator \"\\n\\n\" --max-kb 1024 --skip-binary true",
            RedirectStandardInput = true, RedirectStandardOutput = true, RedirectStandardError = true,
            UseShellExecute = false, CreateNoWindow = true
        };
        using var p = Process.Start(psi)!;
        await p.StandardInput.WriteAsync(payload);
        p.StandardInput.Close();
        var stdout = await p.StandardOutput.ReadToEndAsync();
        var stderr = await p.StandardError.ReadToEndAsync();
        await p.WaitForExitAsync();

        if (p.ExitCode != 0)
            await VS.MessageBox.ShowErrorAsync("The Great Combinator", stderr.Length > 0 ? stderr : "CLI failed");
        else
        {
            var tempPath = stdout.Trim();
            await VS.StatusBar.ShowMessageAsync($"The Great Combinator: Created temp file: {tempPath}");
            // Optionally open the file or reveal in explorer
            Process.Start("explorer.exe", $"/select,{tempPath}");
        }
    }

    private string PathToCli()
    {
        return @"C:\Tools\the-great-combinator.exe";
    }
}
