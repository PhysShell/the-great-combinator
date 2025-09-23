using Community.VisualStudio.Toolkit;
using Microsoft.VisualStudio.Shell;
using System.Threading;
using System.Threading.Tasks;

namespace CombineAny;
[PackageRegistration(UseManagedResourcesOnly = true, AllowsBackgroundLoading = true)]
[InstalledProductRegistration("Combine Any", "Combine files via CLI", "0.1.0")]
[ProvideMenuResource("Menus.ctmenu", 1)]
public sealed class Package : AsyncPackage
{
    protected override async Task InitializeAsync(CancellationToken cancellationToken, IProgress<ServiceProgressData> progress)
    {
        await this.RegisterCommandsAsync();
    }
}
